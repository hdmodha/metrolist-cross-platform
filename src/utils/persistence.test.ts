import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type { InnerTubeParsedTrack } from './metrolistCore';
import {
  DEFAULT_PLAYER_STATE,
  LEGACY_STORAGE_KEY,
  MAX_SAVED_QUEUE_TRACKS,
  POSITION_STORAGE_KEY,
  STORAGE_KEY,
  savePlaybackPosition,
  fromPersistedState,
  loadPlayerState,
  migrateLegacyState,
  savePlayerState,
  toPersistedState,
  type KeyValueStorage,
  type PersistedPlayerState,
  type PersistedTrack,
} from './persistence';
import {
  MAX_RECENTLY_PLAYED,
  createInitialPlayerState,
  playerReducer,
  type PlayerAction,
  type PlayerState,
} from '../player/playerCore';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

const vid = (name: string) => `vid${name}`.padEnd(11, '_');
const yt = (name: string, durationMs = 180000): InnerTubeParsedTrack => ({
  videoId: vid(name),
  title: `Song ${name}`,
  artist: `Artist ${name}`,
  album: `Album ${name}`,
  durationMs,
  thumbnailUrl: `https://img/${name}.jpg`,
});
const ytId = (name: string) => `ytm-${vid(name)}`;

function run(state: PlayerState, ...actions: PlayerAction[]): PlayerState {
  return actions.reduce(playerReducer, state);
}

/** A realistic session: likes, downloads, hand-queued songs, an alternate upload and a radio. */
function session(): PlayerState {
  return run(
    createInitialPlayerState({ shuffleEnabled: true, repeatMode: 'ALL', autoplayRadio: true }),
    { type: 'playFromSearch', track: yt('z') },
    { type: 'toggleLike', trackId: ytId('z') },
    { type: 'toggleLike', trackId: ytId('n'), track: yt('n') },
    { type: 'toggleDownloaded', trackId: ytId('d'), track: yt('d') },
    { type: 'playFromSearch', track: yt('a'), source: 'search' },
    { type: 'toggleLike', trackId: ytId('a') },
    { type: 'alternateVideoFound', trackId: ytId('a'), videoId: vid('a2'), durationMs: 190000 },
    { type: 'addToQueue', track: yt('u1') },
    {
      type: 'recommendationsLoaded',
      trackId: ytId('a'),
      seedVideoId: vid('a'),
      tracks: [yt('r1'), yt('r2')],
      continuation: 'TOKEN%3D',
    }
  );
}

describe('loadPlayerState / savePlayerState', () => {
  test('missing, corrupt or unavailable storage falls back to defaults', () => {
    assert.deepEqual(loadPlayerState(memoryStorage()), DEFAULT_PLAYER_STATE);
    assert.deepEqual(loadPlayerState(memoryStorage({ [STORAGE_KEY]: '{not json' })), DEFAULT_PLAYER_STATE);
    assert.deepEqual(loadPlayerState(memoryStorage({ [STORAGE_KEY]: '[1,2,3]' })), DEFAULT_PLAYER_STATE);
    assert.deepEqual(loadPlayerState(null), DEFAULT_PLAYER_STATE);
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    assert.deepEqual(loadPlayerState(throwing), DEFAULT_PLAYER_STATE);
    assert.equal(savePlayerState(DEFAULT_PLAYER_STATE, throwing), false);
    // Under node there is no window: the default storage is simply absent
    assert.deepEqual(loadPlayerState(), DEFAULT_PLAYER_STATE);
    assert.equal(savePlayerState(DEFAULT_PLAYER_STATE), false);
  });

  test('wrong types are ignored field by field', () => {
    const raw = {
      version: 2,
      volume: 3,
      isMuted: 'yes',
      repeatMode: 'SOMETIMES',
      tracks: [
        { id: ytId('a'), videoId: vid('a'), title: 'ok', artist: 'x', album: 5, durationMs: 'long', coverUrl: null },
        { id: 42, videoId: vid('b'), title: 'bad id', artist: 'x' },
        { id: 'trk-01', videoId: 'seed_1', title: 'old demo', artist: 'x' },
        { id: ytId('c'), videoId: '../etc', title: 'bad upload falls back to the id', artist: 'x' },
        { id: ytId('e'), videoId: vid('e'), title: '', artist: 'x' },
        'garbage',
        { id: ytId('a'), videoId: vid('a'), title: 'duplicate', artist: 'x' },
      ],
      likedIds: [ytId('a'), ytId('a'), 'ghost', 7, ytId('c')],
      downloadedIds: 'nope',
      recentlyPlayedIds: [ytId('c')],
      queueIds: [ytId('a'), 'trk-01'],
      userQueuedIds: [ytId('a'), 5, null],
      activeTrackId: 7,
      positionMs: 'soon',
      playingFrom: 'mars',
      radio: { seedVideoId: '../etc/passwd', continuation: 'x' },
    };
    const loaded = loadPlayerState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) }));
    assert.equal(loaded.volume, DEFAULT_PLAYER_STATE.volume);
    assert.equal(loaded.isMuted, false);
    assert.equal(loaded.repeatMode, 'OFF');
    assert.deepEqual(loaded.tracks.map((t) => t.title), ['ok', 'bad upload falls back to the id']);
    assert.deepEqual(loaded.tracks[0], { id: ytId('a'), videoId: vid('a'), title: 'ok', artist: 'x', album: '', durationMs: 0, coverUrl: '' });
    assert.equal(loaded.tracks[1].videoId, vid('c'));
    assert.deepEqual(loaded.likedIds, [ytId('a'), ytId('c')]);
    assert.deepEqual(loaded.downloadedIds, []);
    assert.deepEqual(loaded.recentlyPlayedIds, [ytId('c')]);
    assert.deepEqual(loaded.queueIds, [ytId('a')]);
    assert.deepEqual(loaded.userQueuedIds, [ytId('a')]);
    assert.equal(loaded.activeTrackId, null);
    assert.equal(loaded.positionMs, 0);
    assert.equal(loaded.playingFrom, null);
    assert.equal(loaded.radio, null);

    const badToken = loadPlayerState(
      memoryStorage({ [STORAGE_KEY]: JSON.stringify({ radio: { seedVideoId: vid('a'), continuation: 'has space' } }) })
    );
    assert.deepEqual(badToken.radio, { seedVideoId: vid('a'), continuation: null });
  });

  test('save caps the queue and recently played', () => {
    const storage = memoryStorage();
    const tracks: PersistedTrack[] = Array.from({ length: 250 }, (_, i) => ({
      id: `ytm-${`q${i}`.padEnd(11, '_')}`,
      videoId: `q${i}`.padEnd(11, '_'),
      title: `Q${i}`,
      artist: 'x',
      album: '',
      durationMs: 200000,
      coverUrl: '',
    }));
    const ids = tracks.map((t) => t.id);
    assert.equal(savePlayerState({ ...DEFAULT_PLAYER_STATE, tracks, queueIds: ids, recentlyPlayedIds: ids }, storage), true);
    const loaded = loadPlayerState(storage);
    assert.equal(loaded.queueIds.length, MAX_SAVED_QUEUE_TRACKS);
    assert.equal(loaded.recentlyPlayedIds.length, MAX_RECENTLY_PLAYED);
  });
});

describe('toPersistedState / fromPersistedState', () => {
  test('a session survives a save / load round trip, paused, at the saved position', () => {
    const before = session();
    const storage = memoryStorage();
    savePlayerState(toPersistedState(before, 61000, { volume: 0.4, isMuted: true }), storage);
    const saved = JSON.parse(storage.data[STORAGE_KEY]) as PersistedPlayerState;
    assert.equal(saved.version, 2);
    const loaded = loadPlayerState(storage);
    assert.equal(loaded.volume, 0.4);
    assert.equal(loaded.isMuted, true);

    const { player, positionMs } = fromPersistedState(loaded);
    assert.equal(positionMs, 61000);
    assert.deepEqual(player.queueIds, before.queueIds);
    assert.equal(player.activeTrackId, before.activeTrackId);
    assert.deepEqual(player.userQueuedIds, before.userQueuedIds);
    assert.deepEqual(player.likedIds, [ytId('a'), ytId('n'), ytId('z')]);
    assert.deepEqual(player.downloadedIds, [ytId('d')]);
    assert.deepEqual(player.recentlyPlayedIds, [ytId('a'), ytId('z')]);
    assert.equal(player.playingFrom, 'search');
    assert.deepEqual(player.radio, { seedVideoId: vid('a'), continuation: 'TOKEN%3D', status: 'idle', failedAttempts: 0 });
    assert.equal(player.shuffleEnabled, true);
    assert.equal(player.repeatMode, 'ALL');
    assert.equal(player.isPlaying, false);
    assert.equal(player.streamStatus, 'paused');
    assert.deepEqual(Object.keys(player.tracksById).sort(), Object.keys(before.tracksById).sort());
    // The working alternate upload is kept; ids never change; metadata survives
    for (const [id, was] of Object.entries(before.tracksById)) assert.deepEqual(player.tracksById[id], was, id);
    assert.equal(player.tracksById[ytId('a')].videoId, vid('a2'));

    // Feeding it to the reducer resumes at the saved position
    const resumed = playerReducer(createInitialPlayerState(), { type: 'restore', snapshot: player, positionMs });
    assert.equal(resumed.seekRequest?.ms, 61000);
    assert.equal(resumed.isPlaying, false);
    assert.deepEqual(resumed.likedIds, player.likedIds);
  });

  test('unknown ids are dropped and an active song outside the queue falls back to the first one', () => {
    const track = (name: string): PersistedTrack => ({ id: ytId(name), videoId: vid(name), title: `Song ${name}`, artist: 'A', album: '', durationMs: 200000, coverUrl: '' });
    const persisted: PersistedPlayerState = {
      ...DEFAULT_PLAYER_STATE,
      tracks: [track('a'), track('b')],
      queueIds: ['ghost', ytId('a'), ytId('b')],
      activeTrackId: 'ghost',
      positionMs: 50000,
      userQueuedIds: [ytId('a'), ytId('b'), 'ghost'],
    };
    const { player, positionMs } = fromPersistedState(persisted);
    assert.deepEqual(player.queueIds, [ytId('a'), ytId('b')]);
    assert.equal(player.activeTrackId, ytId('a'));
    assert.equal(positionMs, 0, 'the position belonged to another song');
    assert.deepEqual(player.userQueuedIds, [ytId('b')]);
  });

  test('a position beyond the song falls back to the start; an empty queue to nothing active', () => {
    const persisted: PersistedPlayerState = {
      ...DEFAULT_PLAYER_STATE,
      tracks: [{ id: ytId('a'), videoId: vid('a'), title: 'A', artist: '', album: '', durationMs: 200000, coverUrl: '' }],
      queueIds: [ytId('a')],
      activeTrackId: ytId('a'),
      positionMs: 999999,
      likedIds: [ytId('a')],
    };
    assert.equal(fromPersistedState(persisted).positionMs, 0);
    assert.equal(fromPersistedState({ ...persisted, positionMs: -5 }).positionMs, 0);
    assert.equal(fromPersistedState({ ...persisted, positionMs: 12000 }).positionMs, 12000);

    const { player, positionMs } = fromPersistedState({ ...persisted, queueIds: [], positionMs: 12000 });
    assert.equal(player.activeTrackId, null);
    assert.deepEqual(player.queueIds, []);
    assert.deepEqual(player.likedIds, [ytId('a')], 'the library survives without a queue');
    assert.equal(positionMs, 0);
  });

  test('a fresh player saves an empty library, and loads back as a fresh install', () => {
    const untouched = run(createInitialPlayerState(), { type: 'toggleShuffle' });
    const persisted = toPersistedState(untouched, 0);
    assert.deepEqual(persisted.tracks, []);
    assert.equal(persisted.activeTrackId, null);
    const { player } = fromPersistedState(persisted);
    assert.equal(player.activeTrackId, null);
    assert.equal(player.shuffleEnabled, true);
  });

  test('a long queue is saved as a 200-song window that keeps the playing song', () => {
    const many = Array.from({ length: 260 }, (_, i) => yt(`m${i}`));
    let state = run(createInitialPlayerState(), { type: 'playFromSearch', track: many[0] });
    for (const t of many.slice(1)) state = run(state, { type: 'addToQueue', track: t });
    state = run(state, { type: 'playQueueItem', trackId: ytId('m240') });
    const persisted = toPersistedState(state, 0);
    assert.equal(persisted.queueIds.length, MAX_SAVED_QUEUE_TRACKS);
    assert.ok(persisted.queueIds.includes(ytId('m240')));
    assert.ok(persisted.queueIds.includes(ytId('m259')));
    const { player } = fromPersistedState(persisted);
    assert.equal(player.activeTrackId, ytId('m240'));
    // Only songs some saved list refers to are stored
    const savedIds = new Set(persisted.tracks.map((t) => t.id));
    assert.equal(savedIds.size, persisted.tracks.length);
    assert.ok(!savedIds.has(ytId('m1')), 'a song cut from the saved queue window is not stored');
  });
});

/* ----------------------------------------- v1 → v2 ----------------------------------------- */

/** Data exactly as version 1 of the app saved it (with its built-in demo songs). */
function v1Data() {
  const snap = (name: string, flags: { liked?: boolean; cachedOffline?: boolean } = {}) => ({
    videoId: vid(name),
    title: `Song ${name}`,
    artist: `Artist ${name}`,
    album: `Album ${name}`,
    durationMs: 200000,
    coverUrl: `https://img/${name}.jpg`,
    liked: !!flags.liked,
    cachedOffline: !!flags.cachedOffline,
  });
  return {
    library: [snap('a', { liked: true }), snap('b', { cachedOffline: true }), snap('c', { liked: true, cachedOffline: true }), snap('d')],
    seedFlags: { 'trk-01': { liked: true, cachedOffline: true }, 'trk-04': { liked: true, cachedOffline: false } },
    volume: 0.5,
    isMuted: true,
    shuffleEnabled: true,
    repeatMode: 'ONE',
    autoplayRadio: false,
    eqGains: [2, 1, 0, 1, 3],
    queue: [
      { ...snap('d'), id: ytId('d') },
      { id: 'trk-02', videoId: 'ytm_TR_4412b', title: 'Shinjuku Raindrop Protocol', artist: 'Kaito', album: '', durationMs: 194000, coverUrl: '/assets/x.jpg', liked: true, cachedOffline: true },
      { ...snap('a', { liked: true }), id: ytId('a'), videoId: vid('a2'), durationMs: 210000 },
      { ...snap('e'), id: ytId('e') },
    ],
    activeTrackId: ytId('a'),
    positionMs: 42000,
    userQueuedIds: [ytId('e'), 'trk-02'],
    radio: { seedVideoId: vid('a'), continuation: 'TOKEN1' },
  };
}

describe('migration from version 1', () => {
  test('liked and downloaded songs keep their order; demo songs, their flags and the EQ are dropped', () => {
    const migrated = migrateLegacyState(v1Data());
    assert.equal(migrated.version, 2);
    assert.deepEqual(migrated.likedIds, [ytId('a'), ytId('c')]);
    assert.deepEqual(migrated.downloadedIds, [ytId('b'), ytId('c')]);
    assert.deepEqual(migrated.recentlyPlayedIds, [ytId('a'), ytId('b'), ytId('c'), ytId('d')], 'the old library becomes the history');
    assert.ok(!migrated.tracks.some((t) => !t.id.startsWith('ytm-')), 'no demo song survives');
    assert.ok(!('eqGains' in migrated));
    assert.ok(!('seedFlags' in migrated));
    // Queue without the demo song; the working upload of "a" is kept
    assert.deepEqual(migrated.queueIds, [ytId('d'), ytId('a'), ytId('e')]);
    assert.equal(migrated.activeTrackId, ytId('a'));
    assert.equal(migrated.positionMs, 42000);
    assert.deepEqual(migrated.userQueuedIds, [ytId('e')]);
    const a = migrated.tracks.find((t) => t.id === ytId('a'));
    assert.equal(a?.videoId, vid('a2'));
    assert.equal(a?.durationMs, 210000);
    assert.deepEqual(migrated.radio, { seedVideoId: vid('a'), continuation: 'TOKEN1' });
    assert.equal(migrated.volume, 0.5);
    assert.equal(migrated.isMuted, true);
    assert.equal(migrated.shuffleEnabled, true);
    assert.equal(migrated.repeatMode, 'ONE');
    assert.equal(migrated.autoplayRadio, false);
    assert.equal(migrated.playingFrom, null);

    const { player, positionMs } = fromPersistedState(migrated);
    assert.equal(player.activeTrackId, ytId('a'));
    assert.equal(positionMs, 42000);
    assert.equal(player.tracksById[ytId('c')].title, 'Song c');
  });

  test('a demo song that was playing becomes "nothing active"', () => {
    const migrated = migrateLegacyState({ ...v1Data(), activeTrackId: 'trk-02' });
    assert.equal(migrated.activeTrackId, null);
    assert.deepEqual(migrated.queueIds, []);
    assert.equal(migrated.positionMs, 0);
    assert.deepEqual(migrated.userQueuedIds, []);
    assert.equal(migrated.radio, null);
    assert.deepEqual(migrated.likedIds, [ytId('a'), ytId('c')], 'the library survives');
    const { player } = fromPersistedState(migrated);
    assert.equal(player.activeTrackId, null);
  });

  test('old data without a queue and garbage both migrate safely', () => {
    const noQueue = migrateLegacyState({ library: v1Data().library, volume: 0.3 });
    assert.equal(noQueue.activeTrackId, null);
    assert.deepEqual(noQueue.queueIds, []);
    assert.equal(noQueue.volume, 0.3);
    assert.deepEqual(noQueue.likedIds, [ytId('a'), ytId('c')]);
    assert.deepEqual(migrateLegacyState('nonsense'), DEFAULT_PLAYER_STATE);
    assert.deepEqual(migrateLegacyState({ library: [{ videoId: 'short', title: 'x', artist: 'y', liked: true }] }), DEFAULT_PLAYER_STATE);
  });

  test('loading migrates the v1 key once, stores v2 and removes v1', () => {
    const storage = memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(v1Data()) });
    const loaded = loadPlayerState(storage);
    assert.deepEqual(loaded.likedIds, [ytId('a'), ytId('c')]);
    assert.ok(storage.data[STORAGE_KEY], 'v2 is written');
    assert.equal(storage.data[LEGACY_STORAGE_KEY], undefined, 'v1 is removed');
    assert.deepEqual(loadPlayerState(storage), loaded, 'the next launch reads v2');
  });

  test('v2 wins over leftover v1 data; a corrupt v1 is left alone', () => {
    const v2 = toPersistedState(run(createInitialPlayerState(), { type: 'toggleLike', trackId: ytId('x'), track: yt('x') }), 0);
    const both = memoryStorage({ [STORAGE_KEY]: JSON.stringify(v2), [LEGACY_STORAGE_KEY]: JSON.stringify(v1Data()) });
    assert.deepEqual(loadPlayerState(both).likedIds, [ytId('x')]);

    const corrupt = memoryStorage({ [LEGACY_STORAGE_KEY]: '{oops' });
    assert.deepEqual(loadPlayerState(corrupt), DEFAULT_PLAYER_STATE);
    assert.equal(corrupt.data[LEGACY_STORAGE_KEY], '{oops');
    assert.equal(corrupt.data[STORAGE_KEY], undefined);
  });

  test('when v2 cannot be written the v1 data is kept for the next launch', () => {
    const data: Record<string, string> = { [LEGACY_STORAGE_KEY]: JSON.stringify(v1Data()) };
    const readOnly: KeyValueStorage = {
      getItem: (key) => data[key] ?? null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: (key) => {
        delete data[key];
      },
    };
    assert.deepEqual(loadPlayerState(readOnly).likedIds, [ytId('a'), ytId('c')]);
    assert.ok(data[LEGACY_STORAGE_KEY], 'v1 is not removed');
  });
});

describe('position key', () => {
  const full = (positionMs: number): PersistedPlayerState => ({
    ...DEFAULT_PLAYER_STATE,
    tracks: [{ id: `ytm-${vid('a')}`, videoId: vid('a'), title: 'A', artist: 'X', album: '', durationMs: 200000, coverUrl: '' }],
    queueIds: [`ytm-${vid('a')}`],
    activeTrackId: `ytm-${vid('a')}`,
    positionMs,
  });

  test('a full save also writes the position key', () => {
    const storage = memoryStorage();
    savePlayerState(full(5000), storage);
    assert.deepEqual(JSON.parse(storage.data[POSITION_STORAGE_KEY]), { trackId: `ytm-${vid('a')}`, positionMs: 5000 });
  });

  test('a newer position key wins over the full state', () => {
    const storage = memoryStorage();
    savePlayerState(full(5000), storage);
    assert.equal(savePlaybackPosition(`ytm-${vid('a')}`, 42000, storage), true);
    assert.equal(loadPlayerState(storage).positionMs, 42000);
  });

  test('a position of another track is ignored', () => {
    const storage = memoryStorage();
    savePlayerState(full(5000), storage);
    savePlaybackPosition('b', 42000, storage);
    assert.equal(loadPlayerState(storage).positionMs, 5000);
  });

  test('a corrupt position key is ignored', () => {
    for (const bad of ['{', '"x"', '{"trackId":"ytm-vida_______","positionMs":-1}', '{"trackId":"ytm-vida_______","positionMs":"9"}', '{"trackId":1,"positionMs":9}']) {
      const storage = memoryStorage();
      savePlayerState(full(5000), storage);
      storage.data[POSITION_STORAGE_KEY] = bad;
      assert.equal(loadPlayerState(storage).positionMs, 5000, bad);
    }
  });

  test('a position past the end is clamped like before', () => {
    const storage = memoryStorage();
    savePlayerState(full(5000), storage);
    savePlaybackPosition(`ytm-${vid('a')}`, 999999999, storage);
    assert.equal(fromPersistedState(loadPlayerState(storage)).positionMs, 0);
  });

  test('storage failures are swallowed', () => {
    const broken: KeyValueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    assert.equal(savePlaybackPosition(`ytm-${vid('a')}`, 1, broken), false);
    assert.equal(savePlayerState(full(1), broken), false);
  });
});
