/**
 * Pure rules that tie the full-screen Now Playing view to the browser / Android Back button.
 * Opening pushes one history entry flagged `nowPlaying` (same URL); Back pops it and closes the
 * view; closing it in the UI removes the entry again (`history.back()`), so no stale entry is left.
 */
export interface NowPlayingHistory {
  open: boolean;
  /** Our flagged entry is the current history entry. */
  entryPushed: boolean;
}

export const INITIAL_NOW_PLAYING: NowPlayingHistory = { open: false, entryPushed: false };

export type NowPlayingEvent =
  | { type: 'open' }
  /** Chevron, Escape or swipe-down. */
  | { type: 'close' }
  /** Back / Forward; `flagged` = the entry we arrived at carries our flag. */
  | { type: 'popstate'; flagged: boolean }
  /** The listener goes to another page from inside Now Playing (e.g. "Go to artist"). */
  | { type: 'navigate' }
  /** App start: `flagged` = the page was reloaded on our entry. */
  | { type: 'boot'; flagged: boolean; canOpen: boolean };

/**
 * - `push`: `history.pushState({ nowPlaying: true }, '', sameUrl)`
 * - `back`: `history.back()` (removes our entry)
 * - `replace`: the caller's navigation must replace the current entry instead of pushing
 * - `clearFlag`: `history.replaceState` without our flag
 */
export type NowPlayingEffect = 'push' | 'back' | 'replace' | 'clearFlag' | null;

const OPENED: NowPlayingHistory = { open: true, entryPushed: true };

export function nowPlayingStep(
  state: NowPlayingHistory,
  event: NowPlayingEvent
): { state: NowPlayingHistory; effect: NowPlayingEffect } {
  switch (event.type) {
    case 'open':
      return state.open ? { state, effect: null } : { state: OPENED, effect: state.entryPushed ? null : 'push' };
    case 'close':
      if (!state.open) return { state, effect: null };
      return { state: INITIAL_NOW_PLAYING, effect: state.entryPushed ? 'back' : null };
    case 'popstate':
      if (event.flagged) return { state: OPENED, effect: null };
      return { state: INITIAL_NOW_PLAYING, effect: null };
    case 'navigate':
      return { state: INITIAL_NOW_PLAYING, effect: state.entryPushed ? 'replace' : null };
    case 'boot':
      if (!event.flagged) return { state, effect: null };
      return event.canOpen ? { state: OPENED, effect: null } : { state: INITIAL_NOW_PLAYING, effect: 'clearFlag' };
  }
}
