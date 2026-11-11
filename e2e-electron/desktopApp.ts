/**
 * Starts the desktop app for a test, hermetically:
 * - the page's requests are routed to the web suite's fixtures (`e2e/fixtures/test.ts`: fake YouTube
 *   IFrame API, mocked `/api/innertube/*`, artwork); anything else is aborted and fails the test;
 * - Playwright can only install routes once the app runs, so the very first page load is cut off from
 *   the internet another way: Chromium resolves no external host (`--host-resolver-rules`), and the
 *   in-process server's upstream `fetch` goes to a dead proxy (`NODE_USE_ENV_PROXY`). The page is then
 *   reloaded with the routes in place.
 * Each test gets its own profile (`--user-data-dir`), so tests never see each other's data.
 */
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMockApi, installRoutes, type MockApi } from '../e2e/fixtures/test';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const APP_URL = 'http://127.0.0.1:47823/';
/** Path of the Electron binary (`require('electron')` from Node is the path). */
export const ELECTRON_BINARY = createRequire(import.meta.url)('electron') as string;

const DEAD_PROXY = 'http://127.0.0.1:9';

/** Command-line switches for every launch. */
export function electronArgs(userDataDir: string): string[] {
  const args = [
    '.',
    `--user-data-dir=${userDataDir}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
  ];
  // Linux test runs only: Chromium's sandbox cannot start as root (containers) or under Ubuntu 24.04's
  // AppArmor user-namespace restriction (GitHub runners). The shipped macOS / Windows apps keep it.
  if (process.platform === 'linux') args.push('--no-sandbox');
  return args;
}

export function electronEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !/^(NODE_OPTIONS|https?_proxy|no_proxy|all_proxy)$/i.test(key)) env[key] = value;
  }
  return { ...env, NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: DEAD_PROXY, HTTP_PROXY: DEAD_PROXY, NO_PROXY: '127.0.0.1,localhost' };
}

export function makeProfileDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'metrolist-electron-e2e-'));
}

export interface DesktopApp {
  electronApp: ElectronApplication;
  page: Page;
  api: MockApi;
  /** External requests no route expected (must stay empty). */
  unexpected: string[];
  close: () => Promise<void>;
}

export async function launchDesktopApp(userDataDir: string): Promise<DesktopApp> {
  const electronApp = await electron.launch({ args: electronArgs(userDataDir), cwd: ROOT, env: electronEnv() });
  const api = createMockApi();
  const unexpected: string[] = [];
  const page = await electronApp.firstWindow();
  // Page-level routes: in Electron, context-level routes do not reach a window that already exists
  await installRoutes(page, api, unexpected);
  await page.waitForLoadState('domcontentloaded');
  await page.reload();
  await expect(page.locator('main')).toBeVisible();
  return {
    electronApp,
    page,
    api,
    unexpected,
    close: async () => {
      await electronApp.close();
    },
  };
}

/** Starts a second instance with the same profile; resolves with its exit code. */
export function runSecondInstance(userDataDir: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(ELECTRON_BINARY, electronArgs(userDataDir), { cwd: ROOT, env: electronEnv(), stdio: 'ignore' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code));
  });
}
