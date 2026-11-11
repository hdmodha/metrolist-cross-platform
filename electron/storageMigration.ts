/**
 * Copies the data earlier versions saved under `http://127.0.0.1:<port>` into the page origin the
 * window uses now (`http://localhost:<port>`, see `policies/appOrigin.ts`), once per port, before the
 * main window loads (the page reads its saved state at start-up).
 *
 * Two hidden windows in the default session (where localStorage lives), each on a small file of the
 * app (`/manifest.webmanifest`, so no app code runs): the first, on the old origin, reads the
 * `metrolist.*` entries with a constant script; the main process checks them
 * (`sanitizeLegacyStorage`) and lends them to the in-process server; the second, on the new origin,
 * fetches them from `/api/desktop/legacy-storage` with another constant script and writes the keys it
 * does not have yet. No page data is ever put into a script (CLAUDE.md §5.5). The old origin's data
 * stays where it is. A failure leaves the port unmarked, so the next launch tries again.
 */
import { BrowserWindow } from 'electron';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from './jsonFile';
import { appUrl, legacyUrl, needsMigration, parseMigratedPorts, sanitizeLegacyStorage } from './policies/appOrigin';
import { secureWebPreferences } from './security';

const MIGRATION_TIMEOUT_MS = 10_000;
const BLANK_PAGE = 'manifest.webmanifest';

/** Runs on the old origin: its `metrolist.*` entries as one JSON string. */
const READ_SCRIPT = `(() => {
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('metrolist.')) out[key] = localStorage.getItem(key);
  }
  return JSON.stringify(out);
})()`;

/** Runs on the new origin: writes the entries the server hands out, never over existing ones. */
const WRITE_SCRIPT = `fetch('/api/desktop/legacy-storage', { cache: 'no-store' })
  .then((response) => (response.ok ? response.json() : { entries: {} }))
  .then((body) => {
    const entries = body && typeof body.entries === 'object' && body.entries ? body.entries : {};
    let written = 0;
    for (const key of Object.keys(entries)) {
      const value = entries[key];
      if (!key.startsWith('metrolist.') || typeof value !== 'string' || localStorage.getItem(key) !== null) continue;
      localStorage.setItem(key, value);
      written++;
    }
    return written;
  })`;

export interface LegacyStorageHandoff {
  /** Lends the entries to the server's `/api/desktop/legacy-storage` (single use). */
  lend: (entries: Record<string, string>) => void;
  /** Takes back whatever was not fetched. */
  revoke: () => void;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    );
  });
}

async function copy(port: number, handoff: LegacyStorageHandoff): Promise<number> {
  const win = new BrowserWindow({ show: false, webPreferences: secureWebPreferences() });
  try {
    await win.loadURL(legacyUrl(port) + BLANK_PAGE);
    const raw = (await win.webContents.executeJavaScript(READ_SCRIPT, false)) as unknown;
    const entries = sanitizeLegacyStorage(typeof raw === 'string' ? (JSON.parse(raw) as unknown) : null);
    if (Object.keys(entries).length === 0) return 0;
    handoff.lend(entries);
    await win.loadURL(appUrl(port) + BLANK_PAGE);
    const written = (await win.webContents.executeJavaScript(WRITE_SCRIPT, false)) as unknown;
    return typeof written === 'number' ? written : 0;
  } finally {
    handoff.revoke();
    if (!win.isDestroyed()) win.destroy();
  }
}

/** Copies the old origin's saved data for `port` once; never throws (the app starts either way). */
export async function migrateLegacyStorage(
  userDataDir: string,
  port: number,
  handoff: LegacyStorageHandoff
): Promise<void> {
  const markerFile = path.join(userDataDir, 'origin-migration.json');
  const migratedPorts = parseMigratedPorts(readJsonFile(markerFile));
  if (!needsMigration(port, migratedPorts)) return;
  try {
    const written = await withTimeout(copy(port, handoff), MIGRATION_TIMEOUT_MS);
    writeJsonFile(markerFile, { migratedPorts: [...migratedPorts, port] });
    console.log(`[metrolist] saved data moved to ${appUrl(port)}: ${written} entr${written === 1 ? 'y' : 'ies'}`);
  } catch (error) {
    console.warn(`[metrolist] could not move saved data to ${appUrl(port)} (will retry next launch):`, error);
  }
}
