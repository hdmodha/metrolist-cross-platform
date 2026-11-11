/**
 * A tiny hash router (no dependency): `#/`, `#/search?q=…`, `#/library`, `#/library/liked`,
 * `#/library/downloads`. Hash routes work unchanged in the Capacitor WebView, on static hosts and in
 * the desktop bundles, and need no server fallback. Unknown routes fall back to Home.
 *
 * `parseRoute` / `formatRoute` are pure; `navigate` and `subscribeToLocation` wrap the History API.
 */

export type Route =
  | { name: 'home' }
  | { name: 'search'; query: string }
  | { name: 'library' }
  | { name: 'liked' }
  | { name: 'downloads' };

export type RouteName = Route['name'];

export const MAX_ROUTE_QUERY_LENGTH = 200;

export function parseRoute(hash: string): Route {
  let rest = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!rest.startsWith('/')) rest = `/${rest}`;
  const queryStart = rest.indexOf('?');
  let path = queryStart === -1 ? rest : rest.slice(0, queryStart);
  const search = queryStart === -1 ? '' : rest.slice(queryStart + 1);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

  switch (path) {
    case '/':
      return { name: 'home' };
    case '/search': {
      // URLSearchParams decodes leniently: a malformed escape never throws
      const query = (new URLSearchParams(search).get('q') ?? '').trim().slice(0, MAX_ROUTE_QUERY_LENGTH).trim();
      return { name: 'search', query };
    }
    case '/library':
      return { name: 'library' };
    case '/library/liked':
      return { name: 'liked' };
    case '/library/downloads':
      return { name: 'downloads' };
    default:
      return { name: 'home' };
  }
}

export function formatRoute(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'search': {
      const query = route.query.trim();
      return query ? `#/search?q=${encodeURIComponent(query)}` : '#/search';
    }
    case 'library':
      return '#/library';
    case 'liked':
      return '#/library/liked';
    case 'downloads':
      return '#/library/downloads';
  }
}

export function isSameRoute(a: Route, b: Route): boolean {
  return formatRoute(a) === formatRoute(b);
}

/**
 * What going to `to` does to the history when the location is `currentHash`: nothing when it is
 * already shown; a replace when the same page is shown under another URL (a fresh start has no hash
 * yet, an unknown route shows Home), so Back never lands on the same page again; else a push.
 */
export function navigationEffect(to: Route, currentHash: string): 'none' | 'replace' | 'push' {
  if (formatRoute(to) === currentHash) return 'none';
  return isSameRoute(parseRoute(currentHash), to) ? 'replace' : 'push';
}

/* ------------------------------------ browser location -------------------------------------- */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

/**
 * Why the location last changed, for the scroll rules in `tabMemory.ts`: `push` (a link),
 * `replace` (refining a search), `pop` (Back / Forward), `tab` (a tab switch or a desktop library
 * shortcut), `retap` (the current tab pressed again) or `boot` (the app started on it).
 */
export type NavigationIntent = 'boot' | 'push' | 'replace' | 'pop' | 'tab' | 'retap';

let lastNavigation: { hash: string; intent: NavigationIntent } | null = null;
/** The intent of the Back the app itself triggers next (`backAs`). */
let nextPopIntent: NavigationIntent | null = null;

function onPopState(): void {
  lastNavigation = { hash: currentHash(), intent: nextPopIntent ?? 'pop' };
  nextPopIntent = null;
  notify();
}

/** The intent of the navigation that led to `hash` (anything the app did not start counts as `pop`). */
export function navigationIntentFor(hash: string): NavigationIntent {
  return lastNavigation && lastNavigation.hash === hash ? lastNavigation.intent : 'pop';
}

/** `history.back()`, with the arrival treated as `intent` (e.g. a re-tap that goes back over an entry). */
export function backAs(intent: NavigationIntent): void {
  nextPopIntent = intent;
  window.history.back();
}

/** Calls `listener` whenever the route may have changed (hash change, Back / Forward, `navigate`). */
export function subscribeToLocation(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('hashchange', notify);
    window.addEventListener('popstate', onPopState);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('hashchange', notify);
      window.removeEventListener('popstate', onPopState);
    }
  };
}

export function currentHash(): string {
  return typeof window === 'undefined' ? '' : window.location.hash;
}

/** Our flags in `history.state` (the search entry pushed from the empty Search page, Now Playing). */
export interface HistoryFlags {
  searchFromEmpty?: boolean;
  nowPlaying?: boolean;
}

export function historyFlags(): HistoryFlags {
  const state: unknown = typeof window === 'undefined' ? null : window.history.state;
  return state && typeof state === 'object' ? (state as HistoryFlags) : {};
}

/**
 * Goes to `route`. A push creates one history entry; `replace` swaps the current entry (typing in
 * the search box, leaving Now Playing). `flags` are stored on the entry. `intent` (default: `replace`
 * or `push`) tells the scroll rules what kind of visit this is; they scroll, not this function.
 */
export function navigate(
  route: Route,
  options: { replace?: boolean; flags?: HistoryFlags; intent?: NavigationIntent } = {}
): void {
  const url = formatRoute(route);
  const flags = options.flags ?? null;
  const effect = options.replace || flags ? null : navigationEffect(route, window.location.hash);
  if (effect === 'none') return;
  nextPopIntent = null;
  lastNavigation = { hash: url, intent: options.intent ?? (options.replace ? 'replace' : 'push') };
  if (options.replace || effect === 'replace') {
    window.history.replaceState(options.replace ? flags : historyFlags(), '', url);
  } else {
    window.history.pushState(flags, '', url);
  }
  notify();
}
