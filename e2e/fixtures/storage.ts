/**
 * Saved data to seed localStorage with before the app loads (`app.open({ storage })`): the current
 * v2 format, and the v1 format older versions of the app wrote (for the migration test).
 */
import type { InnerTubeParsedTrack } from '../../src/utils/metrolistCore';
import { searchResultsFor } from './apiFixtures';
import type { SeedStorage } from './test';

export const V2_KEY = 'metrolist.player.v2';
export const V1_KEY = 'metrolist.player.v1';
export const RECENT_SEARCHES_KEY = 'metrolist.recentSearches.v1';

/** `n` distinct fixture songs (the search fixture for `query`). */
export function songs(query: string, n = 12): InnerTubeParsedTrack[] {
  return searchResultsFor(query).slice(0, n);
}

const id = (t: InnerTubeParsedTrack) => `ytm-${t.videoId}`;

function stored(t: InnerTubeParsedTrack) {
  return { id: id(t), videoId: t.videoId, title: t.title, artist: t.artist, album: t.album, durationMs: t.durationMs, coverUrl: t.thumbnailUrl };
}

export function v2Storage(options: {
  liked?: InnerTubeParsedTrack[];
  downloaded?: InnerTubeParsedTrack[];
  recent?: InnerTubeParsedTrack[];
  queue?: InnerTubeParsedTrack[];
  activeIndex?: number;
  positionMs?: number;
  autoplayRadio?: boolean;
  recentSearches?: string[];
}): SeedStorage {
  const all = new Map<string, InnerTubeParsedTrack>();
  for (const t of [...(options.liked ?? []), ...(options.downloaded ?? []), ...(options.recent ?? []), ...(options.queue ?? [])]) all.set(id(t), t);
  const queue = options.queue ?? [];
  const storage: SeedStorage = {
    [V2_KEY]: JSON.stringify({
      version: 2,
      tracks: [...all.values()].map(stored),
      likedIds: (options.liked ?? []).map(id),
      downloadedIds: (options.downloaded ?? []).map(id),
      recentlyPlayedIds: (options.recent ?? []).map(id),
      queueIds: queue.map(id),
      userQueuedIds: [],
      activeTrackId: queue.length > 0 ? id(queue[options.activeIndex ?? 0]) : null,
      positionMs: options.positionMs ?? 0,
      playingFrom: null,
      radio: null,
      volume: 0.8,
      isMuted: false,
      shuffleEnabled: false,
      repeatMode: 'OFF',
      autoplayRadio: options.autoplayRadio ?? true,
    }),
  };
  if (options.recentSearches) storage[RECENT_SEARCHES_KEY] = JSON.stringify(options.recentSearches);
  return storage;
}

/** Version 1 data: a flat library with like / download flags, plus the old built-in demo songs. */
export function v1Storage(library: Array<InnerTubeParsedTrack & { liked?: boolean; cachedOffline?: boolean }>): SeedStorage {
  return {
    [V1_KEY]: JSON.stringify({
      library: library.map((t) => ({
        videoId: t.videoId,
        title: t.title,
        artist: t.artist,
        album: t.album,
        durationMs: t.durationMs,
        coverUrl: t.thumbnailUrl,
        liked: !!t.liked,
        cachedOffline: !!t.cachedOffline,
      })),
      seedFlags: { 'trk-01': { liked: true, cachedOffline: true } },
      volume: 0.6,
      isMuted: false,
      shuffleEnabled: false,
      repeatMode: 'ALL',
      autoplayRadio: true,
      eqGains: [2, 1, 0, 1, 3],
      queue: [
        { id: 'trk-01', videoId: 'ytm_NP_9081a', title: 'Night Prism', artist: 'Obsidian Sound', album: '', durationMs: 218000, coverUrl: '/assets/x.jpg', liked: true, cachedOffline: true },
      ],
      activeTrackId: 'trk-01',
      positionMs: 30000,
      userQueuedIds: [],
      radio: null,
    }),
  };
}
