/**
 * Pure player core: a normalized state, a reducer and selectors for playback, the queue, the
 * autoplay radio and network back-off. No React, no DOM, no timers and no hidden clock or
 * randomness: anything time- or chance-dependent arrives through action payloads.
 *
 * The playback model follows the ideas of the Android app Metrolist (paged radio queue that loads
 * more when it runs low, "play next" vs "add to queue", resumable queue, retry with back-off).
 */
import type { MetrolistTrack } from '../data/metrolistData';
import {
  isValidYouTubeVideoId,
  sanitizeRadioContinuation,
  type InnerTubeParsedTrack,
} from '../utils/metrolistCore';
import {
  buildPlayNowQueue,
  insertIntoQueueAfterCurrent,
  insertIntoQueueAsNext,
  mergeRadioIntoQueue,
  pickNextQueueIndex,
  type RepeatMode,
} from './queueRules';
import { canRetryNetwork, computeRetryDelayMs } from './retryPolicy';

/* ------------------------------------------- limits ------------------------------------------ */

export const MAX_PLAY_HISTORY = 50;
/** Uploads tried for one song (its own video included) before it counts as unplayable. */
export const MAX_VIDEO_CANDIDATES_PER_TRACK = 3;
export const MAX_CONSECUTIVE_STREAM_FAILURES = 3;
/** Radio tops the queue up when this many songs (or fewer) are left. */
export const RADIO_TOP_UP_THRESHOLD = 5;
export const RADIO_MAX_APPEND_PER_RECOMMENDATIONS = 10;
export const RADIO_MAX_APPEND_PER_PAGE = 25;
/** Played songs kept in front of the current one when the radio tops the queue up. */
export const RADIO_MAX_KEPT_HISTORY = 30;
/** Retries of a failed radio continuation page before the radio waits for the next song. */
export const MAX_RADIO_RETRIES = 3;
/** Previous restarts the song instead of going back once it has played longer than this. */
export const PREVIOUS_RESTARTS_AFTER_MS = 3000;
/** Anything this short is a preview clip, never a real song duration. */
export const PREVIEW_DURATION_MS = 30000;
const DURATION_CHANGE_TOLERANCE_MS = 1500;
const SEEK_END_MARGIN_MS = 500;
const DEFAULT_LIVE_TRACK_DURATION_MS = 218000;

/* -------------------------------------------- state ------------------------------------------ */

export type StreamStatus = 'loading' | 'buffering' | 'playing' | 'paused' | 'blocked';

export interface RadioSession {
  /** Video the `RDAMVM` radio was built from (needed to request its next page). */
  seedVideoId: string;
  /** Token of the next page; `null` = the radio is exhausted. */
  continuation: string | null;
  status: 'idle' | 'loading' | 'failed';
  /** Consecutive failed page requests. */
  failedAttempts: number;
}

export interface PlayerState {
  tracksById: Record<string, MetrolistTrack>;
  /** "Your Library": most recently added first; seed tracks last. */
  libraryIds: string[];
  /** Play order. Invariant: contains `activeTrackId` once playback has started. */
  queueIds: string[];
  /** Hand-queued upcoming tracks (they play before automatic radio picks). Always upcoming. */
  userQueuedIds: string[];
  activeTrackId: string;
  /** The listener's intent. */
  isPlaying: boolean;
  hasStartedPlayback: boolean;
  streamStatus: StreamStatus;
  /** `token` changes on every request, so seeking to the same position still re-triggers. */
  seekRequest: { token: number; ms: number } | null;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  autoplayRadio: boolean;
  /** Previously played track ids, oldest first, capped at `MAX_PLAY_HISTORY`. */
  playHistory: string[];
  /** "Recommended for you" shelf for the active track (never contains it). */
  recommendations: InnerTubeParsedTrack[];
  radio: RadioSession | null;
  consecutiveStreamFailures: number;
  /** Video ids tried per track id (the original upload first). */
  triedVideoIdsByTrack: Record<string, string[]>;
  network: { waiting: boolean; retryAttempt: number };
  notice: { id: number; message: string } | null;
  /** Monotonic counter behind notice ids and seek tokens. */
  seq: number;
}

/** A track from the library / queue, or a search / recommendation card. */
export type TrackInput = MetrolistTrack | InnerTubeParsedTrack;

/* ------------------------------------------- actions ----------------------------------------- */

export type PlayerAction =
  /** Search result or recommendation card: play now, keep history + hand-queued songs. */
  | { type: 'playFromSearch'; track: InnerTubeParsedTrack }
  /** Library row: play now, then continue through `context` (the list it was picked from). */
  | { type: 'playFromList'; track: MetrolistTrack; context: MetrolistTrack[] }
  /** Jump to a song inside the queue without reshaping it. */
  | { type: 'playQueueItem'; trackId: string }
  | { type: 'togglePlay' }
  /** External pause / resume (OS media keys, the YouTube player itself). */
  | { type: 'setPlaying'; playing: boolean }
  /** `random` in [0, 1), used by shuffle. */
  | { type: 'next'; random: number }
  | { type: 'previous'; positionMs: number }
  /** `trackId` guards against a late "ended" event of a song that is no longer playing. */
  | { type: 'trackEnded'; random: number; trackId?: string }
  /** The song cannot be played (alternate uploads exhausted). */
  | { type: 'trackUnplayable'; trackId: string; random: number }
  | { type: 'alternateVideoFound'; trackId: string; videoId: string; durationMs?: number }
  | { type: 'streamStatusChanged'; status: StreamStatus }
  | { type: 'seekRequested'; ms: number }
  | { type: 'seekHandled'; token?: number }
  | { type: 'durationDiscovered'; trackId: string; durationMs: number }
  | { type: 'addToQueue'; track: TrackInput }
  | { type: 'playNext'; track: TrackInput }
  | { type: 'removeFromQueue'; trackId: string }
  | { type: 'moveQueueItem'; trackId: string; direction: -1 | 1 }
  | { type: 'clearUpcoming' }
  /** `track` lets a search card the player has not seen yet be liked / downloaded. */
  | { type: 'toggleLike'; trackId: string; track?: TrackInput }
  | { type: 'toggleDownloaded'; trackId: string; track?: TrackInput }
  | { type: 'toggleShuffle' }
  | { type: 'cycleRepeat' }
  | { type: 'toggleAutoplayRadio' }
  | {
      type: 'recommendationsLoaded';
      trackId: string;
      tracks: InnerTubeParsedTrack[];
      continuation: string | null;
      /** Video the radio was built from (the server may resolve one for seed tracks). */
      seedVideoId?: string;
    }
  | { type: 'recommendationsFailed'; trackId: string; fallback: InnerTubeParsedTrack[] }
  | { type: 'radioPageRequested'; seedVideoId: string; continuation: string }
  | {
      type: 'radioPageLoaded';
      seedVideoId: string;
      continuation: string;
      tracks: InnerTubeParsedTrack[];
      nextContinuation: string | null;
    }
  | { type: 'radioPageFailed'; seedVideoId: string; continuation: string }
  /** Retry a failed radio page (the UI waits a back-off delay before dispatching it). */
  | { type: 'radioRetry' }
  /** The stream API is unavailable / the device is offline: wait, keeping the play intent. */
  | { type: 'networkLost' }
  | { type: 'networkRetryAttempted' }
  | { type: 'networkRetriesExhausted' }
  | { type: 'networkRestored' }
  | { type: 'restore'; snapshot: PlayerState; positionMs: number }
  | { type: 'dismissNotice'; id?: number };

/* ------------------------------------------- helpers ----------------------------------------- */

const hasOwn = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

function getTrack(state: Pick<PlayerState, 'tracksById'>, id: string): MetrolistTrack | undefined {
  return id && hasOwn(state.tracksById, id) ? state.tracksById[id] : undefined;
}

export function liveTrackId(videoId: string): string {
  return `ytm-${videoId}`;
}

/** Converts a search / radio result to a playable live track. A preview-length duration is never kept. */
export function toMetrolistTrack(ytTrack: InnerTubeParsedTrack): MetrolistTrack {
  return {
    id: liveTrackId(ytTrack.videoId),
    videoId: ytTrack.videoId,
    title: ytTrack.title,
    artist: ytTrack.artist,
    album: ytTrack.album || 'YouTube Music',
    durationMs:
      ytTrack.durationMs > PREVIEW_DURATION_MS ? ytTrack.durationMs : DEFAULT_LIVE_TRACK_DURATION_MS,
    bpm: 116,
    rootFreqHz: 220,
    chordIntervals: [0, 3, 7, 10],
    coverUrl: ytTrack.thumbnailUrl || `https://i.ytimg.com/vi/${ytTrack.videoId}/hqdefault.jpg`,
    genre: 'YouTube Music',
    liked: false,
    cachedOffline: false,
    isLiveInnerTube: true,
  };
}

function isMetrolistTrack(input: TrackInput): input is MetrolistTrack {
  return typeof (input as Partial<MetrolistTrack>).id === 'string';
}

/** The stored track for an input when the player already knows it (keeps likes and real durations). */
function resolveTrack(state: PlayerState, input: TrackInput): MetrolistTrack {
  const id = isMetrolistTrack(input) ? input.id : liveTrackId(input.videoId);
  return getTrack(state, id) ?? (isMetrolistTrack(input) ? input : toMetrolistTrack(input));
}

function withTracks(state: PlayerState, tracks: MetrolistTrack[]): PlayerState {
  const missing = tracks.filter((t) => !getTrack(state, t.id));
  if (missing.length === 0) return state;
  const tracksById = { ...state.tracksById };
  for (const track of missing) tracksById[track.id] = track;
  return { ...state, tracksById };
}

function patchTrack(state: PlayerState, id: string, patch: Partial<MetrolistTrack>): PlayerState {
  const track = getTrack(state, id);
  if (!track) return state;
  return { ...state, tracksById: { ...state.tracksById, [id]: { ...track, ...patch } } };
}

function addToLibraryFront(libraryIds: string[], id: string): string[] {
  return libraryIds.includes(id) ? libraryIds : [id, ...libraryIds];
}

const toRefs = (ids: string[]) => ids.map((id) => ({ id }));
const fromRefs = (refs: Array<{ id: string }>) => refs.map((ref) => ref.id);

function upcomingIdsOf(state: PlayerState): string[] {
  const idx = state.queueIds.indexOf(state.activeTrackId);
  return idx === -1 ? state.queueIds : state.queueIds.slice(idx + 1);
}

function withNotice(state: PlayerState, message: string): PlayerState {
  const seq = state.seq + 1;
  return { ...state, seq, notice: { id: seq, message } };
}

function withSeek(state: PlayerState, ms: number): PlayerState {
  const seq = state.seq + 1;
  return { ...state, seq, seekRequest: { token: seq, ms } };
}

function clampSeekMs(ms: number, durationMs: number): number {
  const safe = Number.isFinite(ms) ? ms : 0;
  return Math.max(0, Math.min(safe, Math.max(0, durationMs - SEEK_END_MARGIN_MS)));
}

function clampRandom(random: number): number {
  return Number.isFinite(random) ? Math.min(Math.max(random, 0), 0.999999) : 0;
}

function isActiveRecommendation(active: MetrolistTrack, rec: InnerTubeParsedTrack): boolean {
  return rec.videoId === active.videoId || liveTrackId(rec.videoId) === active.id;
}

/* ------------------------------------------ transitions -------------------------------------- */

/** Starts `trackId` from the beginning. Callers shape the queue first. */
function startTrack(
  state: PlayerState,
  trackId: string,
  options: { recordHistory: boolean; userInitiated: boolean }
): PlayerState {
  const track = getTrack(state, trackId);
  if (!track) return state;
  const previousId = state.activeTrackId;
  const sameTrack = previousId === trackId;

  let playHistory = state.playHistory;
  if (options.recordHistory && state.hasStartedPlayback && previousId && !sameTrack) {
    playHistory = [...playHistory, previousId].slice(-MAX_PLAY_HISTORY);
  }
  // A new song gives a radio that gave up a fresh chance
  const radio =
    !sameTrack && state.radio?.status === 'failed'
      ? { ...state.radio, status: 'idle' as const, failedAttempts: 0 }
      : state.radio;

  const next: PlayerState = {
    ...state,
    activeTrackId: trackId,
    playHistory,
    hasStartedPlayback: true,
    isPlaying: true,
    queueIds: state.queueIds.includes(trackId) ? state.queueIds : [trackId, ...state.queueIds],
    libraryIds: addToLibraryFront(state.libraryIds, trackId),
    userQueuedIds: state.userQueuedIds.filter((id) => id !== trackId),
    streamStatus: track.isLiveInnerTube ? 'loading' : 'paused',
    // A different video always loads from 0 by itself; only a replay needs an explicit seek
    seekRequest: null,
    consecutiveStreamFailures: options.userInitiated ? 0 : state.consecutiveStreamFailures,
    radio,
  };
  return sameTrack ? withSeek(next, 0) : next;
}

function restartCurrent(state: PlayerState): PlayerState {
  return withSeek({ ...state, isPlaying: true, hasStartedPlayback: true }, 0);
}

function stopPlayback(state: PlayerState): PlayerState {
  return withSeek({ ...state, isPlaying: false, streamStatus: 'paused' }, 0);
}

function togglePlay(state: PlayerState): PlayerState {
  if (!getTrack(state, state.activeTrackId)) return state;
  return state.isPlaying
    ? { ...state, isPlaying: false }
    : { ...state, isPlaying: true, hasStartedPlayback: true };
}

/**
 * Moves through the queue.
 * - `user`:  Next / Previous pressed
 * - `ended`: the current song finished on its own (honours repeat-one / end of queue)
 * - `error`: the current song cannot be played, never land on it again
 */
function skip(
  state: PlayerState,
  direction: -1 | 1,
  reason: 'user' | 'ended' | 'error',
  random: number
): PlayerState {
  const currentId = state.activeTrackId;
  if (!getTrack(state, currentId)) return state;
  const startOptions = { recordHistory: true, userInitiated: reason === 'user' };

  // Hand-queued songs play first, even with shuffle on
  const repeatsItself = reason === 'ended' && state.repeatMode === 'ONE';
  if (direction === 1 && state.shuffleEnabled && !repeatsItself) {
    const queued = new Set(state.userQueuedIds);
    const firstQueued = upcomingIdsOf(state).find((id) => queued.has(id));
    if (firstQueued) return startTrack(state, firstQueued, startOptions);
  }

  const nextIndex = pickNextQueueIndex({
    queueLength: state.queueIds.length,
    currentIndex: state.queueIds.indexOf(currentId),
    direction,
    shuffle: state.shuffleEnabled,
    repeatMode: reason === 'error' && state.repeatMode === 'ONE' ? 'ALL' : state.repeatMode,
    userInitiated: reason !== 'ended',
    random: () => clampRandom(random),
  });
  const nextId = nextIndex >= 0 ? state.queueIds[nextIndex] : undefined;

  if (!nextId || (reason === 'error' && nextId === currentId)) return stopPlayback(state);
  if (nextId === currentId) return restartCurrent(state);
  return startTrack(state, nextId, startOptions);
}

function previous(state: PlayerState, positionMs: number): PlayerState {
  const currentId = state.activeTrackId;
  if (!getTrack(state, currentId)) return state;
  // Like every music player: Previous restarts the song unless it has only just begun
  if (Number.isFinite(positionMs) && positionMs > PREVIOUS_RESTARTS_AFTER_MS) {
    return restartCurrent(state);
  }
  if (!state.shuffleEnabled) return skip(state, -1, 'user', 0);

  const history = [...state.playHistory];
  while (history.length > 0) {
    const previousId = history.pop()!;
    if (previousId === currentId || !getTrack(state, previousId)) continue;
    let queueIds = state.queueIds;
    if (!queueIds.includes(previousId)) {
      // A song removed from the queue comes back just before the current one
      const idx = Math.max(0, queueIds.indexOf(currentId));
      queueIds = [...queueIds.slice(0, idx), previousId, ...queueIds.slice(idx)];
    }
    return startTrack({ ...state, playHistory: history, queueIds }, previousId, {
      recordHistory: false,
      userInitiated: true,
    });
  }
  return skip({ ...state, playHistory: [] }, -1, 'user', 0);
}

function playNow(state: PlayerState, track: MetrolistTrack, followUps: MetrolistTrack[]): PlayerState {
  if (track.id === state.activeTrackId && getTrack(state, track.id)) return togglePlay(state);
  const withAll = withTracks(state, [track, ...followUps]);
  const currentId = withAll.hasStartedPlayback ? withAll.activeTrackId : null;
  const queueIds = fromRefs(
    buildPlayNowQueue(
      toRefs(withAll.queueIds),
      currentId,
      { id: track.id },
      new Set(withAll.userQueuedIds),
      toRefs(followUps.map((t) => t.id))
    )
  );
  return startTrack({ ...withAll, queueIds }, track.id, { recordHistory: true, userInitiated: true });
}

function trackUnplayable(state: PlayerState, trackId: string, random: number): PlayerState {
  const failed = getTrack(state, trackId);
  if (!failed || trackId !== state.activeTrackId) return state;
  const failures = state.consecutiveStreamFailures + 1;
  if (failures >= MAX_CONSECUTIVE_STREAM_FAILURES) {
    return withNotice(
      { ...state, isPlaying: false, streamStatus: 'paused', consecutiveStreamFailures: 0 },
      'Several songs in a row could not be played. Playback paused.'
    );
  }
  const skipped = skip({ ...state, consecutiveStreamFailures: failures }, 1, 'error', random);
  return withNotice(skipped, `“${failed.title}” can’t be played here. Skipping…`);
}

function alternateVideoFound(
  state: PlayerState,
  trackId: string,
  videoId: string,
  durationMs: number | undefined
): PlayerState {
  const track = getTrack(state, trackId);
  if (!track || trackId !== state.activeTrackId || !isValidYouTubeVideoId(videoId)) return state;
  const tried = selectTriedVideoIds(state, trackId);
  if (tried.includes(videoId) || tried.length >= MAX_VIDEO_CANDIDATES_PER_TRACK) return state;
  const patched = patchTrack(state, trackId, {
    videoId,
    durationMs:
      durationMs !== undefined && durationMs > PREVIEW_DURATION_MS ? durationMs : track.durationMs,
  });
  return {
    ...patched,
    streamStatus: 'loading',
    triedVideoIdsByTrack: { ...state.triedVideoIdsByTrack, [trackId]: [...tried, videoId] },
  };
}

function queueTrack(state: PlayerState, input: TrackInput, mode: 'end' | 'next'): PlayerState {
  const track = resolveTrack(state, input);
  if (track.id === state.activeTrackId && getTrack(state, track.id)) {
    return withNotice(state, 'This song is already playing');
  }
  const withTrack = withTracks(state, [track]);
  const libraryIds = addToLibraryFront(withTrack.libraryIds, track.id);

  if (!getTrack(withTrack, withTrack.activeTrackId)) {
    // Empty player: the song becomes the (paused) current one
    return withNotice(
      {
        ...withTrack,
        libraryIds,
        activeTrackId: track.id,
        queueIds: [track.id, ...withTrack.queueIds.filter((id) => id !== track.id)],
        streamStatus: 'paused',
      },
      `Added “${track.title}” to your queue`
    );
  }

  const refs = toRefs(withTrack.queueIds);
  const queueIds = fromRefs(
    mode === 'next'
      ? insertIntoQueueAsNext(refs, withTrack.activeTrackId, { id: track.id })
      : insertIntoQueueAfterCurrent(refs, withTrack.activeTrackId, { id: track.id }, new Set(withTrack.userQueuedIds))
  );
  const userQueuedIds = [...withTrack.userQueuedIds.filter((id) => id !== track.id), track.id];
  return withNotice(
    { ...withTrack, libraryIds, queueIds, userQueuedIds },
    mode === 'next' ? `“${track.title}” will play next` : `Added “${track.title}” to your queue`
  );
}

function moveQueueItem(state: PlayerState, trackId: string, direction: -1 | 1): PlayerState {
  const index = state.queueIds.indexOf(trackId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= state.queueIds.length) return state;
  const queueIds = [...state.queueIds];
  queueIds[index] = queueIds[target];
  queueIds[target] = trackId;
  return { ...state, queueIds };
}

function clearUpcoming(state: PlayerState): PlayerState {
  const idx = state.queueIds.indexOf(state.activeTrackId);
  if (idx === -1) return state;
  if (idx === state.queueIds.length - 1 && state.userQueuedIds.length === 0 && state.radio === null) {
    return state;
  }
  return { ...state, queueIds: state.queueIds.slice(0, idx + 1), userQueuedIds: [], radio: null };
}

function toggleFlag(
  state: PlayerState,
  trackId: string,
  flag: 'liked' | 'cachedOffline',
  input: TrackInput | undefined
): PlayerState {
  // A card the player has not seen yet is added first (its id must match the request)
  const candidate = !getTrack(state, trackId) && input ? resolveTrack(state, input) : undefined;
  if (candidate && candidate.id !== trackId) return state;
  const withTrack = candidate ? withTracks(state, [candidate]) : state;
  const track = getTrack(withTrack, trackId);
  if (!track) return state;
  // A liked / downloaded song must live in the library even if it was only ever in the queue
  const patched = patchTrack(withTrack, trackId, { [flag]: !track[flag] });
  return { ...patched, libraryIds: addToLibraryFront(patched.libraryIds, trackId) };
}

/** Appends radio picks (deduplicated) when the queue is short, trimming old history. */
function appendRadioTracks(
  state: PlayerState,
  tracks: InnerTubeParsedTrack[],
  options: { minUpcoming: number; maxAppend: number }
): PlayerState {
  const resolved = tracks.map((t) => resolveTrack(state, t));
  const withAll = withTracks(state, resolved);
  const queueIds = fromRefs(
    mergeRadioIntoQueue(toRefs(withAll.queueIds), withAll.activeTrackId, toRefs(resolved.map((t) => t.id)), {
      ...options,
      maxHistory: RADIO_MAX_KEPT_HISTORY,
    })
  );
  return { ...withAll, queueIds };
}

function recommendationsLoaded(
  state: PlayerState,
  action: Extract<PlayerAction, { type: 'recommendationsLoaded' }>
): PlayerState {
  const active = getTrack(state, state.activeTrackId);
  if (!active || action.trackId !== state.activeTrackId) return state;
  const shelf = action.tracks.filter((t) => !isActiveRecommendation(active, t));
  const withShelf: PlayerState = { ...state, recommendations: shelf };
  if (!state.autoplayRadio || upcomingIdsOf(state).length > RADIO_TOP_UP_THRESHOLD) return withShelf;

  const toppedUp = appendRadioTracks(withShelf, shelf, {
    minUpcoming: RADIO_TOP_UP_THRESHOLD + 1,
    maxAppend: RADIO_MAX_APPEND_PER_RECOMMENDATIONS,
  });
  const seedVideoId =
    action.seedVideoId && isValidYouTubeVideoId(action.seedVideoId) ? action.seedVideoId : active.videoId;
  return {
    ...toppedUp,
    radio: {
      seedVideoId,
      continuation: sanitizeRadioContinuation(action.continuation) || null,
      status: 'idle',
      failedAttempts: 0,
    },
  };
}

function isCurrentRadioPage(state: PlayerState, seedVideoId: string, continuation: string): boolean {
  return (
    !!state.radio &&
    state.radio.seedVideoId === seedVideoId &&
    state.radio.continuation !== null &&
    state.radio.continuation === continuation
  );
}

function radioPageLoaded(
  state: PlayerState,
  action: Extract<PlayerAction, { type: 'radioPageLoaded' }>
): PlayerState {
  if (!state.radio || !isCurrentRadioPage(state, action.seedVideoId, action.continuation)) return state;
  const appended = appendRadioTracks(state, action.tracks, {
    minUpcoming: Number.POSITIVE_INFINITY,
    maxAppend: RADIO_MAX_APPEND_PER_PAGE,
  });
  return {
    ...appended,
    radio: {
      ...state.radio,
      continuation: sanitizeRadioContinuation(action.nextContinuation) || null,
      status: 'idle',
      failedAttempts: 0,
    },
  };
}

function exhaustNetworkRetries(state: PlayerState): PlayerState {
  return withNotice(
    { ...state, isPlaying: false, streamStatus: 'paused', network: { waiting: false, retryAttempt: 0 } },
    'Can’t reach YouTube right now. Check your connection, then press play.'
  );
}

function restore(state: PlayerState, snapshot: PlayerState, positionMs: number): PlayerState {
  const restored: PlayerState = finalize({
    ...snapshot,
    isPlaying: false,
    streamStatus: 'paused',
    seekRequest: null,
    consecutiveStreamFailures: 0,
    network: { waiting: false, retryAttempt: 0 },
    notice: null,
    radio: snapshot.radio ? { ...snapshot.radio, status: 'idle', failedAttempts: 0 } : null,
    seq: Math.max(state.seq, snapshot.seq),
  });
  const active = getTrack(restored, restored.activeTrackId);
  if (!active || !(positionMs > 0)) return restored;
  return withSeek(restored, clampSeekMs(positionMs, active.durationMs));
}

/* ------------------------------------------- reducer ----------------------------------------- */

function reduce(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'playFromSearch':
      return playNow(state, resolveTrack(state, action.track), []);
    case 'playFromList': {
      const track = resolveTrack(state, action.track);
      const contextIdx = action.context.findIndex((t) => t.id === track.id);
      const followUps =
        contextIdx >= 0 ? action.context.slice(contextIdx + 1).map((t) => resolveTrack(state, t)) : [];
      return playNow(state, track, followUps);
    }
    case 'playQueueItem':
      if (!state.queueIds.includes(action.trackId) || !getTrack(state, action.trackId)) return state;
      if (action.trackId === state.activeTrackId) return togglePlay(state);
      return startTrack(state, action.trackId, { recordHistory: true, userInitiated: true });
    case 'togglePlay':
      return togglePlay(state);
    case 'setPlaying':
      if (state.isPlaying === action.playing || !getTrack(state, state.activeTrackId)) return state;
      return togglePlay(state);
    case 'next':
      return skip(state, 1, 'user', action.random);
    case 'previous':
      return previous(state, action.positionMs);
    case 'trackEnded':
      if (action.trackId !== undefined && action.trackId !== state.activeTrackId) return state;
      return skip(state, 1, 'ended', action.random);
    case 'trackUnplayable':
      return trackUnplayable(state, action.trackId, action.random);
    case 'alternateVideoFound':
      return alternateVideoFound(state, action.trackId, action.videoId, action.durationMs);
    case 'streamStatusChanged': {
      if (action.status !== 'playing') {
        return action.status === state.streamStatus ? state : { ...state, streamStatus: action.status };
      }
      const settled =
        state.streamStatus === 'playing' &&
        state.consecutiveStreamFailures === 0 &&
        !state.network.waiting &&
        state.network.retryAttempt === 0;
      if (settled) return state;
      return {
        ...state,
        streamStatus: 'playing',
        consecutiveStreamFailures: 0,
        network: { waiting: false, retryAttempt: 0 },
      };
    }
    case 'seekRequested': {
      const active = getTrack(state, state.activeTrackId);
      if (!active) return state;
      return withSeek(state, clampSeekMs(action.ms, active.durationMs));
    }
    case 'seekHandled':
      if (!state.seekRequest) return state;
      if (action.token !== undefined && action.token !== state.seekRequest.token) return state;
      return { ...state, seekRequest: null };
    case 'durationDiscovered': {
      const track = getTrack(state, action.trackId);
      if (
        !track ||
        !(action.durationMs > PREVIEW_DURATION_MS) ||
        Math.abs(action.durationMs - track.durationMs) <= DURATION_CHANGE_TOLERANCE_MS
      ) {
        return state;
      }
      return patchTrack(state, action.trackId, { durationMs: action.durationMs });
    }
    case 'addToQueue':
      return queueTrack(state, action.track, 'end');
    case 'playNext':
      return queueTrack(state, action.track, 'next');
    case 'removeFromQueue':
      if (action.trackId === state.activeTrackId || !state.queueIds.includes(action.trackId)) return state;
      return {
        ...state,
        queueIds: state.queueIds.filter((id) => id !== action.trackId),
        userQueuedIds: state.userQueuedIds.filter((id) => id !== action.trackId),
      };
    case 'moveQueueItem':
      return moveQueueItem(state, action.trackId, action.direction);
    case 'clearUpcoming':
      return clearUpcoming(state);
    case 'toggleLike':
      return toggleFlag(state, action.trackId, 'liked', action.track);
    case 'toggleDownloaded':
      return toggleFlag(state, action.trackId, 'cachedOffline', action.track);
    case 'toggleShuffle':
      return { ...state, shuffleEnabled: !state.shuffleEnabled };
    case 'cycleRepeat':
      return {
        ...state,
        repeatMode: state.repeatMode === 'OFF' ? 'ALL' : state.repeatMode === 'ALL' ? 'ONE' : 'OFF',
      };
    case 'toggleAutoplayRadio':
      return { ...state, autoplayRadio: !state.autoplayRadio };
    case 'recommendationsLoaded':
      return recommendationsLoaded(state, action);
    case 'recommendationsFailed': {
      const active = getTrack(state, state.activeTrackId);
      if (!active || action.trackId !== state.activeTrackId) return state;
      return { ...state, recommendations: action.fallback.filter((t) => !isActiveRecommendation(active, t)) };
    }
    case 'radioPageRequested':
      if (!state.radio || state.radio.status !== 'idle') return state;
      if (!isCurrentRadioPage(state, action.seedVideoId, action.continuation)) return state;
      return { ...state, radio: { ...state.radio, status: 'loading' } };
    case 'radioPageLoaded':
      return radioPageLoaded(state, action);
    case 'radioPageFailed':
      if (!state.radio || !isCurrentRadioPage(state, action.seedVideoId, action.continuation)) return state;
      return {
        ...state,
        radio: { ...state.radio, status: 'failed', failedAttempts: state.radio.failedAttempts + 1 },
      };
    case 'radioRetry':
      if (!state.radio || !selectCanRetryRadio(state)) return state;
      return { ...state, radio: { ...state.radio, status: 'idle' } };
    case 'networkLost':
      if (state.network.waiting) return state;
      return { ...state, network: { waiting: true, retryAttempt: 0 } };
    case 'networkRetryAttempted':
      if (!state.network.waiting) return state;
      if (!canRetryNetwork(state.network.retryAttempt)) return exhaustNetworkRetries(state);
      return { ...state, network: { waiting: true, retryAttempt: state.network.retryAttempt + 1 } };
    case 'networkRetriesExhausted':
      return state.network.waiting ? exhaustNetworkRetries(state) : state;
    case 'networkRestored':
      if (!state.network.waiting && state.network.retryAttempt === 0) return state;
      return { ...state, network: { waiting: false, retryAttempt: 0 } };
    case 'restore':
      return restore(state, action.snapshot, action.positionMs);
    case 'dismissNotice':
      if (!state.notice || (action.id !== undefined && action.id !== state.notice.id)) return state;
      return { ...state, notice: null };
    default: {
      const unhandled: never = action;
      void unhandled;
      return state;
    }
  }
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

function uniqueKnown(state: PlayerState, ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id) && getTrack(state, id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return sameList(out, ids) ? ids : out;
}

/**
 * Re-establishes every invariant after a change: no duplicates or unknown ids, the active song in
 * the queue once playback started, hand-queued marks only on upcoming songs, the shelf without the
 * active song, and no track objects that nothing references any more.
 */
function finalize(state: PlayerState): PlayerState {
  let queueIds = uniqueKnown(state, state.queueIds);
  const libraryIds = uniqueKnown(state, state.libraryIds);
  let activeTrackId = state.activeTrackId;
  if (!getTrack(state, activeTrackId)) activeTrackId = queueIds[0] ?? libraryIds[0] ?? '';
  if (state.hasStartedPlayback && activeTrackId && !queueIds.includes(activeTrackId)) {
    queueIds = [activeTrackId, ...queueIds];
  }

  const activeIdx = queueIds.indexOf(activeTrackId);
  const upcoming = new Set(activeIdx === -1 ? queueIds : queueIds.slice(activeIdx + 1));
  const queuedFiltered = [...new Set(state.userQueuedIds)].filter((id) => upcoming.has(id));
  const userQueuedIds = sameList(queuedFiltered, state.userQueuedIds) ? state.userQueuedIds : queuedFiltered;

  const historyFiltered = state.playHistory.filter((id) => getTrack(state, id)).slice(-MAX_PLAY_HISTORY);
  const playHistory = sameList(historyFiltered, state.playHistory) ? state.playHistory : historyFiltered;

  const active = getTrack(state, activeTrackId);
  const recommendations =
    active && state.recommendations.some((r) => isActiveRecommendation(active, r))
      ? state.recommendations.filter((r) => !isActiveRecommendation(active, r))
      : state.recommendations;

  const referenced = new Set([...queueIds, ...libraryIds, ...playHistory, activeTrackId]);
  let tracksById = state.tracksById;
  let triedVideoIdsByTrack = state.triedVideoIdsByTrack;
  const storedIds = Object.keys(tracksById);
  if (storedIds.some((id) => !referenced.has(id))) {
    tracksById = {};
    for (const id of storedIds) if (referenced.has(id)) tracksById[id] = state.tracksById[id];
  }
  const triedIds = Object.keys(triedVideoIdsByTrack);
  if (triedIds.some((id) => !referenced.has(id))) {
    triedVideoIdsByTrack = {};
    for (const id of triedIds) if (referenced.has(id)) triedVideoIdsByTrack[id] = state.triedVideoIdsByTrack[id];
  }

  return {
    ...state,
    tracksById,
    triedVideoIdsByTrack,
    queueIds,
    libraryIds,
    activeTrackId,
    userQueuedIds,
    playHistory,
    recommendations,
  };
}

/** The player reducer. Returns the same object when an action changes nothing. */
export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  const next = reduce(state, action);
  return next === state ? state : finalize(next);
}

export function createInitialPlayerState(
  seedTracks: MetrolistTrack[],
  preferences: Partial<Pick<PlayerState, 'shuffleEnabled' | 'repeatMode' | 'autoplayRadio'>> = {}
): PlayerState {
  const tracksById: Record<string, MetrolistTrack> = {};
  const ids: string[] = [];
  for (const track of seedTracks) {
    if (hasOwn(tracksById, track.id)) continue;
    tracksById[track.id] = track;
    ids.push(track.id);
  }
  return {
    tracksById,
    libraryIds: ids,
    queueIds: [...ids],
    userQueuedIds: [],
    activeTrackId: ids[0] ?? '',
    isPlaying: false,
    hasStartedPlayback: false,
    streamStatus: 'paused',
    seekRequest: null,
    shuffleEnabled: preferences.shuffleEnabled ?? false,
    repeatMode: preferences.repeatMode ?? 'OFF',
    autoplayRadio: preferences.autoplayRadio ?? true,
    playHistory: [],
    recommendations: [],
    radio: null,
    consecutiveStreamFailures: 0,
    triedVideoIdsByTrack: {},
    network: { waiting: false, retryAttempt: 0 },
    notice: null,
    seq: 0,
  };
}

/* ------------------------------------------ selectors ---------------------------------------- */

export function selectActiveTrack(state: PlayerState): MetrolistTrack | null {
  return getTrack(state, state.activeTrackId) ?? null;
}

export function selectQueueTracks(state: Pick<PlayerState, 'tracksById' | 'queueIds'>): MetrolistTrack[] {
  return state.queueIds.map((id) => getTrack(state, id)).filter((t): t is MetrolistTrack => !!t);
}

export function selectLibraryTracks(state: Pick<PlayerState, 'tracksById' | 'libraryIds'>): MetrolistTrack[] {
  return state.libraryIds.map((id) => getTrack(state, id)).filter((t): t is MetrolistTrack => !!t);
}

/** A live song the listener wants to hear is still loading, buffering or waiting for the network. */
export function selectIsStreamLoading(state: PlayerState): boolean {
  const active = getTrack(state, state.activeTrackId);
  if (!active?.isLiveInnerTube || !state.isPlaying) return false;
  return state.network.waiting || state.streamStatus === 'loading' || state.streamStatus === 'buffering';
}

/** Ids queued after the active song (the whole queue while the active song is not in it). */
export function selectUpcomingIds(state: PlayerState): string[] {
  return upcomingIdsOf(state);
}

export function selectUpcomingCount(state: PlayerState): number {
  return upcomingIdsOf(state).length;
}

/**
 * The next radio page to fetch, or `null`: only with autoplay on, 5 or fewer songs left, a radio
 * session that still has a continuation and no request in flight or failed.
 */
export function selectRadioContinuationRequest(
  state: PlayerState
): { seedVideoId: string; continuation: string } | null {
  const radio = state.radio;
  if (!state.autoplayRadio || !radio || radio.status !== 'idle' || !radio.continuation) return null;
  if (upcomingIdsOf(state).length > RADIO_TOP_UP_THRESHOLD) return null;
  return { seedVideoId: radio.seedVideoId, continuation: radio.continuation };
}

/** True when a failed radio page may be requested again (`radioRetry`). */
export function selectCanRetryRadio(state: PlayerState): boolean {
  return (
    !!state.radio && state.radio.status === 'failed' && state.radio.failedAttempts <= MAX_RADIO_RETRIES
  );
}

/** Video ids already tried for a track, its current upload included. */
export function selectTriedVideoIds(state: PlayerState, trackId: string): string[] {
  const track = getTrack(state, trackId);
  if (!track) return [];
  return hasOwn(state.triedVideoIdsByTrack, trackId) ? state.triedVideoIdsByTrack[trackId] : [track.videoId];
}

/** Whether another upload of the song may still be tried before calling it unplayable. */
export function selectCanTryAlternateVideo(state: PlayerState, trackId: string): boolean {
  return !!getTrack(state, trackId) && selectTriedVideoIds(state, trackId).length < MAX_VIDEO_CANDIDATES_PER_TRACK;
}

/** Delay before the next network retry, or `null` when not waiting for the network. */
export function selectNetworkRetryDelayMs(state: PlayerState): number | null {
  return state.network.waiting ? computeRetryDelayMs(state.network.retryAttempt) : null;
}
