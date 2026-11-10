/**
 * Shared Playwright fixture. Every test is hermetic:
 * - `/api/innertube/search` and `/api/innertube/recommendations` are answered from deterministic
 *   fixtures (each test may swap the handlers through `api`),
 * - `https://www.youtube.com/iframe_api` is the fake player (`fakeYouTube.ts`),
 * - artwork hosts get a tiny in-memory PNG, Google Fonts an empty stylesheet,
 * - ANY other external request is aborted and fails the test (an accidental live call is loud).
 * Page errors and console errors fail the test too.
 */
import { test as base, expect, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test';
import type { InnerTubeParsedTrack } from '../../src/utils/metrolistCore';
import { fixtureVideoId, pageOfContinuation, radioPage, searchResultsFor } from './apiFixtures';
import { FAKE_YOUTUBE_IFRAME_API, type FakePlayerDebug, type FakeYouTubeOptions } from './fakeYouTube';

export { expect };

/** What a mocked `/api/innertube/*` route answers. */
export type ApiReply<T> = { body: T; delayMs?: number } | { fail: true };

export interface RecommendationsBody {
  seedVideoId: string;
  tracks: InnerTubeParsedTrack[];
  continuation: string | null;
}

export interface RadioRequest {
  videoId: string;
  title: string;
  continuation: string | null;
}

export interface MockApi {
  search: (query: string) => ApiReply<{ tracks: InnerTubeParsedTrack[] }>;
  recommendations: (request: RadioRequest) => ApiReply<RecommendationsBody>;
  readonly searches: string[];
  readonly radioRequests: RadioRequest[];
}

/** 1x1 transparent PNG. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const IMAGE_HOSTS = /(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com)$/;
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const YOUTUBE_API = 'https://www.youtube.com/iframe_api';

export function defaultSearch(query: string): ApiReply<{ tracks: InnerTubeParsedTrack[] }> {
  return { body: { tracks: searchResultsFor(query) } };
}

export function defaultRecommendations(request: RadioRequest): ApiReply<RecommendationsBody> {
  // Like the server: a seed track without a real video id gets a radio resolved from its title
  const seedVideoId = /^[A-Za-z0-9_-]{11}$/.test(request.videoId) ? request.videoId : fixtureVideoId(`title:${request.title}`);
  const page = request.continuation ? pageOfContinuation(request.continuation) : 1;
  return { body: { seedVideoId, ...radioPage(seedVideoId, page) } };
}

async function fulfillApi<T>(route: Route, reply: ApiReply<T>): Promise<void> {
  if ('fail' in reply) {
    await route.fulfill({ status: 502, json: { error: 'Upstream unavailable (test)' } });
    return;
  }
  if (reply.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
  await route.fulfill({ json: reply.body });
}

async function installRoutes(context: BrowserContext, api: MockApi, unexpected: string[]): Promise<void> {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (LOCAL_HOSTS.has(url.hostname)) {
      if (url.pathname === '/api/innertube/search') {
        const query = url.searchParams.get('q') ?? '';
        (api.searches as string[]).push(query);
        return fulfillApi(route, api.search(query));
      }
      if (url.pathname === '/api/innertube/recommendations') {
        const request: RadioRequest = {
          videoId: url.searchParams.get('videoId') ?? '',
          title: url.searchParams.get('title') ?? '',
          continuation: url.searchParams.get('continuation'),
        };
        (api.radioRequests as RadioRequest[]).push(request);
        return fulfillApi(route, api.recommendations(request));
      }
      return route.continue();
    }
    if (url.href.startsWith(YOUTUBE_API)) {
      return route.fulfill({ contentType: 'text/javascript', body: FAKE_YOUTUBE_IFRAME_API });
    }
    if (IMAGE_HOSTS.test(url.hostname)) return route.fulfill({ contentType: 'image/png', body: TINY_PNG });
    if (FONT_HOSTS.has(url.hostname)) return route.fulfill({ contentType: 'text/css', body: '' });
    unexpected.push(url.href);
    return route.abort('blockedbyclient');
  });
}

/** Drives the app the way a listener does; all locators use accessible names the UI keeps stable. */
export class MetrolistApp {
  constructor(readonly page: Page) {}

  async open(options: { yt?: FakeYouTubeOptions; renderProbe?: boolean; path?: string } = {}): Promise<void> {
    await this.page.addInitScript(
      ({ yt, renderProbe }) => {
        const w = window as unknown as { __yt?: unknown; __renderProbe?: Record<string, number> };
        if (yt) w.__yt = { ...yt };
        if (renderProbe) w.__renderProbe = {};
      },
      { yt: options.yt ?? null, renderProbe: !!options.renderProbe }
    );
    await this.page.goto(options.path ?? '/');
    await expect(this.footer).toBeVisible();
  }

  get footer(): Locator {
    return this.page.locator('footer[aria-label="Now Playing Audio Transport Bar"]');
  }
  get searchInput(): Locator {
    return this.page.locator('form[role="search"] input[type="search"]');
  }
  get results(): Locator {
    return this.page.locator('section[aria-label="Search results"]');
  }
  get featured(): Locator {
    return this.page.locator('section[aria-label="Featured songs"]');
  }
  get heroTitle(): Locator {
    return this.page.locator('h1');
  }
  get seekBar(): Locator {
    return this.page.locator('input[aria-label="Seek playback position"]:visible');
  }
  get playButton(): Locator {
    return this.page.locator('button[aria-label="Start Playback"]');
  }
  get pauseButton(): Locator {
    return this.page.locator('button[aria-label="Pause Playback"]');
  }
  get nextButton(): Locator {
    return this.page.locator('button[aria-label="Next Track"]');
  }
  get previousButton(): Locator {
    return this.page.locator('button[aria-label="Previous Track"]');
  }
  get drawer(): Locator {
    return this.page.locator('#inspector-drawer');
  }
  get notice(): Locator {
    return this.page.locator('[role="status"][aria-live="polite"]');
  }
  get waitingBanner(): Locator {
    return this.page.getByText('Waiting for connection… retrying');
  }
  get libraryRows(): Locator {
    return this.page.locator('[role="button"][aria-label^="Play "]');
  }
  resultCards(): Locator {
    return this.results.locator('button[aria-label^="Play "], button[aria-label^="Pause "]');
  }

  /** Types a query and submits it with Enter (the on-screen keyboard's Search key). */
  async search(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.searchInput.press('Enter');
  }

  async searchAndPlayFirst(query: string): Promise<string> {
    await this.search(query);
    const first = this.resultCards().first();
    await expect(first).toBeVisible();
    const title = (await first.locator('.font-semibold').textContent()) ?? '';
    await first.click();
    await expect.poll(() => this.ytState()).toBe(1);
    return title;
  }

  async openQueue(): Promise<void> {
    await this.drawer.getByRole('tab', { name: /Queue/ }).click();
  }

  /** Titles in the queue drawer, in play order. */
  queueTitles(): Promise<string[]> {
    return this.drawer
      .locator('[aria-label^="Play "], [aria-label^="Now playing "]')
      .evaluateAll((els) => els.map((el) => el.querySelector('.font-semibold')?.textContent ?? ''));
  }

  async upcomingTitles(): Promise<string[]> {
    const titles = await this.queueTitles();
    const current = await this.heroTitle.textContent();
    return titles.slice(titles.indexOf(current ?? '') + 1);
  }

  /** Opens the n-th "More options" menu inside `scope`, picks `item`, returns the track title. */
  async chooseFromTrackMenu(scope: Locator, index: number, item: string): Promise<string> {
    const trigger = scope.locator('button[aria-label^="More options for "]').nth(index);
    const title = ((await trigger.getAttribute('aria-label')) ?? '').replace(/^More options for /, '');
    await trigger.click();
    await this.page.getByRole('menuitem', { name: item, exact: true }).click();
    await expect(this.page.getByRole('menu')).toHaveCount(0);
    return title;
  }

  async seekValue(): Promise<number> {
    return Number(await this.seekBar.inputValue());
  }

  yt(): Promise<FakePlayerDebug | null> {
    return this.page.evaluate(() => {
      const ctl = (window as unknown as { __yt?: { current?: () => { __debug: () => FakePlayerDebug } | undefined } }).__yt;
      const player = ctl?.current?.();
      return player ? player.__debug() : null;
    });
  }

  async ytState(): Promise<number | null> {
    return (await this.yt())?.state ?? null;
  }

  ytInstanceCount(): Promise<number> {
    return this.page.evaluate(() => (window as unknown as { __yt?: { instances?: unknown[] } }).__yt?.instances?.length ?? 0);
  }

  /** Runs `action(player, window.__yt)` on the newest fake player inside the page. */
  ytDo(action: 'endSong' | 'seekTo' | 'userTap' | 'externalPause' | 'stall' | 'reloadSameVideo', arg?: string): Promise<void> {
    return this.page.evaluate(
      ([what, extra]) => {
        type P = {
          seekTo: (s: number) => void;
          getDuration: () => number;
          __userTap: () => void;
          __externalPause: () => void;
          __stall: () => void;
          loadVideoById: (id: string) => void;
          __debug: () => { videoId: string };
        };
        const ctl = (window as unknown as { __yt: { current: () => P; errorIds: string[] } }).__yt;
        const player = ctl.current();
        if (what === 'endSong') player.seekTo(player.getDuration() - 0.3);
        if (what === 'seekTo') player.seekTo(Number(extra));
        if (what === 'userTap') player.__userTap();
        if (what === 'externalPause') player.__externalPause();
        if (what === 'stall') player.__stall();
        if (what === 'reloadSameVideo') {
          if (extra) ctl.errorIds.push(extra);
          player.loadVideoById(player.__debug().videoId);
        }
      },
      [action, arg ?? ''] as const
    );
  }

  /** Marks video ids as unplayable (error 150). */
  failVideos(ids: string[]): Promise<void> {
    return this.page.evaluate((list) => {
      (window as unknown as { __yt: { errorIds: string[] } }).__yt.errorIds.push(...list);
    }, ids);
  }
}

interface Fixtures {
  api: MockApi;
  app: MetrolistApp;
  /** External requests the routes did not expect (the test fails when non-empty). */
  unexpectedRequests: string[];
  /** Page errors and console errors (the test fails when non-empty). */
  pageErrors: string[];
}

export const test = base.extend<Fixtures>({
  unexpectedRequests: async ({}, use) => {
    const list: string[] = [];
    await use(list);
    expect(list, 'external requests must all be routed to fixtures').toEqual([]);
  },
  api: async ({ context, unexpectedRequests }, use) => {
    const api: MockApi = { search: defaultSearch, recommendations: defaultRecommendations, searches: [], radioRequests: [] };
    await installRoutes(context, api, unexpectedRequests);
    await use(api);
  },
  pageErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) errors.push(`console: ${m.text()}`);
    });
    await use(errors);
    expect(errors, 'no runtime errors in the page').toEqual([]);
  },
  app: async ({ page, api, pageErrors }, use) => {
    void api;
    void pageErrors;
    await use(new MetrolistApp(page));
  },
});
