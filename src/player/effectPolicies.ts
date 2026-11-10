/**
 * Pure decisions behind the player's side effects (`usePlayer.ts`), kept here so they are unit-tested:
 * how to recover from a stream error, when to save the position, which keys are shortcuts and how
 * the Back button interacts with the search.
 */
import { deriveSongSearchTerms, type InnerTubeParsedTrack } from '../utils/metrolistCore';
import {
  selectActiveTrack,
  selectCanTryAlternateVideo,
  selectTriedVideoIds,
  type PlayerState,
  type StreamStatus,
} from './playerCore';
import { canRetryNetwork } from './retryPolicy';

/** Error code reported when the YouTube IFrame API script itself cannot be loaded (offline, blocked). */
export const STREAM_ERROR_API_UNAVAILABLE = -1;

export type StreamErrorPlan =
  | { kind: 'waitForNetwork' }
  | { kind: 'findAlternate'; trackId: string; query: string; tried: string[] }
  | { kind: 'skip'; trackId: string };

/** What to do when the stream of the active track reports an error. */
export function planStreamErrorRecovery(
  state: PlayerState,
  error: { code: number; online: boolean }
): StreamErrorPlan | null {
  const track = selectActiveTrack(state);
  if (!track) return null;
  if (error.code === STREAM_ERROR_API_UNAVAILABLE || !error.online) return { kind: 'waitForNetwork' };
  if (!selectCanTryAlternateVideo(state, track.id)) return { kind: 'skip', trackId: track.id };
  const terms = deriveSongSearchTerms(track.title, track.artist);
  return {
    kind: 'findAlternate',
    trackId: track.id,
    query: `${terms.artistName} ${terms.trackName}`.trim(),
    tried: selectTriedVideoIds(state, track.id),
  };
}

/** Another upload of the same song: the first search result that has not been tried yet. */
export function pickAlternateUpload(
  candidates: InnerTubeParsedTrack[],
  tried: string[]
): InnerTubeParsedTrack | null {
  return candidates.find((c) => !tried.includes(c.videoId)) ?? null;
}

/** How long a live stream may sit in loading / buffering while offline before we wait for the network. */
export const STALL_BEFORE_WAITING_MS = 8000;

/**
 * A connectivity blip (Wi-Fi <-> mobile data hand-over, a tunnel) fires `offline` / `online` while
 * YouTube keeps playing from its buffer: that must not interrupt anything. Only a live stream that the
 * listener wants to hear, stuck loading / buffering for 8 s while the device is offline, counts as
 * "waiting for the network" (besides an unloadable player API or a player error while offline, see
 * `planStreamErrorRecovery`).
 */
export function shouldWaitForNetworkAfterStall(options: {
  isPlaying: boolean;
  isLive: boolean;
  streamStatus: StreamStatus;
  stalledForMs: number;
  online: boolean;
}): boolean {
  const stalled = options.streamStatus === 'loading' || options.streamStatus === 'buffering';
  return (
    options.isPlaying && options.isLive && stalled && !options.online && options.stalledForMs >= STALL_BEFORE_WAITING_MS
  );
}

/**
 * What a network retry (back-off timer or the `online` event) does: nothing when not waiting;
 * `restored` when the stream plays again on its own (it is never re-created); otherwise `retry`
 * (re-create the stream) until the retry budget is spent, then `giveUp`.
 */
export function planNetworkRetry(options: {
  waiting: boolean;
  streamStatus: StreamStatus;
  retryAttempt: number;
}): 'restored' | 'retry' | 'giveUp' | null {
  if (!options.waiting) return null;
  if (options.streamStatus === 'playing') return 'restored';
  return canRetryNetwork(options.retryAttempt) ? 'retry' : 'giveUp';
}

export const POSITION_SAVE_INTERVAL_MS = 5000;

/** While playing, the position is written to storage at most every 5 seconds. */
export function isPositionSaveDue(lastSavedAtMs: number | null, nowMs: number): boolean {
  if (lastSavedAtMs === null || nowMs < lastSavedAtMs) return true;
  return nowMs - lastSavedAtMs >= POSITION_SAVE_INTERVAL_MS;
}

export const KEYBOARD_SEEK_STEP_MS = 5000;

export type ShortcutCommand = 'togglePlay' | 'seekForward' | 'seekBackward';

/**
 * Desktop shortcuts: Space = play / pause, ← / → = seek 5 s. Never while focus is in a text field,
 * on a button / link / menu (they handle these keys themselves) or with a modifier key held.
 */
export function shortcutForKey(
  event: {
    key: string;
    code?: string;
    ctrlKey: boolean;
    metaKey: boolean;
    altKey: boolean;
    defaultPrevented: boolean;
  },
  targetIsInteractive: boolean
): ShortcutCommand | null {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || targetIsInteractive) {
    return null;
  }
  if (event.key === ' ' || event.key === 'Spacebar' || event.code === 'Space') return 'togglePlay';
  if (event.key === 'ArrowRight') return 'seekForward';
  if (event.key === 'ArrowLeft') return 'seekBackward';
  return null;
}

export interface SearchHistoryState {
  /** A history entry for the search screen is on the stack. */
  entryPushed: boolean;
}

export type SearchHistoryEvent =
  | { type: 'searchModeChanged'; inSearch: boolean }
  /** The browser / Android Back button popped a history entry. */
  | { type: 'popstate' };

/**
 * Hardware / browser Back while searching clears the search instead of leaving the app. Entering
 * search pushes exactly one entry; clearing the search in the UI removes it again; Back without a
 * search is never intercepted.
 */
export function searchHistoryStep(
  state: SearchHistoryState,
  event: SearchHistoryEvent
): { state: SearchHistoryState; effect: 'push' | 'back' | 'clearSearch' | null } {
  if (event.type === 'popstate') {
    return state.entryPushed
      ? { state: { entryPushed: false }, effect: 'clearSearch' }
      : { state, effect: null };
  }
  if (event.inSearch && !state.entryPushed) return { state: { entryPushed: true }, effect: 'push' };
  if (!event.inSearch && state.entryPushed) return { state: { entryPushed: false }, effect: 'back' };
  return { state, effect: null };
}
