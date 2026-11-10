/**
 * Small, defensive localStorage persistence so liked songs, the saved library and player
 * preferences survive an app restart on every platform (browser, desktop bundle, Android / iOS WebView).
 */
import type { RepeatMode } from './metrolistCore';

const STORAGE_KEY = 'metrolist.player.v1';
const MAX_SAVED_TRACKS = 300;

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
};

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

export function loadPlayerState(): PersistedPlayerState {
  const state: PersistedPlayerState = { ...DEFAULT_PLAYER_STATE };
  try {
    if (typeof window === 'undefined' || !window.localStorage) return state;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return state;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return state;

    if (Array.isArray(parsed.library)) {
      const seen = new Set<string>();
      state.library = [];
      for (const entry of parsed.library.slice(0, MAX_SAVED_TRACKS)) {
        const track = readLibraryTrack(entry);
        if (track && !seen.has(track.videoId)) {
          seen.add(track.videoId);
          state.library.push(track);
        }
      }
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
  } catch {
    // Corrupt or unavailable storage (private mode, quota): start from defaults
  }
  return state;
}

export function savePlayerState(state: PersistedPlayerState): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const payload: PersistedPlayerState = {
      ...state,
      library: state.library.slice(0, MAX_SAVED_TRACKS),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage full or blocked: preferences simply will not persist
  }
}
