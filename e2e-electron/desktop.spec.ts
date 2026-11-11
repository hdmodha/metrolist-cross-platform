/** The desktop app (Electron): window, link policy, single instance, saved window state and data. */
import { expect, test } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import { MetrolistApp } from '../e2e/fixtures/test';
import { APP_URL, launchDesktopApp, makeProfileDir, runSecondInstance, type DesktopApp } from './desktopApp';

type OpenedLinks = { __openedExternally?: string[] };

const profiles: string[] = [];
let running: DesktopApp | null = null;

function newProfile(): string {
  const dir = makeProfileDir();
  profiles.push(dir);
  return dir;
}

async function launch(profile: string): Promise<DesktopApp> {
  running = await launchDesktopApp(profile);
  return running;
}

async function close(app: DesktopApp): Promise<void> {
  expect(app.unexpected, 'external requests must all be routed to fixtures').toEqual([]);
  await app.close();
  running = null;
}

test.afterEach(async () => {
  if (running) await running.close().catch(() => undefined);
  running = null;
});

test.afterAll(() => {
  for (const dir of profiles) fs.rmSync(dir, { recursive: true, force: true });
});

function mainWindowInfo(app: DesktopApp) {
  return app.electronApp.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows[0];
    return { count: windows.length, title: win.getTitle(), visible: win.isVisible(), bounds: win.getBounds() };
  });
}

/** Replaces `shell.openExternal` in the main process with a recorder. */
async function stubOpenExternal(app: DesktopApp): Promise<void> {
  await app.electronApp.evaluate(({ shell }) => {
    const g = globalThis as OpenedLinks;
    g.__openedExternally = [];
    shell.openExternal = async (url: string) => {
      g.__openedExternally?.push(url);
    };
  });
}

function openedExternally(app: DesktopApp): Promise<string[]> {
  return app.electronApp.evaluate(() => (globalThis as OpenedLinks).__openedExternally ?? []);
}

test('opens one window on http://127.0.0.1:47823/ titled Metrolist, with the app shell', async () => {
  const app = await launch(newProfile());
  expect(app.page.url()).toBe(APP_URL);
  const info = await mainWindowInfo(app);
  expect(info.count).toBe(1);
  expect(info.title).toBe('Metrolist');
  expect(info.visible).toBe(true);
  await expect(app.page).toHaveTitle(/Metrolist/);
  const nav = app.page.locator('nav[aria-label="Main"]:visible');
  for (const name of ['Home', 'Search', 'Library']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  // The renderer is isolated: no Node.js in the page
  expect(await app.page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
  await close(app);
});

test('links to other sites open in the default browser, never in the app', async () => {
  const app = await launch(newProfile());
  await stubOpenExternal(app);
  await app.page.evaluate(() => {
    for (const [index, [id, href, target]] of [
      ['same-tab', 'https://example.com/same-tab', '_self'],
      ['new-tab', 'https://example.com/new-tab', '_blank'],
      ['file', 'file:///etc/passwd', '_self'],
    ].entries()) {
      const a = document.createElement('a');
      a.id = id;
      a.href = href;
      a.target = target;
      a.textContent = id;
      a.style.cssText = `position:fixed;top:${index * 48}px;left:0;z-index:99999;display:block;padding:8px;background:#fff`;
      document.body.append(a);
    }
  });
  // Real mouse clicks, measured up front: Playwright keeps waiting for a navigation the app cancelled,
  // so after the first click the window is inspected from the main process only.
  const boxes = [];
  for (const id of ['#same-tab', '#new-tab', '#file']) {
    const box = await app.page.locator(id).boundingBox();
    if (!box) throw new Error(`${id} is not rendered`);
    boxes.push(box);
  }
  for (const box of boxes) await app.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => openedExternally(app)).toEqual(['https://example.com/same-tab', 'https://example.com/new-tab']);
  const after = await app.electronApp.evaluate(async ({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    return { url: contents.getURL(), hasShell: (await contents.executeJavaScript('!!document.querySelector("main")')) as boolean };
  });
  expect(after).toEqual({ url: APP_URL, hasShell: true });
  expect((await mainWindowInfo(app)).count).toBe(1);
  await close(app);
});

test('window.open to another origin is denied in the app', async () => {
  const app = await launch(newProfile());
  await stubOpenExternal(app);
  const results = await app.page.evaluate(() => [
    window.open('https://example.org/popup') === null,
    window.open('file:///etc/passwd') === null,
    window.open('javascript:alert(1)') === null,
  ]);
  expect(results).toEqual([true, true, true]);
  await expect.poll(() => openedExternally(app)).toEqual(['https://example.org/popup']);
  expect(app.electronApp.windows()).toHaveLength(1);
  expect((await mainWindowInfo(app)).count).toBe(1);
  await close(app);
});

test('a second launch shows the running window instead of starting another app', async () => {
  const profile = newProfile();
  const app = await launch(profile);
  await app.electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
  await expect.poll(async () => (await mainWindowInfo(app)).visible).toBe(false);
  expect(await runSecondInstance(profile)).toBe(0);
  await expect.poll(async () => (await mainWindowInfo(app)).visible).toBe(true);
  expect((await mainWindowInfo(app)).count).toBe(1);
  await close(app);
});

test('window size and position survive a restart', async () => {
  const profile = newProfile();
  const bounds = { x: 90, y: 70, width: 1040, height: 700 };
  const first = await launch(profile);
  await first.electronApp.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0].setBounds(b), bounds);
  await expect.poll(async () => (await mainWindowInfo(first)).bounds).toEqual(bounds);
  await close(first);

  const second = await launch(profile);
  expect((await mainWindowInfo(second)).bounds).toEqual(bounds);
  await close(second);
});

test('liked songs survive a restart (same origin every launch)', async () => {
  const profile = newProfile();
  const first = await launch(profile);
  const app = new MetrolistApp(first.page);
  await app.search('daft punk');
  await expect(app.resultRows()).toHaveCount(12);
  const liked = await app.chooseFromTrackMenu(app.results, 2, 'Like');
  await expect(app.notice).toContainText('Added to Liked Songs');
  await expect
    .poll(() => first.page.evaluate(() => localStorage.getItem('metrolist.player.v2') ?? ''))
    .toContain(liked);
  await close(first);

  const second = await launch(profile);
  expect(second.page.url()).toBe(APP_URL);
  const again = new MetrolistApp(second.page);
  await again.openCollection('Liked Songs');
  await expect.poll(() => again.titlesIn(again.main)).toEqual([liked]);
  await close(second);
});

test('the server rejects a request for another host name (DNS rebinding)', async () => {
  const app = await launch(newProfile());
  const status = (host: string) =>
    new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: 47823, path: '/', headers: { Host: host }, agent: false }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
  expect(await status('evil.example')).toBe(403);
  expect(await status('evil.example:47823')).toBe(403);
  expect(await status('127.0.0.1:47823')).toBe(200);
  expect(await status('localhost:47823')).toBe(200);
  await close(app);
});
