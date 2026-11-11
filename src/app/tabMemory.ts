/**
 * Pure rules for "state in between the screens" (Spotify-like tabs):
 * - every tab (Home, Search, Library) remembers its last location; switching back returns there,
 *   tapping the tab you are on goes to its root (or, at the root, to the top);
 * - every location (route + query) remembers its vertical scroll offset and the horizontal offsets
 *   of its shelves, in a bounded store;
 * - how a navigation treats the scroll position (restore / top / keep), and one restore step;
 * - the session copy (`sessionStorage`), validated field by field when read back.
 *
 * No DOM, no clock: the browser glue lives in `navigationMemory.ts`.
 */
import { formatRoute, parseRoute, type NavigationIntent, type Route } from './router';

/* ---------------------------------------- tab memory ---------------------------------------- */

export type TabName = 'home' | 'search' | 'library';

export const TAB_NAMES: readonly TabName[] = ['home', 'search', 'library'];

export const TAB_ROOTS: Readonly<Record<TabName, Route>> = {
  home: { name: 'home' },
  search: { name: 'search', query: '' },
  library: { name: 'library' },
};

/** The tab a route belongs to (Liked Songs and Downloads are Library pages). */
export function tabOf(route: Route): TabName {
  switch (route.name) {
    case 'search':
      return 'search';
    case 'library':
    case 'liked':
    case 'downloads':
      return 'library';
    default:
      return 'home';
  }
}

export function isTabRoot(route: Route): boolean {
  return formatRoute(route) === formatRoute(TAB_ROOTS[tabOf(route)]);
}

/** The last location shown in each tab. */
export type TabMemory = Readonly<Record<TabName, Route>>;

export const INITIAL_TAB_MEMORY: TabMemory = TAB_ROOTS;

/** Records `route` as its tab's last location (the same object when nothing changes). */
export function rememberRoute(memory: TabMemory, route: Route): TabMemory {
  const tab = tabOf(route);
  if (formatRoute(memory[tab]) === formatRoute(route)) return memory;
  return { ...memory, [tab]: route };
}

/**
 * What a press on a tab does:
 * - `switch`: another tab → its last location (scroll restored);
 * - `root`: the current tab, away from its root → the root, at the top;
 * - `top`: the current tab at its root → scroll to the top (nothing else changes).
 */
export type TabPress = { kind: 'switch'; to: Route } | { kind: 'root'; to: Route } | { kind: 'top' };

export function planTabPress(memory: TabMemory, current: Route, tab: TabName): TabPress {
  if (tabOf(current) !== tab) return { kind: 'switch', to: memory[tab] };
  return isTabRoot(current) ? { kind: 'top' } : { kind: 'root', to: TAB_ROOTS[tab] };
}

/** Where a press on `tab` leads (the tab link's `href`). */
export function tabTarget(memory: TabMemory, current: Route, tab: TabName): Route {
  const press = planTabPress(memory, current, tab);
  return press.kind === 'top' ? TAB_ROOTS[tab] : press.to;
}

/* -------------------------------------- scroll positions ------------------------------------- */

/** A location's scroll offsets: the page (`y`) and its horizontal shelves by id (`x`). */
export interface ScrollSnapshot {
  readonly y: number;
  readonly x: Readonly<Record<string, number>>;
}

export const MAX_SCROLL_LOCATIONS = 50;
export const MAX_SCROLLERS_PER_LOCATION = 8;
/** Larger offsets are treated as corrupt. */
const MAX_OFFSET = 1_000_000;
const MAX_SCROLLER_ID_LENGTH = 32;

/** A shelf id: 1–32 of `a-z 0-9 -` (checked with a loop; it also ends up in a CSS selector). */
export function isScrollerId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_SCROLLER_ID_LENGTH) return false;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    const ok = (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45;
    if (!ok) return false;
  }
  return true;
}

function toOffset(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_OFFSET) return null;
  return Math.round(value);
}

/** The key a location's scroll offsets are stored under: its canonical URL (`#/search?q=…`). */
export function locationKey(route: Route): string {
  return formatRoute(route);
}

function isLocationKey(key: unknown): key is string {
  return typeof key === 'string' && formatRoute(parseRoute(key)) === key;
}

/**
 * Scroll offsets per location, least recently used first; at most `MAX_SCROLL_LOCATIONS`
 * locations and `MAX_SCROLLERS_PER_LOCATION` shelves each.
 */
export class ScrollMemory {
  private readonly entries = new Map<string, ScrollSnapshot>();

  get size(): number {
    return this.entries.size;
  }

  get(key: string): ScrollSnapshot | undefined {
    return this.entries.get(key);
  }

  setY(key: string, y: number): void {
    const offset = toOffset(y);
    if (offset === null) return;
    const previous = this.entries.get(key);
    if (previous && previous.y === offset) return;
    this.put(key, { y: offset, x: previous?.x ?? {} });
  }

  setX(key: string, id: string, x: number): void {
    const offset = toOffset(x);
    if (offset === null || !isScrollerId(id)) return;
    const previous = this.entries.get(key);
    if (previous && previous.x[id] === offset) return;
    const shelves: Record<string, number> = { ...(previous?.x ?? {}) };
    delete shelves[id];
    const ids = Object.keys(shelves);
    // Oldest shelf first out (insertion order)
    for (let i = 0; i <= ids.length - MAX_SCROLLERS_PER_LOCATION; i++) delete shelves[ids[i]];
    shelves[id] = offset;
    this.put(key, { y: previous?.y ?? 0, x: shelves });
  }

  forget(key: string): void {
    this.entries.delete(key);
  }

  /** Oldest first. */
  list(): Array<[string, ScrollSnapshot]> {
    return [...this.entries.entries()];
  }

  /** Replaces everything with `entries` (oldest first), keeping the newest that fit. */
  load(entries: ReadonlyArray<readonly [string, ScrollSnapshot]>): void {
    this.entries.clear();
    for (const [key, snapshot] of entries.slice(-MAX_SCROLL_LOCATIONS)) this.entries.set(key, snapshot);
  }

  private put(key: string, snapshot: ScrollSnapshot): void {
    this.entries.delete(key);
    while (this.entries.size >= MAX_SCROLL_LOCATIONS) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, snapshot);
  }
}

/* --------------------------------------- restore rules --------------------------------------- */

/**
 * What arriving at a location does to the scroll position:
 * - Back / Forward (`pop`), a tab switch or the desktop library shortcuts (`tab`) and a reload
 *   (`boot`) restore what the location last had (nothing saved → the top);
 * - following a link (`push`) and re-tapping a tab (`retap`) start at the top: a fresh visit;
 * - refining a search (`replace`) leaves the page where it is.
 */
export type ScrollPlan = { kind: 'top' } | { kind: 'keep' } | { kind: 'restore'; snapshot: ScrollSnapshot };

export function planScroll(intent: NavigationIntent, saved: ScrollSnapshot | undefined): ScrollPlan {
  switch (intent) {
    case 'replace':
      return { kind: 'keep' };
    case 'push':
    case 'retap':
      return { kind: 'top' };
    default:
      return saved && (saved.y > 0 || Object.values(saved.x).some((x) => x > 0)) ? { kind: 'restore', snapshot: saved } : { kind: 'top' };
  }
}

/** A fresh visit forgets what the location had (its shelves start at the left too). */
export function forgetsSaved(intent: NavigationIntent): boolean {
  return intent === 'push' || intent === 'retap';
}

/** Content can arrive after the page mounts (search results, recommendations); wait this long. */
export const RESTORE_TIMEOUT_MS = 4000;

/**
 * One restore attempt: scroll as far towards `target` as the content allows now (`max` = the
 * largest offset possible), and stop once it is reached or the time is up.
 */
export function restoreStep(target: number, max: number, elapsedMs: number): { scrollTo: number; done: boolean } {
  const reachable = Math.max(0, max);
  return { scrollTo: Math.min(target, reachable), done: reachable >= target - 1 || elapsedMs >= RESTORE_TIMEOUT_MS };
}

/* ------------------------------------- the session copy -------------------------------------- */

export const NAVIGATION_STORAGE_KEY = 'metrolist.navigation.v1';

export interface NavigationMemorySnapshot {
  tabs: TabMemory;
  scroll: Array<[string, ScrollSnapshot]>;
}

export function serializeNavigationMemory(tabs: TabMemory, scroll: ReadonlyArray<readonly [string, ScrollSnapshot]>): string {
  return JSON.stringify({
    version: 1,
    tabs: { home: formatRoute(tabs.home), search: formatRoute(tabs.search), library: formatRoute(tabs.library) },
    scroll: scroll.slice(-MAX_SCROLL_LOCATIONS).map(([key, s]) => [key, s.y, s.x]),
  });
}

function parseShelves(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const shelves: Record<string, number> = {};
  let count = 0;
  for (const [id, value] of Object.entries(raw)) {
    const offset = toOffset(value);
    if (!isScrollerId(id) || offset === null) continue;
    if (++count > MAX_SCROLLERS_PER_LOCATION) break;
    shelves[id] = offset;
  }
  return shelves;
}

/** Reads the session copy back; anything invalid is dropped (all of it when the shape is wrong). */
export function parseNavigationMemory(raw: string | null): NavigationMemorySnapshot | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const { version, tabs, scroll } = data as { version?: unknown; tabs?: unknown; scroll?: unknown };
  if (version !== 1 || !tabs || typeof tabs !== 'object' || !Array.isArray(scroll)) return null;

  const memory: Record<TabName, Route> = { ...INITIAL_TAB_MEMORY };
  for (const tab of TAB_NAMES) {
    const hash = (tabs as Record<string, unknown>)[tab];
    if (!isLocationKey(hash)) continue;
    const route = parseRoute(hash);
    if (tabOf(route) === tab) memory[tab] = route;
  }

  const entries: Array<[string, ScrollSnapshot]> = [];
  for (const item of scroll.slice(-MAX_SCROLL_LOCATIONS)) {
    if (!Array.isArray(item) || item.length !== 3) continue;
    const [key, y, x] = item as unknown[];
    const offset = toOffset(y);
    const shelves = parseShelves(x);
    if (!isLocationKey(key) || offset === null || shelves === null) continue;
    entries.push([key, { y: offset, x: shelves }]);
  }
  return { tabs: memory, scroll: entries };
}
