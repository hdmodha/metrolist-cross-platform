import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type { MetrolistTrack } from '../data/metrolistData';
import type { InnerTubeParsedTrack } from './metrolistCore';
import {
  DEFAULT_PLAYER_STATE,
  MAX_SAVED_QUEUE_TRACKS,
  fromPersistedState,
  loadPlayerState,
  savePlayerState,
  toPersistedState,
  type KeyValueStorage,
  type PersistedPlayerState,
} from './persistence';
import { createInitialPlayerState, playerReducer, type PlayerAction, type PlayerState } from '../player/playerCore';

const STORAGE_KEY = 'metrolist.player.v1';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

function seed(n: number): MetrolistTrack {
  return {
    id: `trk-0${n}`,
    videoId: `seed_${n}`,
    title: `Seed ${n}`,
    artist: 'Seed Artist',
    album: 'Seed Album',
    durationMs: 200000,
    bpm: 100,
    rootFreqHz: 220,
    chordIntervals: [0, 3, 7],
    coverUrl: 'seed.jpg',
    genre: 'Ambient',
    liked: false,
    cachedOffline: false,
  };
}
const SEEDS = [seed(1), seed(2), seed(3)];

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

/** A realistic session: live songs, likes, hand-queued songs, an alternate upload and a radio. */
function session(): PlayerState {
  return run(
    createInitialPlayerState(SEEDS, { shuffleEnabled: true, repeatMode: 'ALL', autoplayRadio: true }),
    { type: 'playFromList', track: SEEDS[0], context: SEEDS },
    { type: 'toggleLike', trackId: 'trk-02' },
    { type: 'playFromSearch', track: yt('a') },
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
    };
    assert.deepEqual(loadPlayerState(throwing), DEFAULT_PLAYER_STATE);
    assert.doesNotThrow(() => savePlayerState(DEFAULT_PLAYER_STATE, throwing));
    // Under node there is no window: the default storage is simply absent
    assert.deepEqual(loadPlayerState(), DEFAULT_PLAYER_STATE);
    assert.doesNotThrow(() => savePlayerState(DEFAULT_PLAYER_STATE));
  });

  test('old saved data without a queue still loads', () => {
    const v1 = {
      library: [
        { videoId: vid('a'), title: 'Song a', artist: 'A', album: 'X', durationMs: 200000, coverUrl: 'c', liked: true, cachedOffline: false },
      ],
      seedFlags: { 'trk-01': { liked: true, cachedOffline: true } },
      volume: 0.5,
      isMuted: false,
      shuffleEnabled: true,
      repeatMode: 'ONE',
      autoplayRadio: false,
      eqGains: [0, 0, 0, 0, 0],
    };
    const loaded = loadPlayerState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(v1) }));
    assert.equal(loaded.library.length, 1);
    assert.equal(loaded.volume, 0.5);
    assert.equal(loaded.repeatMode, 'ONE');
    assert.deepEqual(loaded.queue, []);
    assert.equal(loaded.activeTrackId, '');
    assert.equal(loaded.positionMs, 0);
    assert.deepEqual(loaded.userQueuedIds, []);
    assert.equal(loaded.radio, null);

    const { player, positionMs } = fromPersistedState(loaded, SEEDS);
    assert.deepEqual(player.queueIds, ['trk-01', 'trk-02', 'trk-03']);
    assert.equal(player.activeTrackId, 'trk-01');
    assert.equal(player.hasStartedPlayback, false);
    assert.equal(positionMs, 0);
    assert.deepEqual(player.libraryIds, [ytId('a'), 'trk-01', 'trk-02', 'trk-03']);
    assert.equal(player.tracksById['trk-01'].liked, true);
    assert.equal(player.tracksById['trk-01'].cachedOffline, true);
    assert.equal(player.tracksById[ytId('a')].liked, true);
    assert.equal(player.autoplayRadio, false);
  });

  test('wrong types in the new fields are ignored field by field', () => {
    const raw = {
      volume: 3,
      queue: [
        { id: ytId('a'), videoId: vid('a'), title: 'ok', artist: 'x' },
        { id: 42, videoId: vid('b'), title: 'bad id', artist: 'x' },
        'garbage',
        { id: ytId('a'), videoId: vid('a'), title: 'duplicate', artist: 'x' },
      ],
      activeTrackId: 7,
      positionMs: 'soon',
      userQueuedIds: [ytId('a'), 5, null],
      radio: { seedVideoId: '../etc/passwd', continuation: 'x' },
    };
    const loaded = loadPlayerState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(raw) }));
    assert.equal(loaded.volume, DEFAULT_PLAYER_STATE.volume);
    assert.deepEqual(loaded.queue?.map((t) => t.title), ['ok']);
    assert.equal(loaded.activeTrackId, '');
    assert.equal(loaded.positionMs, 0);
    assert.deepEqual(loaded.userQueuedIds, [ytId('a')]);
    assert.equal(loaded.radio, null);

    const badToken = loadPlayerState(
      memoryStorage({ [STORAGE_KEY]: JSON.stringify({ radio: { seedVideoId: vid('a'), continuation: 'has space' } }) })
    );
    assert.deepEqual(badToken.radio, { seedVideoId: vid('a'), continuation: null });
  });

  test('save caps the queue and the library', () => {
    const storage = memoryStorage();
    const queue = Array.from({ length: 250 }, (_, i) => ({
      id: `ytm-${`q${i}`.padEnd(11, '_')}`,
      videoId: `q${i}`.padEnd(11, '_'),
      title: `Q${i}`,
      artist: 'x',
      album: '',
      durationMs: 200000,
      coverUrl: '',
      liked: false,
      cachedOffline: false,
    }));
    savePlayerState({ ...DEFAULT_PLAYER_STATE, queue }, storage);
    const saved = JSON.parse(storage.data[STORAGE_KEY]) as PersistedPlayerState;
    assert.equal(saved.queue?.length, MAX_SAVED_QUEUE_TRACKS);
    assert.equal(loadPlayerState(storage).queue?.length, MAX_SAVED_QUEUE_TRACKS);
  });
});

describe('toPersistedState / fromPersistedState', () => {
  test('a session survives a save / load round trip, paused, at the saved position', () => {
    const before = session();
    const storage = memoryStorage();
    savePlayerState(toPersistedState(before, 61000, { volume: 0.4, isMuted: true, eqGains: [1, 2, 3, 4, 5] }), storage);
    const loaded = loadPlayerState(storage);
    assert.equal(loaded.volume, 0.4);
    assert.equal(loaded.isMuted, true);
    assert.deepEqual(loaded.eqGains, [1, 2, 3, 4, 5]);

    const { player, positionMs } = fromPersistedState(loaded, SEEDS);
    assert.equal(positionMs, 61000);
    assert.deepEqual(player.queueIds, before.queueIds);
    assert.equal(player.activeTrackId, before.activeTrackId);
    assert.deepEqual(player.userQueuedIds, before.userQueuedIds);
    assert.deepEqual(player.libraryIds, before.libraryIds);
    assert.deepEqual(player.radio, { seedVideoId: vid('a'), continuation: 'TOKEN%3D', status: 'idle', failedAttempts: 0 });
    assert.equal(player.shuffleEnabled, true);
    assert.equal(player.repeatMode, 'ALL');
    assert.equal(player.isPlaying, false);
    assert.equal(player.streamStatus, 'paused');
    assert.equal(player.hasStartedPlayback, true);

    // The working alternate upload and the likes are kept; ids never change
    const a = player.tracksById[ytId('a')];
    assert.equal(a.videoId, vid('a2'));
    assert.equal(a.durationMs, 190000);
    assert.equal(a.liked, true);
    assert.equal(player.tracksById['trk-02'].liked, true);
    for (const id of before.queueIds) {
      const was = before.tracksById[id];
      const now = player.tracksById[id];
      assert.equal(now.title, was.title, id);
      assert.equal(now.artist, was.artist, id);
      assert.equal(now.album, was.album, id);
      assert.equal(now.durationMs, was.durationMs, id);
      assert.equal(now.coverUrl, was.coverUrl, id);
      assert.equal(!!now.isLiveInnerTube, !!was.isLiveInnerTube, id);
    }
    // Feeding it to the reducer resumes at the saved position
    const resumed = playerReducer(createInitialPlayerState(SEEDS), { type: 'restore', snapshot: player, positionMs });
    assert.equal(resumed.seekRequest?.ms, 61000);
    assert.equal(resumed.isPlaying, false);
  });

  test('unknown ids are dropped and an active song outside the queue falls back to the first one', () => {
    const persisted: PersistedPlayerState = {
      ...DEFAULT_PLAYER_STATE,
      queue: [
        { id: 'trk-99', videoId: 'x', title: 'gone seed', artist: '', album: '', durationMs: 1, coverUrl: '', liked: false, cachedOffline: false },
        { id: 'trk-02', videoId: 'seed_2', title: 'Seed 2', artist: '', album: '', durationMs: 1, coverUrl: '', liked: false, cachedOffline: false },
        { id: 'ytm-bad', videoId: 'bad', title: 'bad live id', artist: '', album: '', durationMs: 1, coverUrl: '', liked: false, cachedOffline: false },
        { id: ytId('b'), videoId: vid('b'), title: 'Song b', artist: 'B', album: '', durationMs: 200000, coverUrl: '', liked: false, cachedOffline: false },
      ],
      activeTrackId: 'trk-99',
      positionMs: 50000,
      userQueuedIds: ['trk-02', ytId('b'), 'trk-99'],
    };
    const { player, positionMs } = fromPersistedState(persisted, SEEDS);
    assert.deepEqual(player.queueIds, ['trk-02', ytId('b')]);
    assert.equal(player.activeTrackId, 'trk-02');
    assert.equal(positionMs, 0, 'the position belonged to another song');
    assert.deepEqual(player.userQueuedIds, [ytId('b')]);
    // Seed metadata always comes from the app, not from storage
    assert.equal(player.tracksById['trk-02'].durationMs, 200000);
  });

  test('a position beyond the song falls back to the start; an all-unknown queue to the seeds', () => {
    const persisted: PersistedPlayerState = {
      ...DEFAULT_PLAYER_STATE,
      queue: [{ id: 'trk-01', videoId: 'seed_1', title: 'Seed 1', artist: '', album: '', durationMs: 1, coverUrl: '', liked: false, cachedOffline: false }],
      activeTrackId: 'trk-01',
      positionMs: 999999,
    };
    assert.equal(fromPersistedState(persisted, SEEDS).positionMs, 0);
    assert.equal(fromPersistedState({ ...persisted, positionMs: -5 }, SEEDS).positionMs, 0);

    const { player } = fromPersistedState({ ...persisted, queue: [], activeTrackId: 'trk-01' }, SEEDS);
    assert.deepEqual(player.queueIds, ['trk-01', 'trk-02', 'trk-03']);
    assert.equal(player.hasStartedPlayback, false);
  });

  test('a player that never played saves no queue, so a reload starts fresh', () => {
    const untouched = run(createInitialPlayerState(SEEDS), { type: 'toggleShuffle' });
    const persisted = toPersistedState(untouched, 0);
    assert.deepEqual(persisted.queue, []);
    const { player } = fromPersistedState(persisted, SEEDS);
    assert.equal(player.hasStartedPlayback, false);
    assert.equal(player.shuffleEnabled, true);
  });

  test('a long queue is saved as a 200-song window that keeps the playing song', () => {
    const many = Array.from({ length: 260 }, (_, i) => yt(`m${i}`));
    let state = createInitialPlayerState(SEEDS);
    state = run(state, { type: 'playFromSearch', track: many[0] });
    for (const t of many.slice(1)) state = run(state, { type: 'addToQueue', track: t });
    state = run(state, { type: 'playQueueItem', trackId: ytId('m240') });
    const persisted = toPersistedState(state, 0);
    assert.equal(persisted.queue?.length, MAX_SAVED_QUEUE_TRACKS);
    assert.ok(persisted.queue?.some((t) => t.id === ytId('m240')));
    assert.ok(persisted.queue?.some((t) => t.id === ytId('m259')));
    const { player } = fromPersistedState(persisted, SEEDS);
    assert.equal(player.activeTrackId, ytId('m240'));
  });
});
