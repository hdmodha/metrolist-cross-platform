/**
 * Metrolist desktop app (Electron main process).
 *
 * The Express server (`src/server/createServer.ts`, desktop mode) runs inside this process on
 * 127.0.0.1 at a FIXED preferred port (`policies/ports.ts`): localStorage — liked songs, downloads,
 * the queue — is per origin, so the origin must not change between launches. The window loads
 * `http://localhost:<port>/` over plain http (not a custom `app://` scheme), because YouTube's embedded
 * player needs a normal http(s) origin / referrer, and refuses some videos for an IP-address host
 * (`policies/appOrigin.ts`; data saved under `127.0.0.1` by earlier versions is moved once,
 * `storageMigration.ts`).
 *
 * Ad and tracking requests (the YouTube player's included) are cancelled in the session
 * (`adBlocker.ts`, rules in `src/shared/adBlock.ts`).
 *
 * Flags: `--metrolist-dev` (unpackaged only) serves the source through Vite; `METROLIST_SMOKE_TEST=1`
 * runs the start-up self-check and exits (see `smokeRunner.ts`).
 */
import { app, dialog, session, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMetrolistServer, type FrontendMiddleware, type RunningMetrolistServer } from '../src/server/createServer';
import { installAdBlocker, type AdBlocker } from './adBlocker';
import { readJsonFile, writeJsonFile } from './jsonFile';
import { createMainWindow } from './mainWindow';
import { appUrl } from './policies/appOrigin';
import { installMenu } from './menu';
import { PREFERRED_PORT, listenOnPreferredPort, shouldShowPortNotice } from './policies/ports';
import { isSmokeTestEnabled } from './policies/smokeTest';
import { applyNavigationPolicy, applyPermissionPolicy } from './security';
import { armSmokeTestTimeout, finishSmokeTest, runSmokeTest } from './smokeRunner';
import { migrateLegacyStorage } from './storageMigration';

const APP_USER_MODEL_ID = 'com.metrolist.music';
const isMac = process.platform === 'darwin';
const smokeTest = isSmokeTestEnabled(process.env);
const devMode = !app.isPackaged && process.argv.includes('--metrolist-dev');

// Playback starts without the "tap the player" prompt, and keeps its timers running in the background
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

if (smokeTest) {
  armSmokeTestTimeout();
  // A throw-away profile: the self-check never touches (or locks) a listener's real data
  app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'metrolist-smoke-')));
}

let mainWindow: BrowserWindow | null = null;
let server: RunningMetrolistServer | null = null;
let appOrigin = '';
/** The page URL (`http://localhost:<port>/`). */
let pageUrl = '';
/** Saved data of the old origin, lent to the server during the one-time move (`storageMigration.ts`). */
let legacyStorage: Record<string, string> | null = null;
let quitting = false;
let adBlocker: AdBlocker | null = null;

function showMainWindow(): void {
  if (!server) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    openMainWindow(pageUrl);
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Opens the window (hidden until its first paint); it loads `url` once `ready` settles. */
function openMainWindow(url: string, ready: Promise<void> = Promise.resolve()): BrowserWindow {
  const win = createMainWindow(app.getPath('userData'));
  mainWindow = win;
  win.on('close', (event) => {
    // macOS: closing the window hides it and the music keeps playing; Cmd+Q / the Dock quit
    if (isMac && !quitting && !smokeTest) {
      event.preventDefault();
      if (win.isFullScreen()) {
        win.once('leave-full-screen', () => win.hide());
        win.setFullScreen(false);
      } else {
        win.hide();
      }
    }
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  void ready.then(() => {
    if (!win.isDestroyed()) void win.loadURL(url);
  });
  return win;
}

function takeLegacyStorage(): Record<string, string> | null {
  const entries = legacyStorage;
  legacyStorage = null;
  return entries;
}

async function startServer(): Promise<{ server: RunningMetrolistServer; usedFallback: boolean }> {
  let frontend: FrontendMiddleware | undefined;
  if (devMode) {
    const { createDevFrontend } = await import('../src/server/devFrontend');
    frontend = (await createDevFrontend(app.getAppPath())).middleware;
  }
  const distPath = path.join(app.getAppPath(), 'dist');
  const choice = await listenOnPreferredPort((port) =>
    startMetrolistServer({ mode: 'desktop', port, distPath, frontend, takeLegacyStorage })
  );
  if (choice.usedFallback) {
    console.warn(
      `[metrolist] port ${PREFERRED_PORT} is not available (tried ${choice.unavailable.join(', ')}); using ${choice.value.port}`
    );
  }
  return { server: choice.value, usedFallback: choice.usedFallback };
}

/** Tells the listener (once per fallback port) that data saved on the usual port is not available. */
function noticeFallbackPort(win: BrowserWindow, port: number): void {
  const noticesFile = path.join(app.getPath('userData'), 'port-notices.json');
  const stored = readJsonFile(noticesFile) as { noticed?: unknown } | null;
  const noticed = Array.isArray(stored?.noticed) ? stored.noticed.filter((p): p is number => Number.isInteger(p)) : [];
  if (!shouldShowPortNotice(port, noticed)) return;
  writeJsonFile(noticesFile, { noticed: [...noticed, port] });
  void dialog.showMessageBox(win, {
    type: 'info',
    title: 'Metrolist',
    message: 'Your saved music is not available in this session',
    detail:
      `Another program is using port ${PREFERRED_PORT}, which Metrolist normally uses, so it started on port ${port}. ` +
      'Liked songs, downloads and the queue saved on the usual port are kept, but not shown now. ' +
      'Quit the other program and restart Metrolist to get them back.',
  });
}

async function start(): Promise<void> {
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);
  applyPermissionPolicy(session.defaultSession);
  // Before any page loads: ad / tracking requests of the YouTube player are cancelled from the start
  adBlocker = installAdBlocker(session.defaultSession);
  installMenu();

  const started = await startServer();
  server = started.server;
  pageUrl = appUrl(server.port);
  appOrigin = new URL(pageUrl).origin;
  console.log(`[metrolist] serving ${pageUrl}`);

  // Before the page reads its saved state. The main window exists meanwhile (hidden), so closing the
  // move's hidden windows never looks like "all windows closed" (which quits on Windows / Linux)
  const moved = migrateLegacyStorage(app.getPath('userData'), server.port, {
    lend: (entries) => {
      legacyStorage = entries;
    },
    revoke: () => {
      legacyStorage = null;
    },
  });
  const win = openMainWindow(pageUrl, moved);
  if (smokeTest) {
    void runSmokeTest(win, pageUrl);
  } else if (started.usedFallback) {
    win.once('ready-to-show', () => noticeFallbackPort(win, server?.port ?? 0));
  }
}

if (!app.requestSingleInstanceLock()) {
  // Another Metrolist is running: it shows its window (`second-instance`), this one leaves
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  app.on('web-contents-created', (_event, contents) => applyNavigationPolicy(contents, () => appOrigin));
  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('activate', () => showMainWindow());
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
  app.on('will-quit', () => {
    if (adBlocker) console.log(`[metrolist] ad blocker: ${adBlocker.blockedCount()} request(s) blocked this session`);
    void server?.close();
  });

  app
    .whenReady()
    .then(start)
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[metrolist] could not start:', err);
      if (smokeTest) {
        finishSmokeTest({ pass: false, line: `METROLIST SMOKE TEST: FAIL (start-up error: ${message})` });
        return;
      }
      dialog.showErrorBox('Metrolist could not start', message);
      app.exit(1);
    });
}
