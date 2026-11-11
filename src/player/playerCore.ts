/**
 * Pure player core: a normalized state, a reducer and selectors for playback, the queue, the
 * autoplay radio and network back-off. No React, no DOM, no timers and no hidden clock or
 * randomness: anything time- or chance-dependent arrives through action payloads.
 *
 * The playback model follows the ideas of the Android app Metrolist (paged radio queue that loads
 * more when it runs low, "play next" vs "add to queue", resumable queue, retry with back-off).
 */
import type { MetrolistTrack } from '../data/track';
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
import { isContentRestriction, unplayableNotice, type UnplayableReason } from './streamErrors';

/* ------------------------------------------- limits ------------------------------------------ */

export const MAX_PLAY_HISTORY = 50;
/** Songs kept in "Recently played" (newest first). */
export const MAX_RECENTLY_PLAYED = 30;
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

/** Where the listener started the current listening session ("Playing from …"). */
export type PlaySource = 'home' | 'search' | 'liked' | 'downloads' | 'library' | 'radio';

export interface PlayerState {
  /** Every song some list below refers to (anything else is garbage-collected). */
  tracksById: Record<string, MetrolistTrack>;
  /** Liked Songs, newest first. */
  likedIds: string[];
  /** Downloads, newest first (a list only: the audio itself is not stored on the device). */
  downloadedIds: string[];
  /** Recently played, newest first, deduplicated, at most `MAX_RECENTLY_PLAYED`. */
  recentlyPlayedIds: string[];
  /** Play order. Invariant: contains `activeTrackId`; empty exactly when nothing is active. */
  queueIds: string[];
  /** Hand-queued upcoming tracks (they play before automatic radio picks). Always upcoming. */
  userQueuedIds: string[];
  /** The loaded song, or `null` on a fresh install. */
  activeTrackId: string | null;
  playingFrom: PlaySource | null;
  /** The listener's intent. */
  isPlaying: boolean;
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
  /**
   * Songs known to be unplayable this session (every upload tried, or the pre-check found no other
   * upload): jumped over without being loaded, and a tap on one is refused. Not persisted.
   */
  unplayableTracks: Record<string, UnplayableReason>;
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
  | { type: 'playFromSearch'; track: TrackInput; source?: PlaySource }
  /** List row: play now, then continue through `context` (the list it was picked from). */
  | { type: 'playFromList'; track: TrackInput; context: TrackInput[]; source?: PlaySource }
  /** Shuffle button of a list: shuffle on, start at a random song (`random` in [0, 1)), queue the rest. */
  | { type: 'shuffleList'; context: TrackInput[]; random: number; source?: PlaySource }
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
  /**
   * The song cannot be played (no other upload works); `reason` picks the notice. The active song is
   * skipped; any song is remembered as unplayable when `reason` is a content restriction. `videoId`:
   * the upload the verdict is about (a verdict about an upload the song no longer uses is ignored).
   */
  | { type: 'trackUnplayable'; trackId: string; random: number; reason?: UnplayableReason; videoId?: string }
  /**
   * Another upload of a song. Without `expectedVideoId` only for the active song (stream error);
   * with it for any song still on that upload (the pre-check of upcoming songs).
   */
  | { type: 'alternateVideoFound'; trackId: string; videoId: string; durationMs?: number; expectedVideoId?: string }
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
      /** Video the radio was built from (the server may resolve one from the title). */
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

function getTrack(state: Pick<PlayerState, 'tracksById'>, id: string | null | undefined): MetrolistTrack | undefined {
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
    album: ytTrack.album || '',
    durationMs:
      ytTrack.durationMs > PREVIEW_DURATION_MS ? ytTrack.durationMs : DEFAULT_LIVE_TRACK_DURATION_MS,
    coverUrl: ytTrack.thumbnailUrl || `https://i.ytimg.com/vi/${ytTrack.videoId}/hqdefault.jpg`,
  };
}

function isMetrolistTrack(input: TrackInput): input is MetrolistTrack {
  return typeof (input as Partial<MetrolistTrack>).id === 'string';
}

/** The stored track for an input when the player already knows it (keeps real durations and uploads). */
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

/** `id` first, then the rest of `ids` without it (the same array when it is already first). */
function moveToFront(ids: string[], id: string): string[] {
  return ids[0] === id ? ids : [id, ...ids.filter((other) => other !== id)];
}

function recordPlayed(recentlyPlayedIds: string[], id: string): string[] {
  const next = moveToFront(recentlyPlayedIds, id);
  return next.length > MAX_RECENTLY_PLAYED ? next.slice(0, MAX_RECENTLY_PLAYED) : next;
}

const toRefs = (ids: string[]) => ids.map((id) => ({ id }));
const fromRefs = (refs: Array<{ id: string }>) => refs.map((ref) => ref.id);

function upcomingIdsOf(state: PlayerState): string[] {
  const idx = state.activeTrackId === null ? -1 : state.queueIds.indexOf(state.activeTrackId);
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
  if (options.recordHistory && previousId && !sameTrack) {
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
    isPlaying: true,
    queueIds: state.queueIds.includes(trackId) ? state.queueIds : [trackId, ...state.queueIds],
    recentlyPlayedIds: recordPlayed(state.recentlyPlayedIds, trackId),
    userQueuedIds: state.userQueuedIds.filter((id) => id !== trackId),
    streamStatus: 'loading',
    // A different video always loads from 0 by itself; only a replay needs an explicit seek
    seekRequest: null,
    consecutiveStreamFailures: options.userInitiated ? 0 : state.consecutiveStreamFailures,
    radio,
  };
  return sameTrack ? withSeek(next, 0) : next;
}

function restartCurrent(state: PlayerState): PlayerState {
  return withSeek({ ...state, isPlaying: true }, 0);
}

function stopPlayback(state: PlayerState): PlayerState {
  return withSeek({ ...state, isPlaying: false, streamStatus: 'paused' }, 0);
}

function togglePlay(state: PlayerState): PlayerState {
  const activeId = state.activeTrackId;
  if (activeId === null || !getTrack(state, activeId)) return state;
  return state.isPlaying
    ? { ...state, isPlaying: false }
    : { ...state, isPlaying: true, recentlyPlayedIds: recordPlayed(state.recentlyPlayedIds, activeId) };
}

function isMarkedUnplayable(state: PlayerState, trackId: string): boolean {
  return hasOwn(state.unplayableTracks, trackId);
}

/** Spreads the random draws of repeated shuffle picks (golden-ratio steps). */
const RANDOM_STEP = 0.6180339887;

/** The song after `fromId` in `direction` (hand-queued songs first with shuffle on), or none. */
function nextCandidate(
  state: PlayerState,
  fromId: string,
  direction: -1 | 1,
  options: { userInitiated: boolean; repeatMode: RepeatMode; preferQueued: boolean },
  random: number
): string | undefined {
  // Hand-queued songs play first, even with shuffle on
  if (direction === 1 && state.shuffleEnabled && options.preferQueued) {
    const queued = new Set(state.userQueuedIds);
    const fromIdx = state.queueIds.indexOf(fromId);
    const upcoming = fromIdx === -1 ? state.queueIds : state.queueIds.slice(fromIdx + 1);
    const firstQueued = upcoming.find((id) => queued.has(id) && !isMarkedUnplayable(state, id));
    if (firstQueued) return firstQueued;
  }
  const nextIndex = pickNextQueueIndex({
    queueLength: state.queueIds.length,
    currentIndex: state.queueIds.indexOf(fromId),
    direction,
    shuffle: state.shuffleEnabled,
    repeatMode: options.repeatMode,
    userInitiated: options.userInitiated,
    random: () => clampRandom(random),
  });
  return nextIndex >= 0 ? state.queueIds[nextIndex] : undefined;
}

/**
 * Moves through the queue.
 * - `user`:  Next / Previous pressed
 * - `ended`: the current song finished on its own (honours repeat-one / end of queue)
 * - `error`: the current song cannot be played, never land on it again
 * Songs known to be unplayable are jumped over without being loaded (one notice names the first).
 */
function skip(
  state: PlayerState,
  direction: -1 | 1,
  reason: 'user' | 'ended' | 'error',
  random: number
): PlayerState {
  const currentId = state.activeTrackId;
  if (currentId === null || !getTrack(state, currentId)) return state;
  const startOptions = { recordHistory: true, userInitiated: reason === 'user' };
  const userInitiated = reason !== 'ended';
  const repeatsItself = reason === 'ended' && state.repeatMode === 'ONE';

  let nextId = nextCandidate(
    state,
    currentId,
    direction,
    {
      userInitiated,
      repeatMode: reason === 'error' && state.repeatMode === 'ONE' ? 'ALL' : state.repeatMode,
      preferQueued: !repeatsItself,
    },
    random
  );
  let jumpedOver: string | null = null;
  for (let step = 1; nextId && nextId !== currentId && isMarkedUnplayable(state, nextId); step++) {
    if (step > state.queueIds.length) {
      nextId = undefined;
      break;
    }
    jumpedOver ??= nextId;
    nextId = nextCandidate(
      state,
      nextId,
      direction,
      { userInitiated, repeatMode: state.repeatMode === 'ONE' ? 'ALL' : state.repeatMode, preferQueued: true },
      (clampRandom(random) + step * RANDOM_STEP) % 1
    );
  }

  let next: PlayerState;
  if (!nextId || (reason === 'error' && nextId === currentId)) next = stopPlayback(state);
  else if (nextId === currentId) next = restartCurrent(state);
  else next = startTrack(state, nextId, startOptions);
  const skippedTrack = jumpedOver ? getTrack(state, jumpedOver) : undefined;
  if (!skippedTrack || !jumpedOver) return next;
  return withNotice(next, unplayableNotice(skippedTrack.title, state.unplayableTracks[jumpedOver], 'skipped'));
}

/** A tap on a song known to be unplayable: say why instead of loading it. */
function refuseUnplayable(state: PlayerState, trackId: string): PlayerState {
  const track = getTrack(state, trackId);
  if (!track) return state;
  return withNotice(state, unplayableNotice(track.title, state.unplayableTracks[trackId], 'none'));
}

function previous(state: PlayerState, positionMs: number): PlayerState {
  const currentId = state.activeTrackId;
  if (currentId === null || !getTrack(state, currentId)) return state;
  // Like every music player: Previous restarts the song unless it has only just begun
  if (Number.isFinite(positionMs) && positionMs > PREVIOUS_RESTARTS_AFTER_MS) {
    return restartCurrent(state);
  }
  if (!state.shuffleEnabled) return skip(state, -1, 'user', 0);

  const history = [...state.playHistory];
  while (history.length > 0) {
    const previousId = history.pop()!;
    if (previousId === currentId || !getTrack(state, previousId) || isMarkedUnplayable(state, previousId)) continue;
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

/** Plays `track` now; `followUps` (the rest of the list it was picked from) come after it. */
function startFromList(
  state: PlayerState,
  track: MetrolistTrack,
  followUps: MetrolistTrack[],
  source: PlaySource | undefined
): PlayerState {
  const withAll = withTracks(state, [track, ...followUps]);
  const queueIds = fromRefs(
    buildPlayNowQueue(
      toRefs(withAll.queueIds),
      withAll.activeTrackId,
      { id: track.id },
      new Set(withAll.userQueuedIds),
      toRefs(followUps.map((t) => t.id))
    )
  );
  // A new listening context: the previous radio session must not keep appending its pages
  return startTrack({ ...withAll, queueIds, radio: null, playingFrom: source ?? null }, track.id, {
    recordHistory: true,
    userInitiated: true,
  });
}

function playNow(
  state: PlayerState,
  track: MetrolistTrack,
  followUps: MetrolistTrack[],
  source: PlaySource | undefined
): PlayerState {
  if (isMarkedUnplayable(state, track.id)) return refuseUnplayable(state, track.id);
  // Tapping the song that is already loaded toggles it instead of restarting it
  if (track.id === state.activeTrackId && getTrack(state, track.id)) return togglePlay(state);
  return startFromList(state, track, followUps, source);
}

/** The tracks of a list, resolved and deduplicated, in order. */
function resolveList(state: PlayerState, inputs: TrackInput[]): MetrolistTrack[] {
  const seen = new Set<string>();
  const out: MetrolistTrack[] = [];
  for (const input of inputs) {
    const track = resolveTrack(state, input);
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
  }
  return out;
}

function shuffleList(
  state: PlayerState,
  context: TrackInput[],
  random: number,
  source: PlaySource | undefined
): PlayerState {
  const tracks = resolveList(state, context);
  if (tracks.length === 0) return state;
  const playable = tracks.filter((t) => !isMarkedUnplayable(state, t.id));
  if (playable.length === 0) return refuseUnplayable(withTracks(state, tracks), tracks[0].id);
  const start = playable[Math.floor(clampRandom(random) * playable.length)];
  const followUps = tracks.filter((t) => t.id !== start.id);
  return startFromList({ ...state, shuffleEnabled: true }, start, followUps, source);
}

function markUnplayable(state: PlayerState, trackId: string, reason: UnplayableReason | undefined): PlayerState {
  if (!reason || !isContentRestriction(reason) || state.unplayableTracks[trackId] === reason) return state;
  return { ...state, unplayableTracks: { ...state.unplayableTracks, [trackId]: reason } };
}

function trackUnplayable(
  state: PlayerState,
  trackId: string,
  random: number,
  reason: UnplayableReason | undefined,
  videoId: string | undefined
): PlayerState {
  const failed = getTrack(state, trackId);
  if (!failed || (videoId !== undefined && failed.videoId !== videoId)) return state;
  const marked = markUnplayable(state, trackId, reason);
  // An upcoming song is only remembered: it is jumped over when it is reached
  if (trackId !== state.activeTrackId) return marked;
  const failures = marked.consecutiveStreamFailures + 1;
  if (failures >= MAX_CONSECUTIVE_STREAM_FAILURES) {
    return withNotice(
      { ...marked, isPlaying: false, streamStatus: 'paused', consecutiveStreamFailures: 0 },
      'Several songs in a row could not be played. Playback paused.'
    );
  }
  const skipped = skip({ ...marked, consecutiveStreamFailures: failures }, 1, 'error', random);
  return withNotice(skipped, unplayableNotice(failed.title, reason));
}

function alternateVideoFound(
  state: PlayerState,
  action: Extract<PlayerAction, { type: 'alternateVideoFound' }>
): PlayerState {
  const { trackId, videoId, durationMs, expectedVideoId } = action;
  const track = getTrack(state, trackId);
  if (!track || !isValidYouTubeVideoId(videoId)) return state;
  const isActive = trackId === state.activeTrackId;
  if (expectedVideoId === undefined ? !isActive : track.videoId !== expectedVideoId) return state;
  const tried = selectTriedVideoIds(state, trackId);
  if (tried.includes(videoId) || tried.length >= MAX_VIDEO_CANDIDATES_PER_TRACK) return state;
  const patched = patchTrack(state, trackId, {
    videoId,
    durationMs:
      durationMs !== undefined && durationMs > PREVIEW_DURATION_MS ? durationMs : track.durationMs,
  });
  const { [trackId]: _cleared, ...unplayableTracks } = state.unplayableTracks;
  void _cleared;
  return {
    ...patched,
    streamStatus: isActive && state.isPlaying ? 'loading' : state.streamStatus,
    triedVideoIdsByTrack: { ...state.triedVideoIdsByTrack, [trackId]: [...tried, videoId] },
    unplayableTracks,
  };
}

function queueTrack(state: PlayerState, input: TrackInput, mode: 'end' | 'next'): PlayerState {
  const track = resolveTrack(state, input);
  if (track.id === state.activeTrackId && getTrack(state, track.id)) {
    return withNotice(state, 'This song is already playing');
  }
  const withTrack = withTracks(state, [track]);
  const currentId = withTrack.activeTrackId;

  if (currentId === null || !getTrack(withTrack, currentId)) {
    // Empty player: the song becomes the (paused) current one
    return withNotice(
      {
        ...withTrack,
        activeTrackId: track.id,
        queueIds: [track.id, ...withTrack.queueIds.filter((id) => id !== track.id)],
        isPlaying: false,
        streamStatus: 'paused',
      },
      `Added “${track.title}” to your queue`
    );
  }

  const refs = toRefs(withTrack.queueIds);
  const queueIds = fromRefs(
    mode === 'next'
      ? insertIntoQueueAsNext(refs, currentId, { id: track.id })
      : insertIntoQueueAfterCurrent(refs, currentId, { id: track.id }, new Set(withTrack.userQueuedIds))
  );
  const userQueuedIds = [...withTrack.userQueuedIds.filter((id) => id !== track.id), track.id];
  return withNotice(
    { ...withTrack, queueIds, userQueuedIds },
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
  if (state.activeTrackId === null) return state;
  const idx = state.queueIds.indexOf(state.activeTrackId);
  if (idx === -1) return state;
  if (idx === state.queueIds.length - 1 && state.userQueuedIds.length === 0 && state.radio === null) {
    return state;
  }
  return { ...state, queueIds: state.queueIds.slice(0, idx + 1), userQueuedIds: [], radio: null };
}

const COLLECTION_NAMES = { likedIds: 'Liked Songs', downloadedIds: 'Downloads' } as const;

/** Adds a song to the front of Liked Songs / Downloads, or removes it when it is already there. */
function toggleMembership(
  state: PlayerState,
  trackId: string,
  list: 'likedIds' | 'downloadedIds',
  input: TrackInput | undefined
): PlayerState {
  // A card the player has not seen yet is added first (its id must match the request)
  const candidate = !getTrack(state, trackId) && input ? resolveTrack(state, input) : undefined;
  if (candidate && candidate.id !== trackId) return state;
  const withTrack = candidate ? withTracks(state, [candidate]) : state;
  if (!getTrack(withTrack, trackId)) return state;
  const isMember = withTrack[list].includes(trackId);
  const ids = isMember ? withTrack[list].filter((id) => id !== trackId) : [trackId, ...withTrack[list]];
  const name = COLLECTION_NAMES[list];
  return withNotice({ ...withTrack, [list]: ids }, isMember ? `Removed from ${name}` : `Added to ${name}`);
}

/** Appends radio picks (deduplicated) when the queue is short, trimming old history. */
function appendRadioTracks(
  state: PlayerState,
  tracks: InnerTubeParsedTrack[],
  options: { minUpcoming: number; maxAppend: number }
): PlayerState {
  if (state.activeTrackId === null) return state;
  const resolved = tracks.map((t) => resolveTrack(state, t));
  const withAll = withTracks(state, resolved);
  const queueIds = fromRefs(
    mergeRadioIntoQueue(toRefs(withAll.queueIds), state.activeTrackId, toRefs(resolved.map((t) => t.id)), {
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
      return playNow(state, resolveTrack(state, action.track), [], action.source);
    case 'playFromList': {
      const track = resolveTrack(state, action.track);
      const context = resolveList(state, action.context);
      const contextIdx = context.findIndex((t) => t.id === track.id);
      return playNow(state, track, contextIdx >= 0 ? context.slice(contextIdx + 1) : [], action.source);
    }
    case 'shuffleList':
      return shuffleList(state, action.context, action.random, action.source);
    case 'playQueueItem':
      if (!state.queueIds.includes(action.trackId) || !getTrack(state, action.trackId)) return state;
      if (isMarkedUnplayable(state, action.trackId)) return refuseUnplayable(state, action.trackId);
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
      return trackUnplayable(state, action.trackId, action.random, action.reason, action.videoId);
    case 'alternateVideoFound':
      return alternateVideoFound(state, action);
    case 'streamStatusChanged': {
      if (state.activeTrackId === null) return state;
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
      return toggleMembership(state, action.trackId, 'likedIds', action.track);
    case 'toggleDownloaded':
      return toggleMembership(state, action.trackId, 'downloadedIds', action.track);
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
      if (state.network.waiting || state.activeTrackId === null) return state;
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

/** `ids` without duplicates or unknown ids, at most `limit` long (the same array when nothing changes). */
function uniqueKnown(state: PlayerState, ids: string[], limit = Number.POSITIVE_INFINITY): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (out.length >= limit) break;
    if (!seen.has(id) && getTrack(state, id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return sameList(out, ids) ? ids : out;
}

function pickRecords<T>(record: Record<string, T>, keep: ReadonlySet<string>): Record<string, T> {
  const keys = Object.keys(record);
  if (keys.every((key) => keep.has(key))) return record;
  const out: Record<string, T> = {};
  for (const key of keys) if (keep.has(key)) out[key] = record[key];
  return out;
}

/**
 * Re-establishes every invariant after a change: no duplicates or unknown ids, the active song in
 * the queue (an empty queue exactly when nothing is active), hand-queued marks only on upcoming
 * songs, the shelf without the active song, and no track objects that nothing references any more.
 */
function finalize(state: PlayerState): PlayerState {
  let queueIds = uniqueKnown(state, state.queueIds);
  const likedIds = uniqueKnown(state, state.likedIds);
  const downloadedIds = uniqueKnown(state, state.downloadedIds);
  const recentlyPlayedIds = uniqueKnown(state, state.recentlyPlayedIds, MAX_RECENTLY_PLAYED);
  let activeTrackId = getTrack(state, state.activeTrackId) ? state.activeTrackId : null;
  if (activeTrackId === null) activeTrackId = queueIds[0] ?? null;
  if (activeTrackId !== null && !queueIds.includes(activeTrackId)) queueIds = [activeTrackId, ...queueIds];

  const activeIdx = activeTrackId === null ? -1 : queueIds.indexOf(activeTrackId);
  const upcoming = new Set(queueIds.slice(activeIdx + 1));
  const queuedFiltered = [...new Set(state.userQueuedIds)].filter((id) => upcoming.has(id));
  const userQueuedIds = sameList(queuedFiltered, state.userQueuedIds) ? state.userQueuedIds : queuedFiltered;

  const historyFiltered = state.playHistory.filter((id) => getTrack(state, id)).slice(-MAX_PLAY_HISTORY);
  const playHistory = sameList(historyFiltered, state.playHistory) ? state.playHistory : historyFiltered;

  const active = getTrack(state, activeTrackId);
  const recommendations =
    active && state.recommendations.some((r) => isActiveRecommendation(active, r))
      ? state.recommendations.filter((r) => !isActiveRecommendation(active, r))
      : state.recommendations;

  const referenced = new Set([...queueIds, ...likedIds, ...downloadedIds, ...recentlyPlayedIds, ...playHistory]);
  const nothingLoaded = activeTrackId === null;

  return {
    ...state,
    tracksById: pickRecords(state.tracksById, referenced),
    triedVideoIdsByTrack: pickRecords(state.triedVideoIdsByTrack, referenced),
    unplayableTracks: pickRecords(state.unplayableTracks, referenced),
    queueIds,
    likedIds,
    downloadedIds,
    recentlyPlayedIds,
    activeTrackId,
    userQueuedIds,
    playHistory,
    recommendations,
    // Nothing loaded: nothing can play, seek or wait for the network
    isPlaying: nothingLoaded ? false : state.isPlaying,
    seekRequest: nothingLoaded ? null : state.seekRequest,
    playingFrom: nothingLoaded ? null : state.playingFrom,
    network: nothingLoaded && state.network.waiting ? { waiting: false, retryAttempt: 0 } : state.network,
  };
}

/** The player reducer. Returns the same object when an action changes nothing. */
export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  const next = reduce(state, action);
  return next === state ? state : finalize(next);
}

export function createInitialPlayerState(
  preferences: Partial<Pick<PlayerState, 'shuffleEnabled' | 'repeatMode' | 'autoplayRadio'>> = {}
): PlayerState {
  return {
    tracksById: {},
    likedIds: [],
    downloadedIds: [],
    recentlyPlayedIds: [],
    queueIds: [],
    userQueuedIds: [],
    activeTrackId: null,
    playingFrom: null,
    isPlaying: false,
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
    unplayableTracks: {},
    network: { waiting: false, retryAttempt: 0 },
    notice: null,
    seq: 0,
  };
}

/* ------------------------------------------ selectors ---------------------------------------- */

export function selectActiveTrack(state: Pick<PlayerState, 'tracksById' | 'activeTrackId'>): MetrolistTrack | null {
  return getTrack(state, state.activeTrackId) ?? null;
}

/** The known tracks of an id list, in order. */
export function selectTracks(tracksById: Record<string, MetrolistTrack>, ids: readonly string[]): MetrolistTrack[] {
  const out: MetrolistTrack[] = [];
  for (const id of ids) {
    const track = getTrack({ tracksById }, id);
    if (track) out.push(track);
  }
  return out;
}

export function selectQueueTracks(state: Pick<PlayerState, 'tracksById' | 'queueIds'>): MetrolistTrack[] {
  return selectTracks(state.tracksById, state.queueIds);
}

export function selectLikedTracks(state: Pick<PlayerState, 'tracksById' | 'likedIds'>): MetrolistTrack[] {
  return selectTracks(state.tracksById, state.likedIds);
}

export function selectDownloadedTracks(state: Pick<PlayerState, 'tracksById' | 'downloadedIds'>): MetrolistTrack[] {
  return selectTracks(state.tracksById, state.downloadedIds);
}

export function selectRecentlyPlayedTracks(
  state: Pick<PlayerState, 'tracksById' | 'recentlyPlayedIds'>
): MetrolistTrack[] {
  return selectTracks(state.tracksById, state.recentlyPlayedIds);
}

/** A song the listener wants to hear is still loading, buffering or waiting for the network. */
export function selectIsStreamLoading(state: PlayerState): boolean {
  if (!getTrack(state, state.activeTrackId) || !state.isPlaying) return false;
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

/** Why a song is known to be unplayable this session, or `null`. */
export function selectUnplayableReason(state: PlayerState, trackId: string): UnplayableReason | null {
  return hasOwn(state.unplayableTracks, trackId) ? state.unplayableTracks[trackId] : null;
}

/** Whether another upload of the song may still be tried before calling it unplayable. */
export function selectCanTryAlternateVideo(state: PlayerState, trackId: string): boolean {
  return !!getTrack(state, trackId) && selectTriedVideoIds(state, trackId).length < MAX_VIDEO_CANDIDATES_PER_TRACK;
}

/** Delay before the next network retry, or `null` when not waiting for the network. */
export function selectNetworkRetryDelayMs(state: PlayerState): number | null {
  return state.network.waiting ? computeRetryDelayMs(state.network.retryAttempt) : null;
}
