/** The desktop app (Electron): window, link policy, single instance, saved window state and data, ad blocking. */
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
  // The window is created hidden and shown on its first paint ('ready-to-show'). The launch helper
  // reloads the page right away, so that paint can come after the app shell is already visible: wait for it.
  await expect.poll(async () => (await mainWindowInfo(app)).visible, { timeout: 5000 }).toBe(true);
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

test('ad and tracking requests of the YouTube player are cancelled; playback requests are not', async () => {
  const app = await launch(newProfile());
  const stdout: string[] = [];
  app.electronApp.process().stdout?.on('data', (chunk: Buffer) => stdout.push(chunk.toString()));
  const AD = 'https://googleads.g.doubleclick.net/pagead/id';
  const PLAYBACK = 'https://www.youtube.com/api/stats/playback?ns=yt&el=embedded&docid=probe';
  const routed: string[] = [];
  const failures: Record<string, string> = {};
  app.page.on('requestfailed', (request) => {
    failures[request.url()] = request.failure()?.errorText ?? '';
  });
  // Routes for both, so neither can fall into the suite's catch-all (which aborts unrouted requests
  // with the same ERR_BLOCKED_BY_CLIENT): a request reaching the ad route goes on to the network
  // (a dead proxy here), so only the main process's ad blocker can produce ERR_BLOCKED_BY_CLIENT
  await app.page.route(AD, (route) => {
    routed.push(AD);
    return route.continue();
  });
  await app.page.route('https://www.youtube.com/api/stats/playback**', (route) => {
    routed.push(PLAYBACK);
    return route.fulfill({ status: 204, body: '' });
  });
  await app.page.addInitScript((urls) => {
    (window as unknown as { __yt?: unknown }).__yt = { probeUrls: urls };
  }, [AD, PLAYBACK]);
  await app.page.reload();

  const player = new MetrolistApp(app.page);
  await player.searchAndPlayFirst('daft punk around the world');
  const probes = () =>
    app.page.evaluate(() => (window as unknown as { __yt: { probes: Record<string, string> } }).__yt.probes);
  await expect.poll(probes).toEqual({ [AD]: 'failed', [PLAYBACK]: 'ok' });
  expect(failures[AD]).toBe('net::ERR_BLOCKED_BY_CLIENT');
  expect(routed).toContain(PLAYBACK);
  // The main process counted it (its debug line), so the cancel came from the ad blocker
  await expect.poll(() => stdout.join('')).toContain('[metrolist] ad blocker: 1 ad / tracking request(s) blocked so far (latest: googleads.g.doubleclick.net)');
  // Electron's webRequest runs before Playwright's page routes: a cancelled request never reaches them
  expect(routed).not.toContain(AD);
  await close(app);
});

test('minimised or hidden, the window keeps playing with the page visible, and the page saves', async () => {
  const app = await launch(newProfile());
  const player = new MetrolistApp(app.page);
  await player.searchAndPlayFirst('daft punk');
  await app.page.evaluate(() => {
    const w = window as unknown as { __visibilityEvents: string[] };
    w.__visibilityEvents = [];
    document.addEventListener('visibilitychange', () => w.__visibilityEvents.push(document.visibilityState));
  });
  const pageState = () =>
    app.page.evaluate(() => ({
      visibility: document.visibilityState,
      hidden: document.hidden,
      events: (window as unknown as { __visibilityEvents: string[] }).__visibilityEvents,
    }));
  const savedPosition = () =>
    app.page.evaluate(() => {
      const raw = localStorage.getItem('metrolist.player.v2');
      return raw ? Number((JSON.parse(raw) as { positionMs?: number }).positionMs ?? 0) : null;
    });
  // Xvfb has no window manager, so minimize() changes nothing there and fires no 'minimize' event:
  // the event is then emitted by hand (the app's handler is what is under test; hide() is real)
  const windowDo = (action: 'minimize' | 'restore' | 'hide' | 'show') =>
    app.electronApp.evaluate(async ({ BrowserWindow }, how) => {
      const win = BrowserWindow.getAllWindows()[0];
      let fired = false;
      const onEvent = () => {
        fired = true;
      };
      if (how === 'minimize') win.once('minimize', onEvent);
      else win.once('hide', onEvent);
      win[how]();
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (how === 'minimize' && !fired) win.emit('minimize');
      if (how === 'minimize') win.removeListener('minimize', onEvent);
      else win.removeListener('hide', onEvent);
      return { visible: win.isVisible(), minimized: win.isMinimized(), fired };
    }, action);

  for (const [away, back] of [
    ['minimize', 'restore'],
    ['hide', 'show'],
  ] as const) {
    // The main process tells the page at once (no 5 s wait for the next periodic save)
    await app.page.evaluate(() => localStorage.removeItem('metrolist.player.v2'));
    const state = await windowDo(away);
    if (away === 'hide') expect(state).toMatchObject({ visible: false, fired: true });
    await expect.poll(savedPosition, { timeout: 2000 }).not.toBeNull();
    await app.page.goto(`${APP_URL}#/debug`).catch(() => undefined);
    await expect(app.page.getByRole('list', { name: 'Debug log entries' })).toContainText('Desktop window minimised or hidden: saved');
    await app.page.goBack();

    // Still playing, still "visible" (backgroundThrottling: false), and saving as it plays
    const before = (await savedPosition()) ?? 0;
    await expect.poll(() => player.ytState()).toBe(1);
    await expect.poll(savedPosition, { timeout: 12_000 }).toBeGreaterThan(before + 2000);
    expect(await pageState()).toEqual({ visibility: 'visible', hidden: false, events: [] });
    await windowDo(back);
  }
  await close(app);
});
