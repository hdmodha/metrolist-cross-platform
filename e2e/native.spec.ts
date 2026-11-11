/**
 * The packaged Android / iOS app: static files only (no `/api` backend) and Capacitor's native
 * bridge. The bridge is simulated: CapacitorHttp answers with InnerTube-shaped fixtures, so the
 * app's real InnerTube request layer and parsers run, and the local `BackgroundPlayback` plugin
 * records every call and can fire its `command` events (notification / headset buttons) and its
 * `lifecycle` events (the app leaving / returning to the foreground).
 */
import type { Page } from '@playwright/test';
import { fixtureVideoId, innerTubeNextJson, innerTubeSearchJson, searchResultsFor } from './fixtures/apiFixtures';
import { SERVER_PORT, STATIC_PORT } from './fixtures/ports';
import { expect, test, type MetrolistApp } from './fixtures/test';

interface NativeRequest {
  url: string;
  method: string;
  data?: { query?: string; params?: string; videoId?: string; continuation?: string };
}

interface PluginCall {
  method: string;
  options: Record<string, unknown>;
}

test.use({ baseURL: `http://localhost:${STATIC_PORT}` });

/** Every song gets the same radio, so its continuation pages are easy to recognize. */
const RADIO_SEED = fixtureVideoId('native-radio-seed');

/**
 * Installs the simulated `window.Capacitor` of the native shell (`platform`), or, with
 * `native: false`, a recording stand-in that is not a native platform (the web build).
 * Returns the CapacitorHttp requests the app made.
 */
async function installShell(page: Page, options: { platform: 'android' | 'ios' | 'web'; native: boolean }): Promise<NativeRequest[]> {
  const calls: NativeRequest[] = [];
  await page.exposeFunction('__nativeHttp', (plugin: string, method: string, request: NativeRequest) => {
    expect(`${plugin}.${method}`).toBe('CapacitorHttp.request');
    calls.push(request);
    const endpoint = new URL(request.url).pathname;
    if (request.url.startsWith('https://www.youtube.com/oembed?')) {
      expect(request.method).toBe('GET');
      return { status: 200, data: { title: 'fixture' } };
    }
    if (endpoint === '/youtubei/v1/search') {
      return { status: 200, data: innerTubeSearchJson(searchResultsFor(request.data?.query ?? '')) };
    }
    if (endpoint === '/youtubei/v1/next') {
      return { status: 200, data: innerTubeNextJson(RADIO_SEED, request.data?.continuation) };
    }
    return { status: 404, data: {} };
  });
  await page.addInitScript(
    ({ platform, native }) => {
      type Listener = (data: unknown) => void;
      const w = window as unknown as {
        Capacitor: unknown;
        __nativeHttp: (plugin: string, method: string, options: unknown) => Promise<unknown>;
        __shell: { pluginCalls: PluginCall[]; listeners: Record<string, Listener[]>; otherCalls: string[] };
        __firePluginEvent: (plugin: string, event: string, data: unknown) => void;
      };
      const shell = { pluginCalls: [] as PluginCall[], listeners: {} as Record<string, Listener[]>, otherCalls: [] as string[] };
      const nativeLoadedAt = Date.now();
      w.__shell = shell;
      w.Capacitor = {
        isNativePlatform: () => native,
        getPlatform: () => platform,
        nativePromise: (plugin: string, method: string, options?: Record<string, unknown>) => {
          if (plugin === 'CapacitorHttp') return w.__nativeHttp(plugin, method, options);
          if (plugin === 'BackgroundPlayback') {
            shell.pluginCalls.push({ method, options: JSON.parse(JSON.stringify(options ?? {})) });
            if (method === 'getDebugLog') {
              return Promise.resolve({ entries: [{ at: nativeLoadedAt, level: 'info', message: 'Background-playback WebView active (simulated)' }] });
            }
            return Promise.resolve(method === 'ensureNotificationPermission' ? { granted: true } : undefined);
          }
          shell.otherCalls.push(`${plugin}.${method}`);
          return Promise.reject(new Error(`${plugin} is not available`));
        },
        addListener: (plugin: string, event: string, callback: Listener) => {
          const key = `${plugin}.${event}`;
          (shell.listeners[key] ||= []).push(callback);
          return {
            remove: () => {
              shell.listeners[key] = shell.listeners[key].filter((f) => f !== callback);
            },
          };
        },
      };
      w.__firePluginEvent = (plugin, event, data) => {
        for (const callback of shell.listeners[`${plugin}.${event}`] ?? []) callback(data);
      };
    },
    { platform: options.platform, native: options.native }
  );
  return calls;
}

function pluginCalls(page: Page): Promise<PluginCall[]> {
  return page.evaluate(() => (window as unknown as { __shell: { pluginCalls: PluginCall[] } }).__shell.pluginCalls);
}

function listenerCount(page: Page, event: 'command' | 'lifecycle'): Promise<number> {
  return page.evaluate(
    (key) => (window as unknown as { __shell: { listeners: Record<string, unknown[]> } }).__shell.listeners[key]?.length ?? 0,
    `BackgroundPlayback.${event}`
  );
}

function commandListenerCount(page: Page): Promise<number> {
  return listenerCount(page, 'command');
}

function firePluginEvent(page: Page, event: string, data: Record<string, unknown>): Promise<void> {
  return page.evaluate(
    ({ event, data }) => {
      (window as unknown as { __firePluginEvent: (p: string, e: string, d: unknown) => void }).__firePluginEvent('BackgroundPlayback', event, data);
    },
    { event, data }
  );
}

/** A `command` event of the plugin, as the notification / lock screen / headset would send it. */
function sendCommand(page: Page, command: Record<string, unknown>): Promise<void> {
  return firePluginEvent(page, 'command', command);
}

/**
 * Removes the saved player, fires a `lifecycle` event and says whether the app saved it again
 * synchronously, inside that event (other saves are debounced or timed, so they cannot interfere).
 */
function savesOnLifecycle(page: Page, state: string): Promise<boolean> {
  return page.evaluate((lifecycleState) => {
    localStorage.removeItem('metrolist.player.v2');
    (window as unknown as { __firePluginEvent: (p: string, e: string, d: unknown) => void }).__firePluginEvent('BackgroundPlayback', 'lifecycle', {
      state: lifecycleState,
    });
    return localStorage.getItem('metrolist.player.v2') !== null;
  }, state);
}

/** The saved player (`metrolist.player.v2`), or null. */
function savedPlayer(page: Page): Promise<{ positionMs?: number; activeTrackId?: string } | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('metrolist.player.v2');
    return raw ? (JSON.parse(raw) as { positionMs?: number; activeTrackId?: string }) : null;
  });
}

async function lastUpdate(page: Page): Promise<Record<string, unknown> | undefined> {
  return (await pluginCalls(page)).filter((c) => c.method === 'update').at(-1)?.options;
}

async function playFirstResult(app: MetrolistApp, query: string): Promise<string> {
  await app.search(query);
  await expect(app.resultRows()).toHaveCount(12);
  const title = await app.titleOf(app.resultRows().first());
  await app.resultRows().first().click();
  await expect.poll(() => app.ytState()).toBe(1);
  return title;
}

test.describe('packaged app without a backend', () => {
  test('search, playback and endless radio go straight to YouTube Music through the native bridge', async ({ app, page }) => {
    const calls = await installShell(page, { platform: 'android', native: true });
    const apiCalls: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(r.url());
    });

    await app.open();
    const popular = app.main.locator('section', { has: page.getByRole('heading', { name: 'Popular right now' }) });
    await expect(app.songButtons(popular).first()).toContainText('Top Hits');
    await app.search('arijit singh');
    await expect(app.resultRows()).toHaveCount(12);
    await expect(app.resultRows().first()).toContainText('Arijit Singh');
    expect(calls.some((c) => c.method === 'POST' && c.url === 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false')).toBe(true);

    await app.resultRows().first().click();
    await expect.poll(() => app.ytState()).toBe(1);
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBe(10);
    expect(calls.some((c) => c.url.includes('/youtubei/v1/next') && !c.data?.continuation)).toBe(true);

    // Jump near the end of the radio: the next page is fetched with its continuation token
    await app.queue.locator('ul[aria-label="Next up"] button[aria-label^="Play "]').nth(6).click();
    await expect.poll(() => calls.filter((c) => c.url.includes('/youtubei/v1/next') && !!c.data?.continuation).length).toBeGreaterThan(0);
    await expect.poll(async () => (await app.upcomingTitles()).filter((t) => / P2-/.test(t)).length).toBeGreaterThan(0);

    // The embeddability pre-check asks YouTube's oEmbed directly too
    expect(calls.some((c) => c.method === 'GET' && c.url.startsWith('https://www.youtube.com/oembed?format=json&url='))).toBe(true);
    expect(apiCalls, 'no request is wasted on a backend that is not there').toEqual([]);
  });
});

test.describe('background playback plugin (Android and iOS shells)', () => {
  test('the player is mirrored into the plugin, and its commands drive the player', async ({ app, page }) => {
    await installShell(page, { platform: 'android', native: true });
    await app.open();
    expect(await pluginCalls(page), 'nothing is shown before the first play').toEqual([]);
    await expect.poll(() => commandListenerCount(page)).toBe(1);

    const title = await playFirstResult(app, 'arijit singh');
    await expect.poll(() => lastUpdate(page)).toMatchObject({ title, state: 'playing' });
    const playingUpdate = (await lastUpdate(page))!;
    expect(String(playingUpdate.artist)).toMatch(/Arijit/);
    expect(playingUpdate.durationMs).toBeGreaterThan(30_000);
    expect(String(playingUpdate.artworkUrl)).toMatch(/^https:\/\//);
    expect((await pluginCalls(page)).filter((c) => c.method === 'ensureNotificationPermission')).toHaveLength(1);

    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThan(0);
    const [next] = await app.upcomingTitles();
    await app.closeQueue();

    // "Next" on the notification
    await sendCommand(page, { action: 'next', reason: 'notification' });
    await expect(app.currentTitle).toHaveText(next);
    await expect.poll(() => app.ytState()).toBe(1);
    await expect.poll(() => lastUpdate(page)).toMatchObject({ title: next, state: 'playing' });
    // The first update for the new song starts at 0 (the clock still held the previous song's position)
    const firstForNext = (await pluginCalls(page)).find((c) => c.method === 'update' && c.options.title === next);
    expect(firstForNext?.options.positionMs).toBe(0);

    // "Pause" (a headset button, or headphones unplugged)
    await sendCommand(page, { action: 'pause', reason: 'noisy' });
    await expect.poll(() => app.ytState()).toBe(2);
    await expect.poll(() => lastUpdate(page)).toMatchObject({ title: next, state: 'paused' });
    await app.showControls();
    await expect(app.playButton).toBeVisible();

    // "Play" and a seek from the lock screen
    await sendCommand(page, { action: 'play', reason: 'session' });
    await expect.poll(() => app.ytState()).toBe(1);
    await sendCommand(page, { action: 'seekTo', positionMs: 42_000, reason: 'session' });
    await expect.poll(async () => (await app.yt())?.time ?? 0).toBeGreaterThan(41.5);
    await expect.poll(async () => Number((await lastUpdate(page))?.positionMs)).toBeGreaterThan(41_000);

    // Malformed commands are ignored
    await sendCommand(page, { action: 'explode' });
    await sendCommand(page, { action: 'seekTo', positionMs: 'soon' });
    await expect(app.currentTitle).toHaveText(next);
    expect((await pluginCalls(page)).filter((c) => c.method === 'stop')).toHaveLength(0);
  });

  test('a pause the YouTube player made itself is reported as such, and the plugin\'s one play resumes it', async ({ app, page }) => {
    await installShell(page, { platform: 'android', native: true });
    await app.open();
    const title = await playFirstResult(app, 'arijit singh');
    await expect.poll(() => lastUpdate(page)).toMatchObject({ title, state: 'playing' });
    expect((await lastUpdate(page))?.pausedBy).toBeUndefined();

    // The system pauses the hidden page's player (what Android did on Home before the WebView fix)
    await page.evaluate(() => (window as unknown as { __yt: { current: () => { __externalPause: () => void } } }).__yt.current().__externalPause());
    await expect.poll(() => lastUpdate(page)).toMatchObject({ title, state: 'paused', pausedBy: 'player' });

    // The plugin's guard answers with one play
    await sendCommand(page, { action: 'play', reason: 'systemPause' });
    await expect.poll(() => app.ytState()).toBe(1);
    await expect.poll(() => lastUpdate(page)).toMatchObject({ title, state: 'playing' });

    // The listener's own pause is never mistaken for it
    await app.showControls();
    await app.pauseButton.click();
    await expect.poll(() => lastUpdate(page)).toMatchObject({ title, state: 'paused', pausedBy: 'user' });
  });

  test('the app leaving the foreground saves the player (the page stays "visible" while music plays)', async ({ app, page }) => {
    await installShell(page, { platform: 'android', native: true });
    await app.open();
    await playFirstResult(app, 'arijit singh');
    await expect.poll(() => listenerCount(page, 'lifecycle')).toBe(1);
    await sendCommand(page, { action: 'seekTo', positionMs: 42_000, reason: 'session' });
    await sendCommand(page, { action: 'pause', reason: 'session' });
    await expect.poll(() => app.ytState()).toBe(2);
    await expect.poll(async () => (await savedPlayer(page))?.positionMs ?? 0).toBeGreaterThan(41_000);

    // `stop` (in the background) saves at once, inside the event; `resume` and malformed events do not
    expect(await savesOnLifecycle(page, 'resume'), 'resume does not save').toBe(false);
    expect(await savesOnLifecycle(page, 'explode'), 'malformed').toBe(false);
    expect(await savesOnLifecycle(page, 'stop')).toBe(true);
    expect((await savedPlayer(page))?.positionMs ?? 0).toBeGreaterThan(41_000);
    expect((await savedPlayer(page))?.activeTrackId).toBeTruthy();

    // And while playing, `pause` (leaving the foreground) saves at once too
    await sendCommand(page, { action: 'play', reason: 'session' });
    await expect.poll(() => app.ytState()).toBe(1);
    expect(await savesOnLifecycle(page, 'pause')).toBe(true);
  });

  test('the hidden debug log (long press on the version in Library) shows player, plugin and native events', async ({ app, page }) => {
    await installShell(page, { platform: 'android', native: true });
    await app.open();
    await playFirstResult(app, 'arijit singh');
    await sendCommand(page, { action: 'pause', reason: 'notification' });
    await expect.poll(() => app.ytState()).toBe(2);
    await firePluginEvent(page, 'lifecycle', { state: 'stop' });

    await app.goTo('Library');
    const version = app.main.getByTestId('app-version');
    await expect(version).toHaveText(/^Metrolist \d+\.\d+\.\d+/);
    // A short tap does nothing
    await version.click();
    await page.waitForTimeout(1000);
    expect(await app.hash()).toBe('#/library');
    const box = (await version.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1000);
    await page.mouse.up();
    await expect(app.heading).toHaveText('Debug log');
    expect(await app.hash()).toBe('#/debug');

    const log = app.main.getByRole('list', { name: 'Debug log entries' });
    await expect(log).toContainText('Command from the plugin: pause (notification)');
    await expect(log).toContainText('App lifecycle: stop');
    await expect(log).toContainText(/To the plugin: playing/);
    await expect(log).toContainText(/stream quality: tiny \(video /);
    await expect(log).toContainText(/player\s*Pause/);
    await expect(log).toContainText('Background-playback WebView active (simulated)');
    expect((await pluginCalls(page)).some((c) => c.method === 'getDebugLog')).toBe(true);
    // Newest first
    const first = await log.locator('li').first().textContent();
    expect(first).not.toContain('Background-playback WebView active');
  });

  test('the iOS shell mirrors the player into the same plugin and obeys its commands', async ({ app, page }) => {
    await installShell(page, { platform: 'ios', native: true });
    await app.open();
    const title = await playFirstResult(app, 'arijit singh');
    await expect.poll(() => lastUpdate(page)).toMatchObject({ title, state: 'playing' });
    await expect.poll(() => commandListenerCount(page)).toBe(1);
    expect(await listenerCount(page, 'lifecycle')).toBe(1);
    // The lock screen's pause
    await sendCommand(page, { action: 'pause', reason: 'session' });
    await expect.poll(() => app.ytState()).toBe(2);
    await expect.poll(() => lastUpdate(page)).toMatchObject({ title, state: 'paused', pausedBy: 'user' });
  });
});

test.describe('web build', () => {
  test.use({ baseURL: `http://localhost:${SERVER_PORT}` });

  test('a browser (even with a Capacitor-like global that is not native) never calls the plugin', async ({ app, page }) => {
    await installShell(page, { platform: 'web', native: false });
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await page.waitForTimeout(500);
    expect(await pluginCalls(page)).toEqual([]);
    expect(await commandListenerCount(page)).toBe(0);
    expect(await listenerCount(page, 'lifecycle')).toBe(0);
  });

  test('the debug log also works in a browser (no native lines)', async ({ app, page }) => {
    await installShell(page, { platform: 'web', native: false });
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await page.goto('/#/debug');
    await expect(app.heading).toHaveText('Debug log');
    const log = app.main.getByRole('list', { name: 'Debug log entries' });
    await expect(log).toContainText(/Song: /);
    await expect(app.main.getByRole('button', { name: 'Refresh' })).toHaveCount(0);
    expect(await pluginCalls(page)).toEqual([]);
  });
});
