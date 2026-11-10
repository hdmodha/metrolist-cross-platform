/**
 * The packaged Android / iOS app: static files only (no `/api` backend) and Capacitor's native HTTP
 * bridge. The bridge is simulated; it answers with InnerTube-shaped fixtures, so the app's real
 * InnerTube request layer and parsers run.
 */
import { fixtureVideoId, innerTubeNextJson, innerTubeSearchJson, searchResultsFor } from './fixtures/apiFixtures';
import { STATIC_PORT } from './fixtures/ports';
import { expect, test } from './fixtures/test';

interface NativeRequest {
  url: string;
  method: string;
  data: { query?: string; params?: string; videoId?: string; continuation?: string };
}

test.use({ baseURL: `http://localhost:${STATIC_PORT}` });

/** Every song gets the same radio, so its continuation pages are easy to recognize. */
const RADIO_SEED = fixtureVideoId('native-radio-seed');

test.describe('packaged app without a backend', () => {
  test('search, playback and endless radio go straight to YouTube Music through the native bridge', async ({ app, page }) => {
    const calls: NativeRequest[] = [];
    const apiCalls: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/')) apiCalls.push(r.url());
    });
    await page.exposeFunction('__nativeHttp', (plugin: string, method: string, options: NativeRequest) => {
      expect(`${plugin}.${method}`).toBe('CapacitorHttp.request');
      calls.push(options);
      const endpoint = new URL(options.url).pathname;
      if (endpoint === '/youtubei/v1/search') {
        return { status: 200, data: innerTubeSearchJson(searchResultsFor(options.data.query ?? '')) };
      }
      if (endpoint === '/youtubei/v1/next') {
        return { status: 200, data: innerTubeNextJson(RADIO_SEED, options.data.continuation) };
      }
      return { status: 404, data: {} };
    });
    await page.addInitScript(() => {
      const w = window as unknown as {
        Capacitor: unknown;
        __nativeHttp: (plugin: string, method: string, options: unknown) => Promise<unknown>;
      };
      w.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        nativePromise: (plugin: string, method: string, options: unknown) => w.__nativeHttp(plugin, method, options),
      };
    });

    await app.open();
    await expect(app.featured.locator('h2')).toHaveText('Daft Punk Essentials');
    await app.search('arijit singh');
    await expect(app.resultCards()).toHaveCount(12);
    await expect(app.resultCards().first()).toContainText('Arijit Singh');
    expect(calls.some((c) => c.method === 'POST' && c.url === 'https://music.youtube.com/youtubei/v1/search?prettyPrint=false')).toBe(true);

    await app.resultCards().first().click();
    await expect.poll(() => app.ytState()).toBe(1);
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBe(10);
    expect(calls.some((c) => c.url.includes('/youtubei/v1/next') && !c.data.continuation)).toBe(true);

    // Jump near the end of the radio: the next page is fetched with its continuation token
    await app.drawer.locator('[aria-label^="Play "]').nth(6).click();
    await expect.poll(() => calls.filter((c) => c.url.includes('/youtubei/v1/next') && !!c.data.continuation).length).toBeGreaterThan(0);
    await expect.poll(async () => (await app.queueTitles()).filter((t) => / P2-/.test(t)).length).toBeGreaterThan(0);

    expect(apiCalls, 'no request is wasted on a backend that is not there').toEqual([]);
  });
});
