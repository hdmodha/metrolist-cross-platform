/**
 * Shared Playwright fixture. Every test is hermetic:
 * - `/api/innertube/search`, `/api/innertube/recommendations` and `/api/innertube/embeddable` are
 *   answered from deterministic fixtures (each test may swap the handlers through `api`),
 * - `https://www.youtube.com/iframe_api` is the fake player (`fakeYouTube.ts`),
 * - artwork hosts get a tiny in-memory PNG, Google Fonts an empty stylesheet,
 * - ANY other external request is aborted and fails the test (an accidental live call is loud).
 * Page errors and console errors fail the test too.
 */
import { test as base, expect, type BrowserContext, type Locator, type Page, type Route } from '@playwright/test';
import { parseRoute } from '../../src/app/router';
import { isTabRoot, tabOf, type TabName } from '../../src/app/tabMemory';
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
  /** oEmbed verdict per video id (`/api/innertube/embeddable`); default: every video embeds. */
  embeddable: (videoId: string) => boolean | null;
  readonly searches: string[];
  readonly radioRequests: RadioRequest[];
  /** Every video id the app asked the embeddability check about. */
  readonly embeddableChecks: string[];
}

/** 1x1 transparent PNG. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
const IMAGE_HOSTS = /(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com)$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const YOUTUBE_API = 'https://www.youtube.com/iframe_api';

export function createMockApi(): MockApi {
  return {
    search: defaultSearch,
    recommendations: defaultRecommendations,
    embeddable: () => true,
    searches: [],
    radioRequests: [],
    embeddableChecks: [],
  };
}

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

/** Routes every request of `target` to the fixtures (a page in the Electron suite, `e2e-electron/`). */
export async function installRoutes(target: Pick<BrowserContext, 'route'>, api: MockApi, unexpected: string[]): Promise<void> {
  await target.route('**/*', async (route) => {
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
      if (url.pathname === '/api/innertube/embeddable') {
        const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
        (api.embeddableChecks as string[]).push(...ids);
        const results: Record<string, boolean | null> = {};
        for (const id of ids) results[id] = api.embeddable(id);
        return route.fulfill({ json: { results } });
      }
      return route.continue();
    }
    if (url.href.startsWith(YOUTUBE_API)) {
      return route.fulfill({ contentType: 'text/javascript', body: FAKE_YOUTUBE_IFRAME_API });
    }
    if (IMAGE_HOSTS.test(url.hostname)) return route.fulfill({ contentType: 'image/png', body: TINY_PNG });
    unexpected.push(url.href);
    return route.abort('blockedbyclient');
  });
}

const TAB_OF_LABEL: Record<'Home' | 'Search' | 'Library', TabName> = { Home: 'home', Search: 'search', Library: 'library' };

/** What `open({ storage })` writes to localStorage before the app first loads (raw strings). */
export type SeedStorage = Record<string, string>;

/**
 * Drives the app the way a listener does; all locators use accessible names the UI keeps stable.
 * Phones (< 1024 px) reach the transport controls in Now Playing; desktop in the player bar.
 */
export class MetrolistApp {
  constructor(readonly page: Page) {}

  async open(options: { yt?: FakeYouTubeOptions; renderProbe?: boolean; path?: string; storage?: SeedStorage } = {}): Promise<void> {
    await this.page.addInitScript(
      ({ yt, renderProbe, storage }) => {
        const w = window as unknown as { __yt?: unknown; __renderProbe?: Record<string, number> };
        if (yt) w.__yt = { ...yt };
        if (renderProbe) w.__renderProbe = {};
        // Seed storage once per tab: a reload must see what the app saved, not the seed again
        // (not on about:blank, which has no storage: Back out of the app lands there)
        if (storage && location.protocol.startsWith('http') && !sessionStorage.getItem('__e2eSeeded')) {
          sessionStorage.setItem('__e2eSeeded', '1');
          for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
        }
      },
      { yt: options.yt ?? null, renderProbe: !!options.renderProbe, storage: options.storage ?? null }
    );
    await this.page.goto(options.path ?? '/');
    await expect(this.main).toBeVisible();
  }

  get isDesktop(): boolean {
    return (this.page.viewportSize()?.width ?? 0) >= 1024;
  }

  /* ---------------------------------------- navigation ---------------------------------------- */

  get main(): Locator {
    return this.page.locator('main');
  }
  get nav(): Locator {
    return this.page.locator('nav[aria-label="Main"]:visible');
  }
  get heading(): Locator {
    return this.main.locator('h1');
  }
  tab(name: 'Home' | 'Search' | 'Library'): Locator {
    return this.nav.getByRole('link', { name, exact: true });
  }
  /** The tab the current location belongs to. */
  async currentTab(): Promise<TabName> {
    return tabOf(parseRoute(await this.hash()));
  }
  /** Presses a main tab: another tab returns to where it was left (its last page / query). */
  async goTo(name: 'Home' | 'Search' | 'Library'): Promise<void> {
    await this.closeNowPlaying();
    await this.tab(name).click();
    await expect.poll(() => this.currentTab()).toBe(TAB_OF_LABEL[name]);
    // (the desktop sidebar marks Liked Songs / Downloads with their own shortcut, not the tab)
    if (!this.isDesktop || isTabRoot(parseRoute(await this.hash()))) await expect(this.tab(name)).toHaveAttribute('aria-current', 'page');
  }
  /** The tab's root page (Home, the empty Search page, Your Library): pressed again if needed. */
  async goToRoot(name: 'Home' | 'Search' | 'Library'): Promise<void> {
    await this.goTo(name);
    if (isTabRoot(parseRoute(await this.hash()))) return;
    await this.tab(name).click();
    await expect.poll(async () => isTabRoot(parseRoute(await this.hash()))).toBe(true);
    await expect(this.tab(name)).toHaveAttribute('aria-current', 'page');
  }
  /** Opens Liked Songs / Downloads from the Library page. */
  async openCollection(name: 'Liked Songs' | 'Downloads'): Promise<void> {
    await this.goToRoot('Library');
    await this.main.getByRole('link', { name: new RegExp(`^${name}`) }).click();
    await expect(this.heading).toHaveText(name);
  }
  hash(): Promise<string> {
    return this.page.evaluate(() => location.hash);
  }

  /* ------------------------------------------ search ------------------------------------------ */

  get searchInput(): Locator {
    return this.page.locator('form[role="search"] input[type="search"]');
  }
  get results(): Locator {
    return this.page.locator('section[aria-label="Search results"]');
  }
  resultRows(): Locator {
    return this.results.locator('button[aria-label^="Play "], button[aria-label^="Pause "]');
  }
  /** Song buttons (rows or cards) inside `scope`. */
  songButtons(scope: Locator): Locator {
    return scope.locator('button[aria-label^="Play "], button[aria-label^="Pause "]');
  }
  async titleOf(songButton: Locator): Promise<string> {
    return ((await songButton.locator('.song-title').textContent()) ?? '').trim();
  }
  /** Lists of song titles (rows or cards) inside `scope`, in order. */
  titlesIn(scope: Locator): Promise<string[]> {
    return scope.locator('.song-title').allTextContents();
  }

  /** Types a query and submits it with Enter (the on-screen keyboard's Search key). */
  async search(query: string): Promise<void> {
    if (!(await this.searchInput.isVisible())) await this.goTo('Search');
    await this.searchInput.fill(query);
    await this.searchInput.press('Enter');
  }

  async searchAndPlayFirst(query: string): Promise<string> {
    await this.search(query);
    const first = this.resultRows().first();
    await expect(first).toBeVisible();
    const title = await this.titleOf(first);
    await first.click();
    await expect.poll(() => this.ytState()).toBe(1);
    return title;
  }

  /* ------------------------------------------ player ------------------------------------------ */

  get miniPlayer(): Locator {
    return this.page.locator('div[data-chrome="bottom"]').filter({ has: this.page.locator('[data-current-title]') });
  }
  get playerBar(): Locator {
    return this.page.locator('footer[aria-label="Player"]');
  }
  get nowPlaying(): Locator {
    return this.page.getByRole('dialog', { name: 'Now Playing' });
  }
  /** The title of the loaded song (mini player, player bar or Now Playing). */
  get currentTitle(): Locator {
    return this.page.locator('[data-current-title]:visible').last();
  }

  async openNowPlaying(): Promise<void> {
    if (await this.nowPlaying.isVisible()) return;
    await this.page.locator('button[aria-label="Open Now Playing"]:visible').click();
    await expect(this.nowPlaying).toBeVisible();
    // Wait for the slide-in to finish
    await expect.poll(() => this.nowPlaying.evaluate((el) => el.getAnimations().length)).toBe(0);
  }
  async closeNowPlaying(): Promise<void> {
    if (!(await this.nowPlaying.isVisible())) return;
    await this.nowPlaying.getByRole('button', { name: 'Close Now Playing' }).click();
    await expect(this.nowPlaying).toHaveCount(0);
  }
  /** Makes the transport controls reachable: the player bar on desktop, Now Playing on phones. */
  async showControls(): Promise<void> {
    if (!this.isDesktop) await this.openNowPlaying();
  }
  /** The top-most visible control with this accessible name (Now Playing covers the player bar). */
  control(name: string): Locator {
    return this.page.locator(`button[aria-label="${name}"]:visible`).last();
  }
  get playButton(): Locator {
    return this.control('Start Playback');
  }
  get pauseButton(): Locator {
    return this.control('Pause Playback');
  }
  get nextButton(): Locator {
    return this.control('Next Track');
  }
  get previousButton(): Locator {
    return this.control('Previous Track');
  }
  get shuffleButton(): Locator {
    return this.control('Shuffle');
  }
  get repeatButton(): Locator {
    return this.page.locator('button[aria-label^="Repeat: "]:visible').last();
  }
  get seekBar(): Locator {
    return this.page.locator('input[aria-label="Seek playback position"]:visible').last();
  }
  async seekValue(): Promise<number> {
    return Number(await this.seekBar.inputValue());
  }

  get queue(): Locator {
    return this.page.locator('section[aria-label="Queue"]');
  }
  /** Shows the queue (inside Now Playing). */
  async openQueue(): Promise<void> {
    if (await this.queue.isVisible()) return;
    if (this.isDesktop && !(await this.nowPlaying.isVisible())) {
      await this.playerBar.getByRole('button', { name: 'Queue', exact: true }).click();
    } else {
      await this.openNowPlaying();
      await this.nowPlaying.getByRole('button', { name: /^Up next/ }).click();
    }
    await expect(this.queue).toBeVisible();
  }
  /** Hides the queue again (on phones it covers the Now Playing controls). */
  async closeQueue(): Promise<void> {
    if (!(await this.queue.isVisible())) return;
    await this.queue.getByRole('button', { name: 'Close queue' }).click();
    await expect(this.queue).toHaveCount(0);
  }
  /** The current song and the upcoming ones, in play order. */
  queueTitles(): Promise<string[]> {
    return this.queue.locator('.song-title').allTextContents();
  }
  upcomingTitles(): Promise<string[]> {
    return this.queue.locator('ul[aria-label="Next up"] .song-title').allTextContents();
  }
  get autoplaySwitch(): Locator {
    return this.page.getByRole('switch', { name: /Autoplay similar songs/ });
  }
  get notice(): Locator {
    return this.page.locator('[role="status"][aria-live="polite"]');
  }
  get waitingBanner(): Locator {
    return this.page.getByText('Waiting for connection… retrying');
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

  /** Every video id any fake player was created with, loaded or cued, in order. */
  ytLoadedVideoIds(): Promise<string[]> {
    return this.page.evaluate(() => (window as unknown as { __yt?: { loaded?: string[] } }).__yt?.loaded ?? []);
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
    const api = createMockApi();
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
