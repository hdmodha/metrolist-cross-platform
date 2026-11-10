import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type { MetrolistTrack } from '../data/metrolistData';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';
import {
  MAX_CONSECUTIVE_STREAM_FAILURES,
  MAX_PLAY_HISTORY,
  MAX_RADIO_RETRIES,
  createInitialPlayerState,
  liveTrackId,
  playerReducer,
  selectActiveTrack,
  selectCanRetryRadio,
  selectCanTryAlternateVideo,
  selectLibraryTracks,
  selectNetworkRetryDelayMs,
  selectQueueTracks,
  selectRadioContinuationRequest,
  selectTriedVideoIds,
  selectUpcomingCount,
  selectUpcomingIds,
  toMetrolistTrack,
  type PlayerAction,
  type PlayerState,
} from './playerCore';
import { MAX_NETWORK_RETRIES } from './retryPolicy';

/* ------------------------------------------ helpers ------------------------------------------ */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Dispatches every action against a deep-frozen state, proving the reducer never mutates it. */
function run(state: PlayerState, ...actions: PlayerAction[]): PlayerState {
  let current = state;
  for (const action of actions) {
    current = playerReducer(deepFreeze(current), action);
  }
  return deepFreeze(current);
}

function seed(n: number, overrides: Partial<MetrolistTrack> = {}): MetrolistTrack {
  return {
    id: `s${n}`,
    videoId: `seed_${n}`,
    title: `Seed ${n}`,
    artist: 'Seed Artist',
    album: 'Seed Album',
    durationMs: 200000,
    bpm: 100,
    rootFreqHz: 220,
    chordIntervals: [0, 3, 7],
    coverUrl: '',
    genre: 'Ambient',
    liked: false,
    cachedOffline: false,
    ...overrides,
  };
}

const SEEDS = [seed(1), seed(2), seed(3), seed(4), seed(5)];

/** Distinct 11-character video ids: `vid` + name, padded with `_`. */
function vid(name: string): string {
  assert.ok(name.length <= 8, 'fixture names must fit an 11-character video id');
  return `vid${name}`.padEnd(11, '_');
}

function yt(name: string, durationMs = 180000): InnerTubeParsedTrack {
  return {
    videoId: vid(name),
    title: `Song ${name}`,
    artist: `Artist ${name}`,
    album: 'Album',
    durationMs,
    thumbnailUrl: `https://img/${name}.jpg`,
  };
}

const ytId = (name: string) => liveTrackId(vid(name));
const q = (state: PlayerState) => state.queueIds.join(',');
const fresh = () => createInitialPlayerState(SEEDS);

/** A state that is playing `s1` from the seed list (playback has started). */
function playingSeeds(): PlayerState {
  return run(fresh(), { type: 'playFromList', track: SEEDS[0], context: SEEDS });
}

function assertInvariants(state: PlayerState) {
  const queueSet = new Set(state.queueIds);
  assert.equal(queueSet.size, state.queueIds.length, 'queue has no duplicates');
  assert.equal(new Set(state.libraryIds).size, state.libraryIds.length, 'library has no duplicates');
  if (state.hasStartedPlayback) {
    assert.ok(queueSet.has(state.activeTrackId), 'active track is in the queue');
  }
  for (const id of [...state.queueIds, ...state.libraryIds, ...state.playHistory]) {
    assert.ok(state.tracksById[id], `track ${id} is known`);
  }
  if (state.activeTrackId) assert.ok(state.tracksById[state.activeTrackId], 'active track is known');
  const upcoming = new Set(selectUpcomingIds(state));
  for (const id of state.userQueuedIds) assert.ok(upcoming.has(id), `hand-queued ${id} is upcoming`);
  assert.ok(state.playHistory.length <= MAX_PLAY_HISTORY);
  assert.ok(state.consecutiveStreamFailures < MAX_CONSECUTIVE_STREAM_FAILURES);
  const active = state.tracksById[state.activeTrackId];
  if (active) {
    assert.ok(!state.recommendations.some((r) => r.videoId === active.videoId || liveTrackId(r.videoId) === active.id));
  }
  for (const tried of Object.values(state.triedVideoIdsByTrack)) assert.ok(tried.length <= 3);
}

/* ------------------------------------------- tests ------------------------------------------- */

describe('initial state and track conversion', () => {
  test('starts paused on the first seed with the seeds as library and queue', () => {
    const state = fresh();
    assert.equal(state.activeTrackId, 's1');
    assert.equal(state.isPlaying, false);
    assert.equal(state.hasStartedPlayback, false);
    assert.equal(state.streamStatus, 'paused');
    assert.deepEqual(state.libraryIds, ['s1', 's2', 's3', 's4', 's5']);
    assert.deepEqual(state.queueIds, ['s1', 's2', 's3', 's4', 's5']);
    assert.equal(selectActiveTrack(state)?.title, 'Seed 1');
    assert.equal(selectUpcomingCount(state), 4);
    assert.deepEqual(selectLibraryTracks(state).map((t) => t.id), state.libraryIds);
    assert.deepEqual(selectQueueTracks(state).map((t) => t.id), state.queueIds);
    assertInvariants(state);
  });

  test('accepts saved preferences', () => {
    const state = createInitialPlayerState(SEEDS, { shuffleEnabled: true, repeatMode: 'ONE', autoplayRadio: false });
    assert.equal(state.shuffleEnabled, true);
    assert.equal(state.repeatMode, 'ONE');
    assert.equal(state.autoplayRadio, false);
  });

  test('converts a search result to a live track and never keeps a preview duration', () => {
    const track = toMetrolistTrack(yt('a'));
    assert.equal(track.id, `ytm-${vid('a')}`);
    assert.equal(track.videoId, vid('a'));
    assert.equal(track.isLiveInnerTube, true);
    assert.equal(track.durationMs, 180000);
    assert.equal(track.coverUrl, 'https://img/a.jpg');
    assert.equal(toMetrolistTrack(yt('b', 30000)).durationMs, 218000);
    assert.equal(toMetrolistTrack({ ...yt('c'), thumbnailUrl: '', album: '' }).coverUrl, `https://i.ytimg.com/vi/${vid('c')}/hqdefault.jpg`);
    assert.equal(toMetrolistTrack({ ...yt('c'), album: '' }).album, 'YouTube Music');
  });

  test('an empty seed list gives an empty, inert player', () => {
    const empty = createInitialPlayerState([]);
    assert.equal(selectActiveTrack(empty), null);
    assert.equal(selectUpcomingCount(empty), 0);
    for (const action of [
      { type: 'togglePlay' },
      { type: 'next', random: 0.5 },
      { type: 'previous', positionMs: 0 },
      { type: 'trackEnded', random: 0.5 },
      { type: 'seekRequested', ms: 1000 },
      { type: 'clearUpcoming' },
    ] satisfies PlayerAction[]) {
      assert.equal(run(empty, action).activeTrackId, '');
    }
    // Adding a song to an empty player makes it the (paused) current song
    const added = run(empty, { type: 'addToQueue', track: yt('a') });
    assert.equal(added.activeTrackId, ytId('a'));
    assert.deepEqual(added.queueIds, [ytId('a')]);
    assert.equal(added.isPlaying, false);
    assertInvariants(added);
  });
});

describe('play now', () => {
  test('a search card before playback started replaces the seed queue and starts playing', () => {
    const state = run(fresh(), { type: 'playFromSearch', track: yt('a') });
    assert.equal(state.activeTrackId, ytId('a'));
    assert.deepEqual(state.queueIds, [ytId('a')]);
    assert.equal(state.libraryIds[0], ytId('a'));
    assert.deepEqual(state.libraryIds.slice(1), ['s1', 's2', 's3', 's4', 's5']);
    assert.equal(state.isPlaying, true);
    assert.equal(state.hasStartedPlayback, true);
    assert.equal(state.streamStatus, 'loading');
    assert.deepEqual(state.playHistory, []);
    assertInvariants(state);
  });

  test('a second search card keeps history and plays after the current song', () => {
    const state = run(fresh(), { type: 'playFromSearch', track: yt('a') }, { type: 'playFromSearch', track: yt('b') });
    assert.deepEqual(state.queueIds, [ytId('a'), ytId('b')]);
    assert.deepEqual(state.playHistory, [ytId('a')]);
    assert.deepEqual(state.libraryIds.slice(0, 2), [ytId('b'), ytId('a')]);
  });

  test('the active card toggles play / pause instead of restarting', () => {
    const playing = run(fresh(), { type: 'playFromSearch', track: yt('a') });
    const paused = run(playing, { type: 'playFromSearch', track: yt('a') });
    assert.equal(paused.isPlaying, false);
    assert.equal(paused.seekRequest, null);
    assert.equal(run(paused, { type: 'playFromSearch', track: yt('a') }).isPlaying, true);
  });

  test('a known track keeps its flags and real duration when picked again from a preview-length card', () => {
    let state = run(fresh(), { type: 'playFromSearch', track: yt('a', 245000) }, { type: 'toggleLike', trackId: ytId('a') });
    state = run(state, { type: 'playFromSearch', track: yt('b') }, { type: 'playFromSearch', track: yt('a', 30000) });
    const a = state.tracksById[ytId('a')];
    assert.equal(a.liked, true);
    assert.equal(a.durationMs, 245000);
  });

  test('a library row continues through the list it was picked from, keeping hand-queued songs', () => {
    let state = playingSeeds();
    assert.equal(q(state), 's1,s2,s3,s4,s5');
    state = run(state, { type: 'addToQueue', track: yt('a') });
    assert.equal(q(state), `s1,${ytId('a')},s2,s3,s4,s5`);
    state = run(state, { type: 'playFromList', track: SEEDS[3], context: [SEEDS[2], SEEDS[3], SEEDS[4]] });
    assert.equal(q(state), `s1,s4,${ytId('a')},s5`);
    assert.equal(state.activeTrackId, 's4');
    assert.deepEqual(state.playHistory, ['s1']);
    assert.deepEqual(state.userQueuedIds, [ytId('a')]);
    assertInvariants(state);
  });

  test('a library row unknown to the player is added from the payload', () => {
    const extra = seed(9, { liked: true });
    const state = run(playingSeeds(), { type: 'playFromList', track: extra, context: [extra, SEEDS[1]] });
    assert.equal(state.activeTrackId, 's9');
    assert.equal(state.libraryIds[0], 's9');
    assert.equal(q(state), 's1,s9,s2');
  });

  test('playing a song that sits earlier in the queue moves it after the current one', () => {
    let state = run(playingSeeds(), { type: 'next', random: 0 }, { type: 'next', random: 0 });
    assert.equal(state.activeTrackId, 's3');
    state = run(state, { type: 'playFromList', track: SEEDS[0], context: [] });
    assert.equal(q(state), 's2,s3,s1');
    assert.equal(state.activeTrackId, 's1');
    assert.deepEqual(state.playHistory, ['s1', 's2', 's3']);
    assertInvariants(state);
  });

  test('play queue item jumps without reshaping the queue', () => {
    const state = run(playingSeeds(), { type: 'playQueueItem', trackId: 's4' });
    assert.equal(q(state), 's1,s2,s3,s4,s5');
    assert.equal(state.activeTrackId, 's4');
    assert.deepEqual(state.playHistory, ['s1']);
    assert.equal(run(state, { type: 'playQueueItem', trackId: 's4' }).isPlaying, false);
  });

  test('unknown ids are ignored without throwing', () => {
    const state = playingSeeds();
    for (const action of [
      { type: 'playQueueItem', trackId: 'nope' },
      { type: 'removeFromQueue', trackId: 'nope' },
      { type: 'moveQueueItem', trackId: 'nope', direction: 1 },
      { type: 'toggleLike', trackId: 'nope' },
      { type: 'toggleDownloaded', trackId: 'nope' },
      { type: 'durationDiscovered', trackId: 'nope', durationMs: 999999 },
      { type: 'alternateVideoFound', trackId: 'nope', videoId: vid('x') },
      { type: 'trackUnplayable', trackId: 'nope', random: 0 },
      { type: 'trackEnded', trackId: 'nope', random: 0 },
    ] satisfies PlayerAction[]) {
      assert.equal(run(state, action), state, action.type);
    }
  });
});

describe('play / pause', () => {
  test('toggle and set playing mark playback as started', () => {
    const toggled = run(fresh(), { type: 'togglePlay' });
    assert.equal(toggled.isPlaying, true);
    assert.equal(toggled.hasStartedPlayback, true);
    assert.equal(run(toggled, { type: 'togglePlay' }).isPlaying, false);

    const external = run(fresh(), { type: 'setPlaying', playing: true });
    assert.equal(external.isPlaying, true);
    assert.equal(external.hasStartedPlayback, true);
    assert.equal(run(external, { type: 'setPlaying', playing: true }), external);
    const pausedExternally = run(external, { type: 'setPlaying', playing: false });
    assert.equal(pausedExternally.isPlaying, false);
  });
});

describe('next / previous / track ended', () => {
  test('next walks the queue and wraps when pressed on the last song', () => {
    let state = run(playingSeeds(), { type: 'next', random: 0 });
    assert.equal(state.activeTrackId, 's2');
    assert.deepEqual(state.playHistory, ['s1']);
    state = run(state, { type: 'playQueueItem', trackId: 's5' }, { type: 'next', random: 0 });
    assert.equal(state.activeTrackId, 's1');
  });

  test('repeat-one applies to a song that ends but not to pressing Next', () => {
    const state = run(playingSeeds(), { type: 'cycleRepeat' }, { type: 'cycleRepeat' });
    assert.equal(state.repeatMode, 'ONE');
    const ended = run(state, { type: 'trackEnded', random: 0 });
    assert.equal(ended.activeTrackId, 's1');
    assert.equal(ended.isPlaying, true);
    assert.deepEqual(ended.seekRequest?.ms, 0);
    assert.equal(run(state, { type: 'next', random: 0 }).activeTrackId, 's2');
  });

  test('track ended stops at the end of the queue with repeat off and wraps with repeat all', () => {
    const last = run(playingSeeds(), { type: 'playQueueItem', trackId: 's5' });
    const stopped = run(last, { type: 'trackEnded', random: 0 });
    assert.equal(stopped.activeTrackId, 's5');
    assert.equal(stopped.isPlaying, false);
    assert.equal(stopped.streamStatus, 'paused');
    assert.equal(stopped.seekRequest?.ms, 0);
    const wrapped = run(last, { type: 'cycleRepeat' }, { type: 'trackEnded', random: 0 });
    assert.equal(wrapped.repeatMode, 'ALL');
    assert.equal(wrapped.activeTrackId, 's1');
  });

  test('a stale "ended" event for a song that is no longer playing is ignored', () => {
    const state = run(playingSeeds(), { type: 'next', random: 0 });
    assert.equal(run(state, { type: 'trackEnded', trackId: 's1', random: 0 }), state);
    assert.equal(run(state, { type: 'trackEnded', trackId: 's2', random: 0 }).activeTrackId, 's3');
  });

  test('shuffle never picks the playing song (queue lengths 1, 2 and many)', () => {
    for (const length of [1, 2, 3, 7]) {
      const tracks = Array.from({ length }, (_, i) => seed(i + 1));
      let base = createInitialPlayerState(tracks);
      base = run(base, { type: 'playFromList', track: tracks[0], context: tracks }, { type: 'toggleShuffle' });
      for (const random of [0, 0.25, 0.5, 0.75, 0.999999]) {
        const next = run(base, { type: 'next', random });
        if (length === 1) {
          // The only song restarts
          assert.equal(next.activeTrackId, 's1');
          assert.equal(next.seekRequest?.ms, 0);
        } else {
          assert.notEqual(next.activeTrackId, 's1', `length ${length}, random ${random}`);
        }
        const ended = run(base, { type: 'trackEnded', random });
        if (length === 1) assert.equal(ended.isPlaying, false);
        else assert.notEqual(ended.activeTrackId, 's1');
      }
    }
  });

  test('shuffle still plays hand-queued songs first', () => {
    const state = run(
      playingSeeds(),
      { type: 'toggleShuffle' },
      { type: 'addToQueue', track: yt('a') },
      { type: 'addToQueue', track: yt('b') }
    );
    const first = run(state, { type: 'next', random: 0.99 });
    assert.equal(first.activeTrackId, ytId('a'));
    assert.equal(run(first, { type: 'next', random: 0.99 }).activeTrackId, ytId('b'));
  });

  test('a single-song queue restarts on Next and seek tokens always change', () => {
    const one = run(createInitialPlayerState([SEEDS[0]]), { type: 'togglePlay' });
    const a = run(one, { type: 'next', random: 0 });
    const b = run(a, { type: 'next', random: 0 });
    assert.equal(a.seekRequest?.ms, 0);
    assert.equal(b.seekRequest?.ms, 0);
    assert.notEqual(a.seekRequest?.token, b.seekRequest?.token);
  });

  test('previous restarts the song after 3 s, otherwise goes back', () => {
    const state = run(playingSeeds(), { type: 'next', random: 0 });
    const restarted = run(state, { type: 'previous', positionMs: 3001 });
    assert.equal(restarted.activeTrackId, 's2');
    assert.equal(restarted.seekRequest?.ms, 0);
    assert.equal(restarted.isPlaying, true);
    const back = run(state, { type: 'previous', positionMs: 3000 });
    assert.equal(back.activeTrackId, 's1');
    // On the first song (repeat off) Previous restarts it
    const first = run(back, { type: 'previous', positionMs: 0 });
    assert.equal(first.activeTrackId, 's1');
    assert.equal(first.seekRequest?.ms, 0);
    // With repeat all it wraps to the last song
    assert.equal(run(back, { type: 'cycleRepeat' }, { type: 'previous', positionMs: 0 }).activeTrackId, 's5');
  });

  test('previous with shuffle walks the play history, even to a song removed from the queue', () => {
    let state = run(playingSeeds(), { type: 'toggleShuffle' }, { type: 'playQueueItem', trackId: 's4' }, { type: 'playQueueItem', trackId: 's2' });
    assert.deepEqual(state.playHistory, ['s1', 's4']);
    state = run(state, { type: 'previous', positionMs: 0 });
    assert.equal(state.activeTrackId, 's4');
    assert.deepEqual(state.playHistory, ['s1']);
    state = run(state, { type: 'removeFromQueue', trackId: 's1' });
    assert.equal(q(state), 's2,s3,s4,s5');
    state = run(state, { type: 'previous', positionMs: 0 });
    assert.equal(state.activeTrackId, 's1');
    assert.deepEqual(state.playHistory, []);
    assert.equal(q(state), 's2,s3,s1,s4,s5');
    assertInvariants(state);
  });
});

describe('unplayable songs and alternate uploads', () => {
  const live = () =>
    run(
      fresh(),
      { type: 'playFromSearch', track: yt('a') },
      { type: 'addToQueue', track: yt('b') },
      { type: 'addToQueue', track: yt('c') },
      { type: 'addToQueue', track: yt('d') }
    );

  test('skips forward with a notice and never lands on the same song', () => {
    const state = run(live(), { type: 'trackUnplayable', trackId: ytId('a'), random: 0 });
    assert.equal(state.activeTrackId, ytId('b'));
    assert.equal(state.consecutiveStreamFailures, 1);
    assert.match(state.notice?.message ?? '', /can’t be played/);
  });

  test('stops after 3 consecutive failures, and a playing stream resets the counter', () => {
    let state = run(
      live(),
      { type: 'trackUnplayable', trackId: ytId('a'), random: 0 },
      { type: 'trackUnplayable', trackId: ytId('b'), random: 0 }
    );
    assert.equal(state.consecutiveStreamFailures, 2);
    const reset = run(state, { type: 'streamStatusChanged', status: 'playing' });
    assert.equal(reset.consecutiveStreamFailures, 0);
    state = run(state, { type: 'trackUnplayable', trackId: ytId('c'), random: 0 });
    assert.equal(state.isPlaying, false);
    assert.equal(state.streamStatus, 'paused');
    assert.equal(state.consecutiveStreamFailures, 0);
    assert.equal(state.activeTrackId, ytId('c'));
    assert.match(state.notice?.message ?? '', /Several songs/);
  });

  test('a single unplayable song, or one with repeat-one, never loops', () => {
    const single = run(fresh(), { type: 'playFromSearch', track: yt('a') }, { type: 'trackUnplayable', trackId: ytId('a'), random: 0 });
    assert.equal(single.isPlaying, false);
    assert.equal(single.activeTrackId, ytId('a'));
    const repeatOne = run(live(), { type: 'cycleRepeat' }, { type: 'cycleRepeat' }, { type: 'trackUnplayable', trackId: ytId('a'), random: 0 });
    assert.equal(repeatOne.activeTrackId, ytId('b'));
    // At the end of the queue with repeat off it wraps rather than replaying the broken song
    const lastSong = run(live(), { type: 'playQueueItem', trackId: ytId('d') }, { type: 'trackUnplayable', trackId: ytId('d'), random: 0 });
    assert.equal(lastSong.activeTrackId, ytId('a'));
  });

  test('a manual pick resets the failure counter', () => {
    const state = run(live(), { type: 'trackUnplayable', trackId: ytId('a'), random: 0 }, { type: 'next', random: 0 });
    assert.equal(state.consecutiveStreamFailures, 0);
  });

  test('alternate uploads swap the video id, keep the track id and are limited to 3 candidates', () => {
    let state = run(live(), { type: 'toggleLike', trackId: ytId('a') });
    assert.equal(selectCanTryAlternateVideo(state, ytId('a')), true);
    assert.deepEqual(selectTriedVideoIds(state, ytId('a')), [vid('a')]);
    state = run(state, { type: 'alternateVideoFound', trackId: ytId('a'), videoId: vid('a2'), durationMs: 20000 });
    const a = state.tracksById[ytId('a')];
    assert.equal(a.videoId, vid('a2'));
    assert.equal(a.durationMs, 180000, 'a preview duration never replaces the real one');
    assert.equal(a.liked, true);
    assert.equal(state.activeTrackId, ytId('a'));
    assert.equal(state.streamStatus, 'loading');
    assert.deepEqual(selectTriedVideoIds(state, ytId('a')), [vid('a'), vid('a2')]);
    // An id that was already tried is ignored
    assert.equal(run(state, { type: 'alternateVideoFound', trackId: ytId('a'), videoId: vid('a') }), state);
    state = run(state, { type: 'alternateVideoFound', trackId: ytId('a'), videoId: vid('a3'), durationMs: 200000 });
    assert.equal(state.tracksById[ytId('a')].durationMs, 200000);
    assert.equal(selectCanTryAlternateVideo(state, ytId('a')), false);
    assert.equal(run(state, { type: 'alternateVideoFound', trackId: ytId('a'), videoId: vid('a4') }), state);
    // Only for the playing song
    assert.equal(run(state, { type: 'alternateVideoFound', trackId: ytId('b'), videoId: vid('b2') }).tracksById[ytId('b')].videoId, vid('b'));
    assert.equal(selectCanTryAlternateVideo(state, 'nope'), false);
  });
});

describe('stream status, seeking and duration', () => {
  test('stream status is stored', () => {
    const state = run(playingSeeds(), { type: 'streamStatusChanged', status: 'blocked' });
    assert.equal(state.streamStatus, 'blocked');
  });

  test('seek requests are clamped and carry a fresh token each time', () => {
    const state = playingSeeds();
    const a = run(state, { type: 'seekRequested', ms: 10000 });
    assert.equal(a.seekRequest?.ms, 10000);
    const b = run(a, { type: 'seekRequested', ms: 10000 });
    assert.equal(b.seekRequest?.ms, 10000);
    assert.notEqual(a.seekRequest?.token, b.seekRequest?.token);
    assert.equal(run(state, { type: 'seekRequested', ms: -5 }).seekRequest?.ms, 0);
    assert.equal(run(state, { type: 'seekRequested', ms: 10_000_000 }).seekRequest?.ms, 199500);
    assert.equal(run(state, { type: 'seekRequested', ms: Number.NaN }).seekRequest?.ms, 0);
  });

  test('seek handled clears only the matching request', () => {
    const a = run(playingSeeds(), { type: 'seekRequested', ms: 5000 });
    const token = a.seekRequest!.token;
    assert.equal(run(a, { type: 'seekHandled', token: token + 1 }), a);
    assert.equal(run(a, { type: 'seekHandled', token }).seekRequest, null);
    assert.equal(run(a, { type: 'seekHandled' }).seekRequest, null);
  });

  test('a discovered duration is applied only when it is real and clearly different', () => {
    const state = playingSeeds();
    assert.equal(run(state, { type: 'durationDiscovered', trackId: 's1', durationMs: 201000 }), state);
    assert.equal(run(state, { type: 'durationDiscovered', trackId: 's1', durationMs: 30000 }), state);
    const longer = run(state, { type: 'durationDiscovered', trackId: 's1', durationMs: 260000 });
    assert.equal(longer.tracksById.s1.durationMs, 260000);
    assert.equal(selectQueueTracks(longer)[0].durationMs, 260000);
    assert.equal(selectLibraryTracks(longer)[0].durationMs, 260000);
  });
});

describe('queue editing', () => {
  test('add to queue keeps the order of hand-queued songs, before radio picks, with a notice', () => {
    let state = run(playingSeeds(), { type: 'addToQueue', track: yt('a') }, { type: 'addToQueue', track: yt('b') });
    assert.equal(q(state), `s1,${ytId('a')},${ytId('b')},s2,s3,s4,s5`);
    assert.deepEqual(state.userQueuedIds, [ytId('a'), ytId('b')]);
    assert.match(state.notice?.message ?? '', /Added “Song b” to your queue/);
    assert.ok(state.libraryIds.includes(ytId('b')));
    // Queueing a song that is already further down moves it up
    state = run(state, { type: 'addToQueue', track: SEEDS[4] });
    assert.equal(q(state), `s1,${ytId('a')},${ytId('b')},s5,s2,s3,s4`);
    assertInvariants(state);
  });

  test('adding the playing song is a no-op with a notice', () => {
    const state = playingSeeds();
    const next = run(state, { type: 'addToQueue', track: SEEDS[0] });
    assert.deepEqual(next.queueIds, state.queueIds);
    assert.match(next.notice?.message ?? '', /already playing/);
    assert.match(run(state, { type: 'playNext', track: SEEDS[0] }).notice?.message ?? '', /already playing/);
  });

  test('play next goes right after the current song, ahead of other hand-queued songs', () => {
    const state = run(playingSeeds(), { type: 'addToQueue', track: yt('a') }, { type: 'playNext', track: yt('b') });
    assert.equal(q(state), `s1,${ytId('b')},${ytId('a')},s2,s3,s4,s5`);
    assert.deepEqual([...state.userQueuedIds].sort(), [ytId('a'), ytId('b')].sort());
    assert.match(state.notice?.message ?? '', /play next/);
    assert.equal(run(state, { type: 'next', random: 0 }).activeTrackId, ytId('b'));
  });

  test('remove from queue refuses the playing song and forgets hand-queued marks', () => {
    let state = run(playingSeeds(), { type: 'addToQueue', track: yt('a') });
    assert.equal(run(state, { type: 'removeFromQueue', trackId: 's1' }), state);
    state = run(state, { type: 'removeFromQueue', trackId: ytId('a') });
    assert.equal(q(state), 's1,s2,s3,s4,s5');
    assert.deepEqual(state.userQueuedIds, []);
  });

  test('moving queue items around the playing song keeps every invariant', () => {
    let state = run(playingSeeds(), { type: 'next', random: 0 }, { type: 'addToQueue', track: yt('a') });
    assert.equal(q(state), `s1,s2,${ytId('a')},s3,s4,s5`);
    // Move the playing song down: the hand-queued song is now behind it and loses its mark
    state = run(state, { type: 'moveQueueItem', trackId: 's2', direction: 1 });
    assert.equal(q(state), `s1,${ytId('a')},s2,s3,s4,s5`);
    assert.equal(state.activeTrackId, 's2');
    assert.deepEqual(state.userQueuedIds, []);
    assert.equal(run(state, { type: 'next', random: 0 }).activeTrackId, 's3');
    // Out of range moves are ignored
    assert.equal(run(state, { type: 'moveQueueItem', trackId: 's1', direction: -1 }), state);
    assert.equal(run(state, { type: 'moveQueueItem', trackId: 's5', direction: 1 }), state);
    state = run(state, { type: 'moveQueueItem', trackId: 's5', direction: -1 });
    assert.equal(q(state), `s1,${ytId('a')},s2,s3,s5,s4`);
    assertInvariants(state);
  });

  test('clear upcoming keeps history and the current song', () => {
    const state = run(playingSeeds(), { type: 'next', random: 0 }, { type: 'addToQueue', track: yt('a') }, { type: 'clearUpcoming' });
    assert.equal(q(state), 's1,s2');
    assert.deepEqual(state.userQueuedIds, []);
    assert.equal(state.radio, null);
    assert.equal(run(state, { type: 'clearUpcoming' }), state);
  });
});

describe('library flags and preferences', () => {
  test('liking or downloading a queue-only song puts it in the library', () => {
    let state = run(fresh(), { type: 'playFromSearch', track: yt('a') });
    state = run(state, {
      type: 'recommendationsLoaded',
      trackId: ytId('a'),
      seedVideoId: vid('a'),
      tracks: [yt('r1')],
      continuation: null,
    });
    assert.ok(!state.libraryIds.includes(ytId('r1')));
    const liked = run(state, { type: 'toggleLike', trackId: ytId('r1') });
    assert.equal(liked.tracksById[ytId('r1')].liked, true);
    assert.equal(liked.libraryIds[0], ytId('r1'));
    assert.equal(run(liked, { type: 'toggleLike', trackId: ytId('r1') }).tracksById[ytId('r1')].liked, false);
    const downloaded = run(state, { type: 'toggleDownloaded', trackId: ytId('r1') });
    assert.equal(downloaded.tracksById[ytId('r1')].cachedOffline, true);
    assert.equal(downloaded.libraryIds[0], ytId('r1'));
    // Seeds stay last
    assert.deepEqual(downloaded.libraryIds.slice(-5), ['s1', 's2', 's3', 's4', 's5']);
  });

  test('shuffle, repeat and autoplay radio toggles', () => {
    let state = run(fresh(), { type: 'toggleShuffle' });
    assert.equal(state.shuffleEnabled, true);
    assert.equal(run(state, { type: 'toggleShuffle' }).shuffleEnabled, false);
    state = run(fresh(), { type: 'cycleRepeat' });
    assert.equal(state.repeatMode, 'ALL');
    state = run(state, { type: 'cycleRepeat' });
    assert.equal(state.repeatMode, 'ONE');
    assert.equal(run(state, { type: 'cycleRepeat' }).repeatMode, 'OFF');
    assert.equal(run(fresh(), { type: 'toggleAutoplayRadio' }).autoplayRadio, false);
  });
});

describe('recommendations and radio', () => {
  const recs = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => yt(`${prefix}${i + 1}`));
  const started = () => run(fresh(), { type: 'playFromSearch', track: yt('a') });

  test('recommendations fill the shelf (never the active song) and top up a short queue', () => {
    const state = run(started(), {
      type: 'recommendationsLoaded',
      trackId: ytId('a'),
      seedVideoId: vid('a'),
      tracks: [yt('a'), ...recs('r', 12)],
      continuation: 'TOKEN1',
    });
    assert.equal(state.recommendations.length, 12);
    assert.ok(!state.recommendations.some((r) => r.videoId === vid('a')));
    assert.equal(state.queueIds.length, 11);
    assert.equal(state.queueIds[1], ytId('r1'));
    assert.deepEqual(state.radio, { seedVideoId: vid('a'), continuation: 'TOKEN1', status: 'idle', failedAttempts: 0 });
    assert.ok(!state.libraryIds.includes(ytId('r1')), 'radio picks are not added to the library');
    assertInvariants(state);
  });

  test('a queue with more than 5 upcoming songs only updates the shelf', () => {
    const state = playingSeeds();
    const withSix = run(state, { type: 'addToQueue', track: yt('x') }, { type: 'addToQueue', track: yt('y') });
    assert.equal(selectUpcomingCount(withSix), 6);
    const loaded = run(withSix, { type: 'recommendationsLoaded', trackId: 's1', seedVideoId: vid('s'), tracks: recs('r', 3), continuation: 'T' });
    assert.deepEqual(loaded.queueIds, withSix.queueIds);
    assert.equal(loaded.recommendations.length, 3);
    assert.equal(loaded.radio, null);
    // 5 upcoming: topped up
    const five = run(state, { type: 'addToQueue', track: yt('x') });
    assert.equal(selectUpcomingCount(five), 5);
    const toppedUp = run(five, { type: 'recommendationsLoaded', trackId: 's1', seedVideoId: vid('s'), tracks: recs('r', 3), continuation: 'T' });
    assert.equal(selectUpcomingCount(toppedUp), 8);
  });

  test('autoplay off only updates the shelf', () => {
    const state = run(started(), { type: 'toggleAutoplayRadio' }, {
      type: 'recommendationsLoaded',
      trackId: ytId('a'),
      seedVideoId: vid('a'),
      tracks: recs('r', 3),
      continuation: 'T',
    });
    assert.deepEqual(state.queueIds, [ytId('a')]);
    assert.equal(state.recommendations.length, 3);
    assert.equal(selectRadioContinuationRequest(state), null);
  });

  test('a radio answer that arrives after the listener moved on changes nothing', () => {
    const state = run(started(), { type: 'playFromSearch', track: yt('b') });
    const stale = run(state, { type: 'recommendationsLoaded', trackId: ytId('a'), seedVideoId: vid('a'), tracks: recs('r', 3), continuation: 'T' });
    assert.equal(stale, state);
    assert.equal(run(state, { type: 'recommendationsFailed', trackId: ytId('a'), fallback: recs('f', 2) }), state);
  });

  test('radio top-up never drops hand-queued songs and dedupes', () => {
    const state = run(
      started(),
      { type: 'addToQueue', track: yt('u1') },
      {
        type: 'recommendationsLoaded',
        trackId: ytId('a'),
        seedVideoId: vid('a'),
        tracks: [yt('u1'), yt('r1'), yt('r1'), yt('r2')],
        continuation: null,
      }
    );
    assert.equal(q(state), [ytId('a'), ytId('u1'), ytId('r1'), ytId('r2')].join(','));
    assert.deepEqual(state.userQueuedIds, [ytId('u1')]);
    const after = run(state, { type: 'addToQueue', track: yt('u2') });
    assert.equal(q(after), [ytId('a'), ytId('u1'), ytId('u2'), ytId('r1'), ytId('r2')].join(','));
  });

  test('radio top-up keeps at most 30 played songs and appends at most 10', () => {
    const many = Array.from({ length: 40 }, (_, i) => seed(i + 1));
    let state = createInitialPlayerState(many);
    state = run(state, { type: 'playFromList', track: many[0], context: many }, { type: 'playQueueItem', trackId: 's40' });
    state = run(state, { type: 'recommendationsLoaded', trackId: 's40', seedVideoId: vid('s'), tracks: recs('r', 15), continuation: null });
    assert.equal(state.queueIds.length, 30 + 1 + 10);
    assert.equal(state.queueIds[0], 's10');
    assertInvariants(state);
  });

  test('a failed recommendations request shows the fallback shelf without the active song', () => {
    const state = run(started(), { type: 'recommendationsFailed', trackId: ytId('a'), fallback: [yt('a'), yt('f1')] });
    assert.deepEqual(state.recommendations.map((r) => r.videoId), [vid('f1')]);
    assert.deepEqual(state.queueIds, [ytId('a')]);
  });

  test('radio continuation is requested only when autoplay is on, the queue is short and the session is idle', () => {
    let state = run(started(), {
      type: 'recommendationsLoaded',
      trackId: ytId('a'),
      seedVideoId: vid('a'),
      tracks: recs('r', 10),
      continuation: 'TOKEN1',
    });
    assert.equal(selectUpcomingCount(state), 10);
    assert.equal(selectRadioContinuationRequest(state), null);
    for (let i = 0; i < 5; i++) state = run(state, { type: 'next', random: 0 });
    assert.equal(selectUpcomingCount(state), 5);
    assert.deepEqual(selectRadioContinuationRequest(state), { seedVideoId: vid('a'), continuation: 'TOKEN1' });
    assert.equal(selectRadioContinuationRequest(run(state, { type: 'toggleAutoplayRadio' })), null);

    state = run(state, { type: 'radioPageRequested', seedVideoId: vid('a'), continuation: 'TOKEN1' });
    assert.equal(state.radio?.status, 'loading');
    assert.equal(selectRadioContinuationRequest(state), null);

    state = run(state, {
      type: 'radioPageLoaded',
      seedVideoId: vid('a'),
      continuation: 'TOKEN1',
      tracks: [yt('r9'), yt('p1'), yt('p2')],
      nextContinuation: 'TOKEN2',
    });
    assert.equal(selectUpcomingCount(state), 7);
    assert.deepEqual(state.queueIds.slice(-2), [ytId('p1'), ytId('p2')]);
    assert.deepEqual(state.radio, { seedVideoId: vid('a'), continuation: 'TOKEN2', status: 'idle', failedAttempts: 0 });

    // The radio ran out
    state = run(state, { type: 'radioPageLoaded', seedVideoId: vid('a'), continuation: 'TOKEN2', tracks: [], nextContinuation: null });
    assert.equal(state.radio?.continuation, null);
    assert.equal(selectRadioContinuationRequest(state), null);
    assertInvariants(state);
  });

  test('a page for another radio session or token is ignored', () => {
    const state = run(started(), {
      type: 'recommendationsLoaded',
      trackId: ytId('a'),
      seedVideoId: vid('a'),
      tracks: recs('r', 2),
      continuation: 'TOKEN1',
    });
    for (const action of [
      { type: 'radioPageLoaded', seedVideoId: vid('z'), continuation: 'TOKEN1', tracks: [yt('p1')], nextContinuation: 'X' },
      { type: 'radioPageLoaded', seedVideoId: vid('a'), continuation: 'OLD', tracks: [yt('p1')], nextContinuation: 'X' },
      { type: 'radioPageFailed', seedVideoId: vid('a'), continuation: 'OLD' },
      { type: 'radioPageRequested', seedVideoId: vid('a'), continuation: 'OLD' },
    ] satisfies PlayerAction[]) {
      assert.equal(run(state, action), state, action.type);
    }
    const noRadio = fresh();
    assert.equal(run(noRadio, { type: 'radioRetry' }), noRadio);
  });

  test('a failing radio page is retried at most 3 times, then waits for the next track change', () => {
    let state = run(started(), {
      type: 'recommendationsLoaded',
      trackId: ytId('a'),
      seedVideoId: vid('a'),
      tracks: recs('r', 2),
      continuation: 'TOKEN1',
    });
    const fail = (s: PlayerState) =>
      run(s, { type: 'radioPageRequested', seedVideoId: vid('a'), continuation: 'TOKEN1' }, { type: 'radioPageFailed', seedVideoId: vid('a'), continuation: 'TOKEN1' });
    state = fail(state);
    assert.equal(state.radio?.status, 'failed');
    assert.equal(selectRadioContinuationRequest(state), null);
    for (let retry = 1; retry <= MAX_RADIO_RETRIES; retry++) {
      assert.equal(selectCanRetryRadio(state), true, `retry ${retry}`);
      state = run(state, { type: 'radioRetry' });
      assert.equal(state.radio?.status, 'idle');
      assert.notEqual(selectRadioContinuationRequest(state), null);
      state = fail(state);
    }
    assert.equal(state.radio?.failedAttempts, MAX_RADIO_RETRIES + 1);
    assert.equal(selectCanRetryRadio(state), false);
    assert.equal(run(state, { type: 'radioRetry' }), state);
    // A new song gives the radio a fresh chance
    state = run(state, { type: 'next', random: 0 });
    assert.equal(state.radio?.status, 'idle');
    assert.equal(state.radio?.failedAttempts, 0);
  });
});

describe('network back-off', () => {
  test('losing the network keeps the play intent and counts retries', () => {
    let state = run(playingSeeds(), { type: 'networkLost' });
    assert.equal(state.network.waiting, true);
    assert.equal(state.isPlaying, true);
    assert.equal(selectNetworkRetryDelayMs(state), 3000);
    state = run(state, { type: 'networkRetryAttempted' });
    assert.equal(state.network.retryAttempt, 1);
    assert.equal(selectNetworkRetryDelayMs(state), 6000);
    assert.equal(selectNetworkRetryDelayMs(playingSeeds()), null);
    const online = playingSeeds();
    assert.equal(run(online, { type: 'networkRetryAttempted' }), online);
  });

  test('retries run out after MAX_NETWORK_RETRIES and stop playback with a notice', () => {
    let state = run(playingSeeds(), { type: 'networkLost' });
    for (let i = 0; i < MAX_NETWORK_RETRIES; i++) state = run(state, { type: 'networkRetryAttempted' });
    assert.equal(state.network.retryAttempt, MAX_NETWORK_RETRIES);
    assert.equal(state.isPlaying, true);
    const exhausted = run(state, { type: 'networkRetryAttempted' });
    assert.equal(exhausted.isPlaying, false);
    assert.deepEqual(exhausted.network, { waiting: false, retryAttempt: 0 });
    assert.match(exhausted.notice?.message ?? '', /connection/);
    const explicit = run(state, { type: 'networkRetriesExhausted' });
    assert.equal(explicit.isPlaying, false);
    assert.deepEqual(explicit.network, { waiting: false, retryAttempt: 0 });
  });

  test('the network coming back or a playing stream resets the back-off', () => {
    const waiting = run(playingSeeds(), { type: 'networkLost' }, { type: 'networkRetryAttempted' });
    assert.deepEqual(run(waiting, { type: 'networkRestored' }).network, { waiting: false, retryAttempt: 0 });
    assert.deepEqual(run(waiting, { type: 'streamStatusChanged', status: 'playing' }).network, { waiting: false, retryAttempt: 0 });
  });
});

describe('restore and notices', () => {
  test('restoring a snapshot is always paused and seeks to the saved position', () => {
    const snapshot = run(playingSeeds(), { type: 'next', random: 0 }, { type: 'networkLost' });
    const restored = run(fresh(), { type: 'restore', snapshot, positionMs: 42000 });
    assert.equal(restored.activeTrackId, 's2');
    assert.deepEqual(restored.queueIds, snapshot.queueIds);
    assert.equal(restored.isPlaying, false);
    assert.equal(restored.streamStatus, 'paused');
    assert.equal(restored.seekRequest?.ms, 42000);
    assert.deepEqual(restored.network, { waiting: false, retryAttempt: 0 });
    assert.equal(run(fresh(), { type: 'restore', snapshot, positionMs: 0 }).seekRequest, null);
    assert.equal(run(fresh(), { type: 'restore', snapshot, positionMs: 9_999_999 }).seekRequest?.ms, 199500);
  });

  test('restoring a broken snapshot repairs the invariants', () => {
    const snapshot: PlayerState = { ...playingSeeds(), queueIds: ['s2', 's3', 's2', 'ghost'], activeTrackId: 's1' };
    const restored = run(fresh(), { type: 'restore', snapshot, positionMs: 0 });
    assert.deepEqual(restored.queueIds, ['s1', 's2', 's3']);
    assertInvariants(restored);
  });

  test('notices get increasing ids and are dismissed by id', () => {
    const one = run(playingSeeds(), { type: 'addToQueue', track: yt('a') });
    const two = run(one, { type: 'addToQueue', track: yt('b') });
    assert.ok((two.notice?.id ?? 0) > (one.notice?.id ?? 0));
    assert.equal(run(two, { type: 'dismissNotice', id: one.notice!.id }), two);
    assert.equal(run(two, { type: 'dismissNotice', id: two.notice!.id }).notice, null);
    assert.equal(run(two, { type: 'dismissNotice' }).notice, null);
  });
});

/* -------------------------------- property-style random walks -------------------------------- */

function mulberry32(seedValue: number): () => number {
  let a = seedValue >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomAction(state: PlayerState, rnd: () => number): PlayerAction {
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const knownIds = [...state.queueIds, ...state.libraryIds, 'unknown-id'];
  const anyId = () => (rnd() < 0.7 && state.activeTrackId ? pick([state.activeTrackId, ...knownIds]) : pick(knownIds));
  const status = pick(['loading', 'buffering', 'playing', 'paused', 'blocked'] as const);
  const radio = state.radio;
  const radioToken = rnd() < 0.8 && radio?.continuation ? radio.continuation : 'TOKEN';
  const radioSeed = rnd() < 0.8 && radio ? radio.seedVideoId : vid('zz');
  const actions: Array<() => PlayerAction> = [
    () => ({ type: 'playFromSearch', track: yt(pick(names), pick([20000, 180000])) }),
    () => {
      const library = selectLibraryTracks(state);
      return library.length > 0
        ? { type: 'playFromList', track: pick(library), context: library.slice(0, Math.floor(rnd() * library.length)) }
        : { type: 'togglePlay' };
    },
    () => ({ type: 'playQueueItem', trackId: anyId() }),
    () => ({ type: 'togglePlay' }),
    () => ({ type: 'setPlaying', playing: rnd() < 0.5 }),
    () => ({ type: 'next', random: rnd() }),
    () => ({ type: 'previous', positionMs: pick([0, 2000, 5000]) }),
    () => ({ type: 'trackEnded', random: rnd(), trackId: rnd() < 0.9 ? state.activeTrackId : anyId() }),
    () => ({ type: 'trackUnplayable', trackId: rnd() < 0.9 ? state.activeTrackId : anyId(), random: rnd() }),
    () => ({ type: 'alternateVideoFound', trackId: anyId(), videoId: vid(pick(names) + pick(names)), durationMs: pick([10000, 250000]) }),
    () => ({ type: 'streamStatusChanged', status }),
    () => ({ type: 'seekRequested', ms: Math.floor(rnd() * 400000) - 1000 }),
    () => ({ type: 'seekHandled', token: rnd() < 0.5 ? state.seekRequest?.token : undefined }),
    () => ({ type: 'durationDiscovered', trackId: anyId(), durationMs: pick([25000, 190000, 300000]) }),
    () => ({ type: 'addToQueue', track: rnd() < 0.5 ? yt(pick(names)) : pick(SEEDS) }),
    () => ({ type: 'playNext', track: rnd() < 0.5 ? yt(pick(names)) : pick(SEEDS) }),
    () => ({ type: 'removeFromQueue', trackId: anyId() }),
    () => ({ type: 'moveQueueItem', trackId: anyId(), direction: pick([-1, 1] as const) }),
    () => ({ type: 'clearUpcoming' }),
    () => ({ type: 'toggleLike', trackId: anyId() }),
    () => ({ type: 'toggleDownloaded', trackId: anyId() }),
    () => ({ type: 'toggleShuffle' }),
    () => ({ type: 'cycleRepeat' }),
    () => ({ type: 'toggleAutoplayRadio' }),
    () => ({
      type: 'recommendationsLoaded',
      trackId: rnd() < 0.8 ? state.activeTrackId : anyId(),
      seedVideoId: vid(pick(names)),
      tracks: Array.from({ length: Math.floor(rnd() * 14) }, () => yt(pick(names) + pick(names))),
      continuation: rnd() < 0.7 ? `TOKEN${Math.floor(rnd() * 3)}` : null,
    }),
    () => ({ type: 'recommendationsFailed', trackId: state.activeTrackId, fallback: [yt(pick(names))] }),
    () => ({ type: 'radioPageRequested', seedVideoId: radioSeed, continuation: radioToken }),
    () => ({
      type: 'radioPageLoaded',
      seedVideoId: radioSeed,
      continuation: radioToken,
      tracks: Array.from({ length: Math.floor(rnd() * 30) }, () => yt(pick(names) + pick(names))),
      nextContinuation: rnd() < 0.7 ? `TOKEN${Math.floor(rnd() * 3)}` : null,
    }),
    () => ({ type: 'radioPageFailed', seedVideoId: radioSeed, continuation: radioToken }),
    () => ({ type: 'radioRetry' }),
    () => ({ type: 'networkLost' }),
    () => ({ type: 'networkRetryAttempted' }),
    () => ({ type: 'networkRetriesExhausted' }),
    () => ({ type: 'networkRestored' }),
    () => ({ type: 'restore', snapshot: state, positionMs: Math.floor(rnd() * 300000) }),
    () => ({ type: 'dismissNotice', id: state.notice?.id }),
  ];
  return pick(actions)();
}

test('random action sequences never break the player invariants', () => {
  const rnd = mulberry32(0xc0ffee);
  for (let sequence = 0; sequence < 2500; sequence++) {
    let state = createInitialPlayerState(sequence % 7 === 0 ? [] : SEEDS.slice(0, 1 + (sequence % 5)));
    for (let step = 0; step < 30; step++) {
      const action = randomAction(state, rnd);
      state = run(state, action);
      try {
        assertInvariants(state);
      } catch (err) {
        throw new Error(`sequence ${sequence}, step ${step}, action ${JSON.stringify(action)}: ${(err as Error).message}`);
      }
    }
  }
});
