/**
 * Small, defensive localStorage persistence so Liked Songs, Downloads, Recently played, player
 * preferences and the queue itself ("resume where you left off") survive an app restart on every
 * platform (browser, desktop bundle, Android / iOS WebView).
 *
 * Format v2 (`metrolist.player.v2`) is a normalized track table plus id lists. Data saved by
 * version 1 (`metrolist.player.v1`, a flat library with `liked` / `cachedOffline` flags and the
 * built-in demo songs) is migrated once on load, then removed.
 *
 * Everything read back is validated field by field: corrupt JSON, wrong types, unknown ids, an
 * active song that is not in the queue or a position past the end of the song all fall back safely.
 */
import type { MetrolistTrack } from '../data/track';
import {
  MAX_RECENTLY_PLAYED,
  createInitialPlayerState,
  toMetrolistTrack,
  type PlaySource,
  type PlayerState,
} from '../player/playerCore';
import type { RepeatMode } from '../player/queueRules';
import { isValidYouTubeVideoId, sanitizeRadioContinuation } from './metrolistCore';

export const STORAGE_KEY = 'metrolist.player.v2';
export const LEGACY_STORAGE_KEY = 'metrolist.player.v1';
/** Upper bound of stored songs (Liked Songs + Downloads + history + queue). */
const MAX_SAVED_TRACKS = 5000;
export const MAX_SAVED_QUEUE_TRACKS = 200;
/** Played songs kept in front of the current one when a long queue is cut to the saved window. */
const SAVED_QUEUE_HISTORY = 49;
const LIVE_ID_PREFIX = 'ytm-';
const PLAY_SOURCES: readonly PlaySource[] = ['home', 'search', 'liked', 'downloads', 'library', 'radio'];

export interface PersistedTrack {
  /** `ytm-<videoId of the first upload>`: never changes. */
  id: string;
  /** The upload that plays (may be an alternate upload of the same song). */
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  coverUrl: string;
}

export interface PersistedPlayerState {
  version: 2;
  /** Every song one of the id lists below refers to. */
  tracks: PersistedTrack[];
  likedIds: string[];
  downloadedIds: string[];
  recentlyPlayedIds: string[];
  /** At most `MAX_SAVED_QUEUE_TRACKS`, always containing `activeTrackId`. */
  queueIds: string[];
  userQueuedIds: string[];
  activeTrackId: string | null;
  positionMs: number;
  playingFrom: PlaySource | null;
  radio: { seedVideoId: string; continuation: string | null } | null;
  volume: number;
  isMuted: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  autoplayRadio: boolean;
}

export const DEFAULT_PLAYER_STATE: PersistedPlayerState = {
  version: 2,
  tracks: [],
  likedIds: [],
  downloadedIds: [],
  recentlyPlayedIds: [],
  queueIds: [],
  userQueuedIds: [],
  activeTrackId: null,
  positionMs: 0,
  playingFrom: null,
  radio: null,
  volume: 0.8,
  isMuted: false,
  shuffleEnabled: false,
  repeatMode: 'OFF',
  autoplayRadio: true,
};

/** The part of the Web Storage API persistence needs (injectable for tests). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

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

/** The video id a track id was created from (`ytm-<videoId>`), or `''`. */
function videoIdOfTrackId(id: unknown): string {
  if (typeof id !== 'string' || !id.startsWith(LIVE_ID_PREFIX)) return '';
  const videoId = id.slice(LIVE_ID_PREFIX.length);
  return isValidYouTubeVideoId(videoId) ? videoId : '';
}

function readTrack(value: unknown): PersistedTrack | null {
  if (!isRecord(value)) return null;
  const { id, title, artist } = value;
  const idVideoId = videoIdOfTrackId(id);
  if (!idVideoId || typeof title !== 'string' || !title || typeof artist !== 'string') return null;
  return {
    id: id as string,
    videoId: isValidYouTubeVideoId(value.videoId) ? String(value.videoId) : idVideoId,
    title,
    artist,
    album: typeof value.album === 'string' ? value.album : '',
    durationMs:
      typeof value.durationMs === 'number' && Number.isFinite(value.durationMs) && value.durationMs > 0
        ? value.durationMs
        : 0,
    coverUrl: typeof value.coverUrl === 'string' ? value.coverUrl : '',
  };
}

/** Unique strings of `list` that pass `keep`, at most `limit`. */
function readIds(list: unknown, limit: number, keep: (id: string) => boolean): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    if (out.length >= limit) break;
    if (typeof entry !== 'string' || seen.has(entry) || !keep(entry)) continue;
    seen.add(entry);
    out.push(entry);
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

/** Validates data in the v2 shape field by field. */
function readPersisted(parsed: unknown): PersistedPlayerState {
  const state: PersistedPlayerState = { ...DEFAULT_PLAYER_STATE };
  if (!isRecord(parsed)) return state;

  const tracks: PersistedTrack[] = [];
  const known = new Set<string>();
  if (Array.isArray(parsed.tracks)) {
    for (const entry of parsed.tracks) {
      if (tracks.length >= MAX_SAVED_TRACKS) break;
      const track = readTrack(entry);
      if (track && !known.has(track.id)) {
        known.add(track.id);
        tracks.push(track);
      }
    }
  }
  const isKnown = (id: string) => known.has(id);
  state.tracks = tracks;
  state.likedIds = readIds(parsed.likedIds, MAX_SAVED_TRACKS, isKnown);
  state.downloadedIds = readIds(parsed.downloadedIds, MAX_SAVED_TRACKS, isKnown);
  state.recentlyPlayedIds = readIds(parsed.recentlyPlayedIds, MAX_RECENTLY_PLAYED, isKnown);
  state.queueIds = readIds(parsed.queueIds, MAX_SAVED_QUEUE_TRACKS, isKnown);
  const queued = new Set(state.queueIds);
  state.userQueuedIds = readIds(parsed.userQueuedIds, MAX_SAVED_QUEUE_TRACKS, (id) => queued.has(id));
  state.activeTrackId =
    typeof parsed.activeTrackId === 'string' && queued.has(parsed.activeTrackId) ? parsed.activeTrackId : null;
  if (typeof parsed.positionMs === 'number' && Number.isFinite(parsed.positionMs) && parsed.positionMs > 0) {
    state.positionMs = parsed.positionMs;
  }
  state.playingFrom = PLAY_SOURCES.includes(parsed.playingFrom as PlaySource) ? (parsed.playingFrom as PlaySource) : null;
  state.radio = readRadio(parsed.radio);

  if (typeof parsed.volume === 'number' && parsed.volume >= 0 && parsed.volume <= 1) state.volume = parsed.volume;
  if (typeof parsed.isMuted === 'boolean') state.isMuted = parsed.isMuted;
  if (typeof parsed.shuffleEnabled === 'boolean') state.shuffleEnabled = parsed.shuffleEnabled;
  if (parsed.repeatMode === 'OFF' || parsed.repeatMode === 'ALL' || parsed.repeatMode === 'ONE') {
    state.repeatMode = parsed.repeatMode;
  }
  if (typeof parsed.autoplayRadio === 'boolean') state.autoplayRadio = parsed.autoplayRadio;
  return state;
}

/**
 * Converts data saved by version 1 into v2. Liked songs (`liked`) and downloads (`cachedOffline`)
 * keep their library order (newest first) and the library becomes Recently played. The built-in
 * demo songs (`trk-…` ids), their flags and the equalizer gains are dropped; a demo song that was
 * playing leaves nothing active (and no queue).
 */
export function migrateLegacyState(raw: unknown): PersistedPlayerState {
  if (!isRecord(raw)) return { ...DEFAULT_PLAYER_STATE };
  const tracks = new Map<string, PersistedTrack>();
  const likedIds: string[] = [];
  const downloadedIds: string[] = [];
  const libraryIds: string[] = [];

  for (const entry of Array.isArray(raw.library) ? raw.library : []) {
    if (!isRecord(entry) || !isValidYouTubeVideoId(entry.videoId)) continue;
    const id = `${LIVE_ID_PREFIX}${String(entry.videoId)}`;
    const track = readTrack({ ...entry, id });
    if (!track || tracks.has(id)) continue;
    tracks.set(id, track);
    libraryIds.push(id);
    if (entry.liked === true) likedIds.push(id);
    if (entry.cachedOffline === true) downloadedIds.push(id);
  }

  let queueIds: string[] = [];
  for (const entry of Array.isArray(raw.queue) ? raw.queue : []) {
    const track = readTrack(entry);
    if (!track || queueIds.includes(track.id)) continue;
    const library = tracks.get(track.id);
    // The queue snapshot holds the upload that worked last (and the real duration)
    tracks.set(track.id, library ? { ...library, videoId: track.videoId, durationMs: track.durationMs || library.durationMs } : track);
    queueIds.push(track.id);
  }

  const savedActive = typeof raw.activeTrackId === 'string' ? raw.activeTrackId : '';
  const activeIsDemo = savedActive !== '' && !videoIdOfTrackId(savedActive);
  if (activeIsDemo) queueIds = [];
  const activeTrackId = queueIds.includes(savedActive) ? savedActive : (queueIds[0] ?? null);
  const keepPosition = activeTrackId !== null && activeTrackId === savedActive;

  return readPersisted({
    tracks: [...tracks.values()],
    likedIds,
    downloadedIds,
    recentlyPlayedIds: libraryIds,
    queueIds,
    userQueuedIds: raw.userQueuedIds,
    activeTrackId,
    positionMs: keepPosition ? raw.positionMs : 0,
    radio: queueIds.length > 0 ? raw.radio : null,
    volume: raw.volume,
    isMuted: raw.isMuted,
    shuffleEnabled: raw.shuffleEnabled,
    repeatMode: raw.repeatMode,
    autoplayRadio: raw.autoplayRadio,
  });
}

/** Writes `state`; returns whether it was stored. */
export function savePlayerState(
  state: PersistedPlayerState,
  storage: KeyValueStorage | null = defaultStorage()
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // Storage full or blocked: the library simply will not persist
    return false;
  }
}

export function loadPlayerState(
  storage: KeyValueStorage | null = defaultStorage()
): PersistedPlayerState {
  try {
    if (!storage) return { ...DEFAULT_PLAYER_STATE };
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) return readPersisted(JSON.parse(raw));
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return { ...DEFAULT_PLAYER_STATE };
    const migrated = migrateLegacyState(JSON.parse(legacy));
    // Remove v1 only once its data is safely stored as v2
    if (savePlayerState(migrated, storage)) storage.removeItem(LEGACY_STORAGE_KEY);
    return migrated;
  } catch {
    // Corrupt or unavailable storage (private mode, quota): start from defaults
    return { ...DEFAULT_PLAYER_STATE };
  }
}

/* ------------------------------------- player state mappers ---------------------------------- */

export interface PersistedAudioSettings {
  volume: number;
  isMuted: boolean;
}

function toPersistedTrack(track: MetrolistTrack): PersistedTrack {
  return {
    id: track.id,
    videoId: track.videoId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    durationMs: track.durationMs,
    coverUrl: track.coverUrl,
  };
}

/** Snapshot of the player (plus audio settings) in the saved format. */
export function toPersistedState(
  player: PlayerState,
  positionMs: number,
  audio: PersistedAudioSettings = DEFAULT_PLAYER_STATE
): PersistedPlayerState {
  // A long queue is cut to a window that always contains the playing song
  const activeIdx = player.activeTrackId === null ? -1 : player.queueIds.indexOf(player.activeTrackId);
  const start = Math.max(
    0,
    Math.min(activeIdx - SAVED_QUEUE_HISTORY, player.queueIds.length - MAX_SAVED_QUEUE_TRACKS)
  );
  const queueIds = player.queueIds.slice(start, start + MAX_SAVED_QUEUE_TRACKS);
  const savedQueue = new Set(queueIds);
  const recentlyPlayedIds = player.recentlyPlayedIds.slice(0, MAX_RECENTLY_PLAYED);

  const tracks: PersistedTrack[] = [];
  const stored = new Set<string>();
  for (const id of [...player.likedIds, ...player.downloadedIds, ...recentlyPlayedIds, ...queueIds]) {
    const track = player.tracksById[id];
    if (!track || stored.has(id)) continue;
    stored.add(id);
    tracks.push(toPersistedTrack(track));
  }
  const active = player.activeTrackId === null ? undefined : player.tracksById[player.activeTrackId];

  return {
    version: 2,
    tracks,
    likedIds: player.likedIds,
    downloadedIds: player.downloadedIds,
    recentlyPlayedIds,
    queueIds,
    userQueuedIds: player.userQueuedIds.filter((id) => savedQueue.has(id)),
    activeTrackId: active ? player.activeTrackId : null,
    positionMs:
      active && Number.isFinite(positionMs) ? Math.max(0, Math.min(positionMs, active.durationMs)) : 0,
    playingFrom: player.playingFrom,
    radio: player.radio ? { seedVideoId: player.radio.seedVideoId, continuation: player.radio.continuation } : null,
    volume: audio.volume,
    isMuted: audio.isMuted,
    shuffleEnabled: player.shuffleEnabled,
    repeatMode: player.repeatMode,
    autoplayRadio: player.autoplayRadio,
  };
}

function toPlayerTrack(saved: PersistedTrack): MetrolistTrack {
  // `toMetrolistTrack` never keeps a missing or preview-length duration
  return {
    ...toMetrolistTrack({
      videoId: saved.videoId,
      title: saved.title,
      artist: saved.artist,
      album: saved.album,
      durationMs: saved.durationMs,
      thumbnailUrl: saved.coverUrl,
    }),
    id: saved.id,
  };
}

/**
 * Rebuilds the player from saved data. Always paused; `positionMs` is where to resume (0 when it
 * does not fit the restored song). Pass both to the reducer's `restore` action.
 */
export function fromPersistedState(persisted: PersistedPlayerState): { player: PlayerState; positionMs: number } {
  const base = createInitialPlayerState({
    shuffleEnabled: persisted.shuffleEnabled,
    repeatMode: persisted.repeatMode,
    autoplayRadio: persisted.autoplayRadio,
  });
  const tracksById: Record<string, MetrolistTrack> = {};
  for (const saved of persisted.tracks) {
    if (videoIdOfTrackId(saved.id) && !Object.prototype.hasOwnProperty.call(tracksById, saved.id)) {
      tracksById[saved.id] = toPlayerTrack(saved);
    }
  }
  const known = (ids: string[]) => ids.filter((id) => Object.prototype.hasOwnProperty.call(tracksById, id));
  const queueIds = known(persisted.queueIds);
  const library = {
    ...base,
    tracksById,
    likedIds: known(persisted.likedIds),
    downloadedIds: known(persisted.downloadedIds),
    recentlyPlayedIds: known(persisted.recentlyPlayedIds),
  };
  if (queueIds.length === 0) return { player: library, positionMs: 0 };

  const savedActive = persisted.activeTrackId;
  const activeTrackId = savedActive !== null && queueIds.includes(savedActive) ? savedActive : queueIds[0];
  const activeDuration = tracksById[activeTrackId].durationMs;
  const positionMs =
    activeTrackId === savedActive && persisted.positionMs > 0 && persisted.positionMs < activeDuration
      ? persisted.positionMs
      : 0;
  const upcoming = new Set(queueIds.slice(queueIds.indexOf(activeTrackId) + 1));

  return {
    player: {
      ...library,
      queueIds,
      activeTrackId,
      playingFrom: persisted.playingFrom,
      userQueuedIds: persisted.userQueuedIds.filter((id) => upcoming.has(id)),
      radio: persisted.radio ? { ...persisted.radio, status: 'idle', failedAttempts: 0 } : null,
    },
    positionMs,
  };
}
