/**
 * Pure decisions behind the player's side effects (`usePlayer.ts`), kept here so they are unit-tested:
 * how to recover from a stream error, when to wait for the network, when to save the position and
 * which keys are shortcuts.
 */
import { deriveSongSearchTerms } from '../utils/metrolistCore';
import type { Embeddability } from '../utils/embeddability';
import {
  selectActiveTrack,
  selectCanTryAlternateVideo,
  selectTriedVideoIds,
  selectUnplayableReason,
  selectUpcomingIds,
  type PlayerState,
  type StreamStatus,
} from './playerCore';
import { canRetryNetwork } from './retryPolicy';
import { classifyStreamError, type UnplayableReason } from './streamErrors';

/** Error code reported when the YouTube IFrame API script itself cannot be loaded (offline, blocked). */
export const STREAM_ERROR_API_UNAVAILABLE = -1;

export type StreamErrorPlan =
  | { kind: 'waitForNetwork' }
  /** Re-create the player for the same video once (`retried` tells whether that already happened). */
  | { kind: 'retry'; trackId: string; videoId: string; reason: UnplayableReason }
  | { kind: 'findAlternate'; trackId: string; videoId: string; query: string; tried: string[]; reason: UnplayableReason }
  | { kind: 'skip'; trackId: string; reason: UnplayableReason };

/**
 * The search query for other uploads of a song: "<artist> <title>", or the title alone when it is an
 * "A - B" title whose A is not the uploader (a re-upload: its uploader's name would spoil the search).
 */
export function alternateSearchQuery(track: { title: string; artist: string }): string {
  const terms = deriveSongSearchTerms(track.title, track.artist);
  if (terms.trackName.includes(' - ')) return terms.trackName;
  return `${terms.artistName} ${terms.trackName}`.trim();
}

/**
 * What to do when the stream of the active track reports an error (codes: `streamErrors.ts`).
 * `retried` = the player was already re-created once for this track's current video.
 * `videoId` = the video the error came from (the bridge tags it): an error of another video is a
 * late one, for the song (or upload) that was playing before a switch, and is ignored. Without a
 * video id (the player API itself failed) the error applies to whatever is active.
 */
export function planStreamErrorRecovery(
  state: PlayerState,
  error: { code: number; online: boolean; retried: boolean; videoId?: string }
): StreamErrorPlan | null {
  const track = selectActiveTrack(state);
  if (!track) return null;
  if (error.videoId !== undefined && error.videoId !== track.videoId) return null;
  if (error.code === STREAM_ERROR_API_UNAVAILABLE || !error.online) return { kind: 'waitForNetwork' };
  const { reason, recovery } = classifyStreamError(error.code);
  if (recovery !== 'alternate' && !error.retried) {
    return { kind: 'retry', trackId: track.id, videoId: track.videoId, reason };
  }
  if (recovery === 'retryThenSkip' || !selectCanTryAlternateVideo(state, track.id)) {
    return { kind: 'skip', trackId: track.id, reason };
  }
  return {
    kind: 'findAlternate',
    trackId: track.id,
    videoId: track.videoId,
    query: alternateSearchQuery(track),
    tried: selectTriedVideoIds(state, track.id),
    reason,
  };
}

/** Upcoming songs whose upload is checked ahead of time, besides the active one. */
export const EMBED_PRECHECK_UPCOMING = 3;

/** One song's current upload. */
export interface UploadRef {
  trackId: string;
  videoId: string;
}

/**
 * The uploads to check before they are reached: the active song, then the next 3 upcoming songs in
 * play order (with shuffle on, hand-queued songs first: they play first). Songs already known to be
 * unplayable are left out.
 */
export function selectEmbedCheckTargets(state: PlayerState, upcomingCount = EMBED_PRECHECK_UPCOMING): UploadRef[] {
  const active = selectActiveTrack(state);
  if (!active) return [];
  let upcoming = selectUpcomingIds(state);
  if (state.shuffleEnabled) {
    const queued = new Set(state.userQueuedIds);
    upcoming = [...upcoming.filter((id) => queued.has(id)), ...upcoming.filter((id) => !queued.has(id))];
  }
  const targets: UploadRef[] = [{ trackId: active.id, videoId: active.videoId }];
  for (const id of upcoming) {
    if (targets.length > upcomingCount) break;
    const track = state.tracksById[id];
    if (!track || selectUnplayableReason(state, id) !== null) continue;
    targets.push({ trackId: id, videoId: track.videoId });
  }
  return targets;
}

/**
 * `check`: uploads never checked and not being checked; `blocked`: targets known not to be
 * embeddable (their song needs another upload). `null` (inconclusive) counts as playable.
 */
export function planEmbedPrecheck(
  targets: readonly UploadRef[],
  known: (videoId: string) => Embeddability | undefined,
  pending: ReadonlySet<string>
): { check: string[]; blocked: UploadRef[] } {
  const check: string[] = [];
  const blocked: UploadRef[] = [];
  for (const target of targets) {
    const verdict = known(target.videoId);
    if (verdict === false) blocked.push(target);
    else if (verdict === undefined && !pending.has(target.videoId) && !check.includes(target.videoId)) {
      check.push(target.videoId);
    }
  }
  return { check, blocked };
}

/** How long a stream may sit in loading / buffering while offline before we wait for the network. */
export const STALL_BEFORE_WAITING_MS = 8000;

/**
 * A connectivity blip (Wi-Fi <-> mobile data hand-over, a tunnel) fires `offline` / `online` while
 * YouTube keeps playing from its buffer: that must not interrupt anything. Only a stream that the
 * listener wants to hear, stuck loading / buffering for 8 s while the device is offline, counts as
 * "waiting for the network" (besides an unloadable player API or a player error while offline, see
 * `planStreamErrorRecovery`).
 */
export function shouldWaitForNetworkAfterStall(options: {
  isPlaying: boolean;
  streamStatus: StreamStatus;
  stalledForMs: number;
  online: boolean;
}): boolean {
  const stalled = options.streamStatus === 'loading' || options.streamStatus === 'buffering';
  return options.isPlaying && stalled && !options.online && options.stalledForMs >= STALL_BEFORE_WAITING_MS;
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
