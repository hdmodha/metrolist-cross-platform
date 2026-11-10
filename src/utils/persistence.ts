/**
 * Small, defensive localStorage persistence so liked songs, the saved library, player preferences
 * and the queue itself (Metrolist-style "resume where you left off") survive an app restart on
 * every platform (browser, desktop bundle, Android / iOS WebView).
 *
 * Everything read back is validated field by field: corrupt JSON, wrong types, unknown ids, an
 * active song that is not in the queue or a position past the end of the song all fall back safely.
 */
import type { MetrolistTrack } from '../data/metrolistData';
import {
  PREVIEW_DURATION_MS,
  createInitialPlayerState,
  liveTrackId,
  toMetrolistTrack,
  type PlayerState,
} from '../player/playerCore';
import type { RepeatMode } from '../player/queueRules';
import { isValidYouTubeVideoId, sanitizeRadioContinuation } from './metrolistCore';

const STORAGE_KEY = 'metrolist.player.v1';
const MAX_SAVED_TRACKS = 300;
export const MAX_SAVED_QUEUE_TRACKS = 200;
/** Played songs kept in front of the current one when a long queue is cut to the saved window. */
const SAVED_QUEUE_HISTORY = 49;
const LIVE_ID_PREFIX = 'ytm-';

export interface PersistedLibraryTrack {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string;
  liked: boolean;
  cachedOffline: boolean;
}

/** A queue entry: the track id is kept because a live song may play from an alternate upload. */
export interface PersistedQueueTrack extends PersistedLibraryTrack {
  id: string;
}

export interface PersistedPlayerState {
  /** Live YouTube Music tracks the listener has played / saved, most recent first. */
  library: PersistedLibraryTrack[];
  /** Like / download flags for the built-in seed tracks, keyed by track id. */
  seedFlags: Record<string, { liked: boolean; cachedOffline: boolean }>;
  volume: number;
  isMuted: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  autoplayRadio: boolean;
  eqGains: number[];
  /** Saved queue (snapshots, at most 200). Missing in data saved by older versions. */
  queue?: PersistedQueueTrack[];
  activeTrackId?: string;
  positionMs?: number;
  userQueuedIds?: string[];
  radio?: { seedVideoId: string; continuation: string | null } | null;
}

export const DEFAULT_PLAYER_STATE: PersistedPlayerState = {
  library: [],
  seedFlags: {},
  volume: 0.8,
  isMuted: false,
  shuffleEnabled: false,
  repeatMode: 'OFF',
  autoplayRadio: true,
  eqGains: [2, 1, 0, 1, 3],
  queue: [],
  activeTrackId: '',
  positionMs: 0,
  userQueuedIds: [],
  radio: null,
};

/** The part of the Web Storage API persistence needs (injectable for tests). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    // Accessing localStorage itself throws when site data is blocked
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readLibraryTrack(value: unknown): PersistedLibraryTrack | null {
  if (!isRecord(value)) return null;
  const { videoId, title, artist } = value;
  if (typeof videoId !== 'string' || typeof title !== 'string' || typeof artist !== 'string') {
    return null;
  }
  if (!videoId || !title) return null;
  return {
    videoId,
    title,
    artist,
    album: typeof value.album === 'string' ? value.album : '',
    durationMs:
      typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
        ? value.durationMs
        : 0,
    coverUrl: typeof value.coverUrl === 'string' ? value.coverUrl : '',
    liked: value.liked === true,
    cachedOffline: value.cachedOffline === true,
  };
}

function readQueueTrack(value: unknown): PersistedQueueTrack | null {
  const track = readLibraryTrack(value);
  if (!track || !isRecord(value) || typeof value.id !== 'string' || !value.id) return null;
  return { ...track, id: value.id };
}

function readUnique<T>(list: unknown, limit: number, read: (v: unknown) => T | null, key: (t: T) => string): T[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const entry of list.slice(0, limit)) {
    const item = read(entry);
    if (item !== null && !seen.has(key(item))) {
      seen.add(key(item));
      out.push(item);
    }
  }
  return out;
}

function readRadio(value: unknown): PersistedPlayerState['radio'] {
  if (!isRecord(value) || !isValidYouTubeVideoId(value.seedVideoId)) return null;
  return {
    seedVideoId: String(value.seedVideoId),
    continuation: sanitizeRadioContinuation(value.continuation) || null,
  };
}

export function loadPlayerState(
  storage: KeyValueStorage | null = defaultStorage()
): PersistedPlayerState {
  const state: PersistedPlayerState = { ...DEFAULT_PLAYER_STATE };
  try {
    if (!storage) return state;
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return state;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return state;

    if (Array.isArray(parsed.library)) {
      state.library = readUnique(parsed.library, MAX_SAVED_TRACKS, readLibraryTrack, (t) => t.videoId);
    }
    if (isRecord(parsed.seedFlags)) {
      const flags: PersistedPlayerState['seedFlags'] = {};
      for (const [id, value] of Object.entries(parsed.seedFlags)) {
        if (isRecord(value)) {
          flags[id] = { liked: value.liked === true, cachedOffline: value.cachedOffline === true };
        }
      }
      state.seedFlags = flags;
    }
    if (typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1) {
      state.volume = parsed.volume;
    }
    if (typeof parsed.isMuted === 'boolean') state.isMuted = parsed.isMuted;
    if (typeof parsed.shuffleEnabled === 'boolean') state.shuffleEnabled = parsed.shuffleEnabled;
    if (parsed.repeatMode === 'OFF' || parsed.repeatMode === 'ALL' || parsed.repeatMode === 'ONE') {
      state.repeatMode = parsed.repeatMode;
    }
    if (typeof parsed.autoplayRadio === 'boolean') state.autoplayRadio = parsed.autoplayRadio;
    if (
      Array.isArray(parsed.eqGains) &&
      parsed.eqGains.length === DEFAULT_PLAYER_STATE.eqGains.length &&
      parsed.eqGains.every((g) => typeof g === 'number' && g >= -12 && g <= 12)
    ) {
      state.eqGains = parsed.eqGains as number[];
    }

    state.queue = readUnique(parsed.queue, MAX_SAVED_QUEUE_TRACKS, readQueueTrack, (t) => t.id);
    if (typeof parsed.activeTrackId === 'string') state.activeTrackId = parsed.activeTrackId;
    if (typeof parsed.positionMs === 'number' && Number.isFinite(parsed.positionMs) && parsed.positionMs > 0) {
      state.positionMs = parsed.positionMs;
    }
    state.userQueuedIds = readUnique(
      parsed.userQueuedIds,
      MAX_SAVED_QUEUE_TRACKS,
      (v) => (typeof v === 'string' && v ? v : null),
      (id) => id
    );
    state.radio = readRadio(parsed.radio);
  } catch {
    // Corrupt or unavailable storage (private mode, quota): start from defaults
    return { ...DEFAULT_PLAYER_STATE };
  }
  return state;
}

export function savePlayerState(
  state: PersistedPlayerState,
  storage: KeyValueStorage | null = defaultStorage()
): void {
  try {
    if (!storage) return;
    const payload: PersistedPlayerState = {
      ...state,
      library: state.library.slice(0, MAX_SAVED_TRACKS),
      ...(state.queue ? { queue: state.queue.slice(0, MAX_SAVED_QUEUE_TRACKS) } : {}),
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage full or blocked: preferences simply will not persist
  }
}

/* ------------------------------------- player state mappers ---------------------------------- */

export interface PersistedAudioSettings {
  volume: number;
  isMuted: boolean;
  eqGains: number[];
}

function toLibrarySnapshot(track: MetrolistTrack, videoId: string): PersistedLibraryTrack {
  return {
    videoId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    coverUrl: track.coverUrl,
    liked: track.liked,
    cachedOffline: track.cachedOffline,
  };
}

/** The video id a live track id was created from (`ytm-<videoId>`), or `''`. */
function videoIdOfLiveId(id: string): string {
  if (!id.startsWith(LIVE_ID_PREFIX)) return '';
  const videoId = id.slice(LIVE_ID_PREFIX.length);
  return isValidYouTubeVideoId(videoId) ? videoId : '';
}

/** Snapshot of the player (plus audio settings) in the saved format. */
export function toPersistedState(
  player: PlayerState,
  positionMs: number,
  audio: PersistedAudioSettings = DEFAULT_PLAYER_STATE
): PersistedPlayerState {
  const library: PersistedLibraryTrack[] = [];
  const seedFlags: PersistedPlayerState['seedFlags'] = {};
  for (const id of player.libraryIds) {
    const track = player.tracksById[id];
    if (!track) continue;
    if (track.isLiveInnerTube) {
      library.push(toLibrarySnapshot(track, videoIdOfLiveId(id) || track.videoId));
    } else {
      seedFlags[id] = { liked: track.liked, cachedOffline: track.cachedOffline };
    }
  }

  // A long queue is cut to a window that always contains the playing song
  const activeIdx = player.queueIds.indexOf(player.activeTrackId);
  const start = Math.max(
    0,
    Math.min(activeIdx - SAVED_QUEUE_HISTORY, player.queueIds.length - MAX_SAVED_QUEUE_TRACKS)
  );
  const queueIds = player.queueIds.slice(start, start + MAX_SAVED_QUEUE_TRACKS);
  const queue: PersistedQueueTrack[] = [];
  for (const id of queueIds) {
    const track = player.tracksById[id];
    if (track) queue.push({ ...toLibrarySnapshot(track, track.videoId), id });
  }
  const active = player.tracksById[player.activeTrackId];
  const savedIds = new Set(queueIds);

  return {
    library,
    seedFlags,
    volume: audio.volume,
    isMuted: audio.isMuted,
    eqGains: audio.eqGains,
    shuffleEnabled: player.shuffleEnabled,
    repeatMode: player.repeatMode,
    autoplayRadio: player.autoplayRadio,
    queue,
    activeTrackId: player.activeTrackId,
    positionMs:
      active && Number.isFinite(positionMs) ? Math.max(0, Math.min(positionMs, active.durationMs)) : 0,
    userQueuedIds: player.userQueuedIds.filter((id) => savedIds.has(id)),
    radio: player.radio
      ? { seedVideoId: player.radio.seedVideoId, continuation: player.radio.continuation }
      : null,
  };
}

function liveTrackFromSnapshot(snapshot: PersistedLibraryTrack, id: string): MetrolistTrack {
  return {
    ...toMetrolistTrack({
      videoId: snapshot.videoId,
      title: snapshot.title,
      artist: snapshot.artist,
      album: snapshot.album,
      durationMs: snapshot.durationMs,
      thumbnailUrl: snapshot.coverUrl,
    }),
    id,
    liked: snapshot.liked,
    cachedOffline: snapshot.cachedOffline,
  };
}

/**
 * Rebuilds the player from saved data. Always paused; `positionMs` is where to resume (0 when it
 * does not fit the restored song). Pass both to the reducer's `restore` action.
 */
export function fromPersistedState(
  persisted: PersistedPlayerState,
  seedTracks: MetrolistTrack[]
): { player: PlayerState; positionMs: number } {
  const seeds = seedTracks.map((seedTrack) => {
    const flags = persisted.seedFlags[seedTrack.id];
    return flags ? { ...seedTrack, liked: flags.liked, cachedOffline: flags.cachedOffline } : seedTrack;
  });
  const base = createInitialPlayerState(seeds, {
    shuffleEnabled: persisted.shuffleEnabled,
    repeatMode: persisted.repeatMode,
    autoplayRadio: persisted.autoplayRadio,
  });

  const tracksById: Record<string, MetrolistTrack> = { ...base.tracksById };
  const liveLibraryIds: string[] = [];
  for (const saved of persisted.library) {
    if (!isValidYouTubeVideoId(saved.videoId)) continue;
    const id = liveTrackId(saved.videoId);
    if (Object.prototype.hasOwnProperty.call(tracksById, id)) continue;
    tracksById[id] = liveTrackFromSnapshot(saved, id);
    liveLibraryIds.push(id);
  }
  const libraryIds = [...liveLibraryIds, ...base.libraryIds];

  const queueIds: string[] = [];
  for (const snapshot of persisted.queue ?? []) {
    const known = Object.prototype.hasOwnProperty.call(tracksById, snapshot.id) ? tracksById[snapshot.id] : undefined;
    if (known && !known.isLiveInnerTube) {
      // Seed metadata always comes from the app, never from storage
      queueIds.push(snapshot.id);
      continue;
    }
    if (!videoIdOfLiveId(snapshot.id)) continue;
    const videoId = isValidYouTubeVideoId(snapshot.videoId) ? snapshot.videoId : videoIdOfLiveId(snapshot.id);
    tracksById[snapshot.id] = known
      ? {
          ...known,
          videoId,
          durationMs: snapshot.durationMs > PREVIEW_DURATION_MS ? snapshot.durationMs : known.durationMs,
        }
      : liveTrackFromSnapshot({ ...snapshot, videoId }, snapshot.id);
    queueIds.push(snapshot.id);
  }

  if (queueIds.length === 0) {
    // Nothing usable was saved: start like a fresh install (with the restored library)
    return { player: { ...base, tracksById, libraryIds }, positionMs: 0 };
  }

  const savedActive = persisted.activeTrackId ?? '';
  const activeTrackId = queueIds.includes(savedActive) ? savedActive : queueIds[0];
  const activeDuration = tracksById[activeTrackId].durationMs;
  const savedPosition = persisted.positionMs ?? 0;
  const positionMs =
    activeTrackId === savedActive && savedPosition > 0 && savedPosition < activeDuration ? savedPosition : 0;

  const upcoming = new Set(queueIds.slice(queueIds.indexOf(activeTrackId) + 1));
  const radio = persisted.radio
    ? { seedVideoId: persisted.radio.seedVideoId, continuation: persisted.radio.continuation, status: 'idle' as const, failedAttempts: 0 }
    : null;

  return {
    player: {
      ...base,
      tracksById,
      libraryIds,
      queueIds,
      activeTrackId,
      hasStartedPlayback: true,
      userQueuedIds: (persisted.userQueuedIds ?? []).filter((id) => upcoming.has(id)),
      radio,
    },
    positionMs,
  };
}
