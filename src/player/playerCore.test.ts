import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type { MetrolistTrack } from '../data/track';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';
import {
  MAX_CONSECUTIVE_STREAM_FAILURES,
  MAX_PLAY_HISTORY,
  MAX_RADIO_RETRIES,
  MAX_RECENTLY_PLAYED,
  createInitialPlayerState,
  liveTrackId,
  playerReducer,
  selectActiveTrack,
  selectCanRetryRadio,
  selectCanTryAlternateVideo,
  selectDownloadedTracks,
  selectIsStreamLoading,
  selectLikedTracks,
  selectNetworkRetryDelayMs,
  selectQueueTracks,
  selectRadioContinuationRequest,
  selectRecentlyPlayedTracks,
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
/** The fixture name of a track id (`ytm-vids1______` → `s1`). */
const nameOf = (id: string) => id.replace(/^ytm-vid/, '').replace(/_+$/, '');
const names = (ids: readonly string[]) => ids.map(nameOf);
const q = (state: PlayerState) => names(state.queueIds).join(',');
const active = (state: PlayerState) => (state.activeTrackId === null ? null : nameOf(state.activeTrackId));

/** A list track (Liked Songs, Downloads, Recently played) named `s<n>`. */
function S(n: number, overrides: Partial<MetrolistTrack> = {}): MetrolistTrack {
  return { ...toMetrolistTrack(yt(`s${n}`, 200000)), ...overrides };
}
const sid = (n: number) => ytId(`s${n}`);
const SEEDS = [S(1), S(2), S(3), S(4), S(5)];
const fresh = () => createInitialPlayerState();

/** A state that is playing `s1` from a five-song list. */
function playingSeeds(): PlayerState {
  return run(fresh(), { type: 'playFromList', track: SEEDS[0], context: SEEDS, source: 'liked' });
}

function assertInvariants(state: PlayerState) {
  const queueSet = new Set(state.queueIds);
  assert.equal(queueSet.size, state.queueIds.length, 'queue has no duplicates');
  for (const [name, list] of [
    ['liked', state.likedIds],
    ['downloaded', state.downloadedIds],
    ['recently played', state.recentlyPlayedIds],
  ] as const) {
    assert.equal(new Set(list).size, list.length, `${name} has no duplicates`);
  }
  assert.ok(state.recentlyPlayedIds.length <= MAX_RECENTLY_PLAYED, 'recently played is capped');
  if (state.activeTrackId === null) {
    assert.equal(state.queueIds.length, 0, 'nothing active means an empty queue');
    assert.equal(state.isPlaying, false, 'nothing active never plays');
    assert.equal(state.playingFrom, null);
  } else {
    assert.ok(queueSet.has(state.activeTrackId), 'the active track is in the queue');
    assert.ok(state.tracksById[state.activeTrackId], 'the active track is known');
  }
  const referenced = new Set([
    ...state.queueIds,
    ...state.likedIds,
    ...state.downloadedIds,
    ...state.recentlyPlayedIds,
    ...state.playHistory,
  ]);
  for (const id of referenced) assert.ok(state.tracksById[id], `track ${id} is known`);
  for (const id of Object.keys(state.tracksById)) assert.ok(referenced.has(id), `unreferenced track ${id} was collected`);
  for (const id of Object.keys(state.triedVideoIdsByTrack)) assert.ok(referenced.has(id), `tried uploads of ${id} were collected`);
  const upcoming = new Set(selectUpcomingIds(state));
  for (const id of state.userQueuedIds) assert.ok(upcoming.has(id), `hand-queued ${id} is upcoming`);
  assert.ok(state.playHistory.length <= MAX_PLAY_HISTORY);
  assert.ok(state.consecutiveStreamFailures < MAX_CONSECUTIVE_STREAM_FAILURES);
  const activeTrack = selectActiveTrack(state);
  if (activeTrack) {
    assert.ok(
      !state.recommendations.some((r) => r.videoId === activeTrack.videoId || liveTrackId(r.videoId) === activeTrack.id)
    );
  }
  for (const tried of Object.values(state.triedVideoIdsByTrack)) assert.ok(tried.length <= 3);
}

/* ------------------------------------------- tests ------------------------------------------- */

describe('a fresh player and track conversion', () => {
  test('a fresh install has nothing loaded and empty lists', () => {
    const state = fresh();
    assert.equal(state.activeTrackId, null);
    assert.equal(state.isPlaying, false);
    assert.equal(state.streamStatus, 'paused');
    assert.equal(state.playingFrom, null);
    assert.deepEqual(state.queueIds, []);
    assert.deepEqual(state.likedIds, []);
    assert.deepEqual(state.downloadedIds, []);
    assert.deepEqual(state.recentlyPlayedIds, []);
    assert.equal(selectActiveTrack(state), null);
    assert.equal(selectUpcomingCount(state), 0);
    assert.deepEqual(selectQueueTracks(state), []);
    assert.deepEqual(selectLikedTracks(state), []);
    assert.equal(selectIsStreamLoading(state), false);
    assertInvariants(state);
  });

  test('accepts saved preferences', () => {
    const state = createInitialPlayerState({ shuffleEnabled: true, repeatMode: 'ONE', autoplayRadio: false });
    assert.equal(state.shuffleEnabled, true);
    assert.equal(state.repeatMode, 'ONE');
    assert.equal(state.autoplayRadio, false);
  });

  test('converts a search result to a track and never keeps a preview duration', () => {
    const track = toMetrolistTrack(yt('a'));
    assert.deepEqual(track, {
      id: `ytm-${vid('a')}`,
      videoId: vid('a'),
      title: 'Song a',
      artist: 'Artist a',
      album: 'Album',
      durationMs: 180000,
      coverUrl: 'https://img/a.jpg',
    });
    assert.equal(toMetrolistTrack(yt('b', 30000)).durationMs, 218000);
    assert.equal(toMetrolistTrack({ ...yt('c'), thumbnailUrl: '', album: '' }).coverUrl, `https://i.ytimg.com/vi/${vid('c')}/hqdefault.jpg`);
    assert.equal(toMetrolistTrack({ ...yt('c'), album: '' }).album, '');
  });

  test('with nothing loaded, transport actions are no-ops', () => {
    const empty = fresh();
    for (const action of [
      { type: 'togglePlay' },
      { type: 'setPlaying', playing: true },
      { type: 'next', random: 0.5 },
      { type: 'previous', positionMs: 0 },
      { type: 'trackEnded', random: 0.5 },
      { type: 'seekRequested', ms: 1000 },
      { type: 'seekHandled' },
      { type: 'clearUpcoming' },
      { type: 'streamStatusChanged', status: 'paused' },
      { type: 'recommendationsLoaded', trackId: 'x', tracks: [yt('r')], continuation: null },
      { type: 'recommendationsFailed', trackId: 'x', fallback: [yt('r')] },
      { type: 'removeFromQueue', trackId: 'x' },
      { type: 'moveQueueItem', trackId: 'x', direction: 1 },
      { type: 'playQueueItem', trackId: 'x' },
      { type: 'shuffleList', context: [], random: 0.3 },
      { type: 'dismissNotice' },
    ] satisfies PlayerAction[]) {
      assert.equal(run(empty, action), empty, action.type);
    }
  });

  test('adding a song to an empty player makes it the paused current song', () => {
    const added = run(fresh(), { type: 'addToQueue', track: yt('a') });
    assert.equal(active(added), 'a');
    assert.deepEqual(names(added.queueIds), ['a']);
    assert.equal(added.isPlaying, false);
    assert.deepEqual(added.recentlyPlayedIds, [], 'not played yet');
    assertInvariants(added);
    const played = run(added, { type: 'togglePlay' });
    assert.equal(played.isPlaying, true);
    assert.deepEqual(names(played.recentlyPlayedIds), ['a'], 'starting it records it');
  });
});

describe('play now', () => {
  test('a search card on a fresh player starts playing it', () => {
    const state = run(fresh(), { type: 'playFromSearch', track: yt('a'), source: 'search' });
    assert.equal(active(state), 'a');
    assert.equal(q(state), 'a');
    assert.equal(state.isPlaying, true);
    assert.equal(state.streamStatus, 'loading');
    assert.equal(state.playingFrom, 'search');
    assert.deepEqual(state.playHistory, []);
    assert.deepEqual(names(state.recentlyPlayedIds), ['a']);
    assertInvariants(state);
  });

  test('a second search card keeps history and plays after the current song', () => {
    const state = run(fresh(), { type: 'playFromSearch', track: yt('a') }, { type: 'playFromSearch', track: yt('b'), source: 'home' });
    assert.equal(q(state), 'a,b');
    assert.deepEqual(names(state.playHistory), ['a']);
    assert.deepEqual(names(state.recentlyPlayedIds), ['b', 'a']);
    assert.equal(state.playingFrom, 'home');
  });

  test('the active card toggles play / pause instead of restarting', () => {
    const playing = run(fresh(), { type: 'playFromSearch', track: yt('a') });
    const paused = run(playing, { type: 'playFromSearch', track: yt('a') });
    assert.equal(paused.isPlaying, false);
    assert.equal(paused.seekRequest, null);
    assert.equal(run(paused, { type: 'playFromSearch', track: yt('a') }).isPlaying, true);
  });

  test('a known track keeps its like and real duration when picked again from a preview-length card', () => {
    let state = run(fresh(), { type: 'playFromSearch', track: yt('a', 245000) }, { type: 'toggleLike', trackId: ytId('a') });
    state = run(state, { type: 'playFromSearch', track: yt('b') }, { type: 'playFromSearch', track: yt('a', 30000) });
    assert.equal(state.tracksById[ytId('a')].durationMs, 245000);
    assert.deepEqual(names(state.likedIds), ['a']);
  });

  test('a list row continues through the list it was picked from, keeping hand-queued songs', () => {
    let state = playingSeeds();
    assert.equal(q(state), 's1,s2,s3,s4,s5');
    assert.equal(state.playingFrom, 'liked');
    state = run(state, { type: 'addToQueue', track: yt('a') });
    assert.equal(q(state), 's1,a,s2,s3,s4,s5');
    state = run(state, { type: 'playFromList', track: SEEDS[3], context: [SEEDS[2], SEEDS[3], SEEDS[4]], source: 'downloads' });
    assert.equal(q(state), 's1,s4,a,s5');
    assert.equal(active(state), 's4');
    assert.equal(state.playingFrom, 'downloads');
    assert.deepEqual(names(state.playHistory), ['s1']);
    assert.deepEqual(names(state.userQueuedIds), ['a']);
    assertInvariants(state);
  });

  test('a list row unknown to the player is added from the payload', () => {
    const extra = S(9);
    const state = run(playingSeeds(), { type: 'playFromList', track: extra, context: [extra, SEEDS[1]] });
    assert.equal(active(state), 's9');
    assert.equal(q(state), 's1,s9,s2');
    assert.equal(state.playingFrom, null, 'no source given');
  });

  test('playing a song that sits earlier in the queue moves it after the current one', () => {
    let state = run(playingSeeds(), { type: 'next', random: 0 }, { type: 'next', random: 0 });
    assert.equal(active(state), 's3');
    state = run(state, { type: 'playFromList', track: SEEDS[0], context: [] });
    assert.equal(q(state), 's2,s3,s1');
    assert.equal(active(state), 's1');
    assert.deepEqual(names(state.playHistory), ['s1', 's2', 's3']);
    assertInvariants(state);
  });

  test('shuffle play turns shuffle on and queues the whole list around a random pick', () => {
    const state = run(fresh(), { type: 'shuffleList', context: SEEDS, random: 0.5, source: 'liked' });
    assert.equal(state.shuffleEnabled, true);
    assert.equal(active(state), 's3');
    assert.equal(q(state), 's3,s1,s2,s4,s5');
    assert.equal(state.isPlaying, true);
    assert.equal(state.playingFrom, 'liked');
    assert.equal(active(run(fresh(), { type: 'shuffleList', context: SEEDS, random: 0.999999 })), 's5');
    assert.equal(active(run(fresh(), { type: 'shuffleList', context: SEEDS, random: Number.NaN })), 's1');
    assertInvariants(state);
  });

  test('play queue item jumps without reshaping the queue', () => {
    const state = run(playingSeeds(), { type: 'playQueueItem', trackId: sid(4) });
    assert.equal(q(state), 's1,s2,s3,s4,s5');
    assert.equal(active(state), 's4');
    assert.deepEqual(names(state.playHistory), ['s1']);
    assert.equal(run(state, { type: 'playQueueItem', trackId: sid(4) }).isPlaying, false);
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
  test('toggle and set playing work on a loaded song', () => {
    const loaded = run(fresh(), { type: 'addToQueue', track: yt('a') });
    const toggled = run(loaded, { type: 'togglePlay' });
    assert.equal(toggled.isPlaying, true);
    assert.equal(run(toggled, { type: 'togglePlay' }).isPlaying, false);

    const external = run(loaded, { type: 'setPlaying', playing: true });
    assert.equal(external.isPlaying, true);
    assert.equal(run(external, { type: 'setPlaying', playing: true }), external);
    assert.equal(run(external, { type: 'setPlaying', playing: false }).isPlaying, false);
  });
});

describe('next / previous / track ended', () => {
  test('next walks the queue and wraps when pressed on the last song', () => {
    let state = run(playingSeeds(), { type: 'next', random: 0 });
    assert.equal(active(state), 's2');
    assert.deepEqual(names(state.playHistory), ['s1']);
    state = run(state, { type: 'playQueueItem', trackId: sid(5) }, { type: 'next', random: 0 });
    assert.equal(active(state), 's1');
  });

  test('repeat-one applies to a song that ends but not to pressing Next', () => {
    const state = run(playingSeeds(), { type: 'cycleRepeat' }, { type: 'cycleRepeat' });
    assert.equal(state.repeatMode, 'ONE');
    const ended = run(state, { type: 'trackEnded', random: 0 });
    assert.equal(active(ended), 's1');
    assert.equal(ended.isPlaying, true);
    assert.deepEqual(ended.seekRequest?.ms, 0);
    assert.equal(active(run(state, { type: 'next', random: 0 })), 's2');
  });

  test('track ended stops at the end of the queue with repeat off and wraps with repeat all', () => {
    const last = run(playingSeeds(), { type: 'playQueueItem', trackId: sid(5) });
    const stopped = run(last, { type: 'trackEnded', random: 0 });
    assert.equal(active(stopped), 's5');
    assert.equal(stopped.isPlaying, false);
    assert.equal(stopped.streamStatus, 'paused');
    assert.equal(stopped.seekRequest?.ms, 0);
    const wrapped = run(last, { type: 'cycleRepeat' }, { type: 'trackEnded', random: 0 });
    assert.equal(wrapped.repeatMode, 'ALL');
    assert.equal(active(wrapped), 's1');
  });

  test('a stale "ended" event for a song that is no longer playing is ignored', () => {
    const state = run(playingSeeds(), { type: 'next', random: 0 });
    assert.equal(run(state, { type: 'trackEnded', trackId: sid(1), random: 0 }), state);
    assert.equal(active(run(state, { type: 'trackEnded', trackId: sid(2), random: 0 })), 's3');
  });

  test('shuffle never picks the playing song (queue lengths 1, 2 and many)', () => {
    for (const length of [1, 2, 3, 7]) {
      const tracks = Array.from({ length }, (_, i) => S(i + 1));
      const base = run(fresh(), { type: 'playFromList', track: tracks[0], context: tracks }, { type: 'toggleShuffle' });
      for (const random of [0, 0.25, 0.5, 0.75, 0.999999]) {
        const next = run(base, { type: 'next', random });
        if (length === 1) {
          // The only song restarts
          assert.equal(active(next), 's1');
          assert.equal(next.seekRequest?.ms, 0);
        } else {
          assert.notEqual(active(next), 's1', `length ${length}, random ${random}`);
        }
        const ended = run(base, { type: 'trackEnded', random });
        if (length === 1) assert.equal(ended.isPlaying, false);
        else assert.notEqual(active(ended), 's1');
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
    assert.equal(active(first), 'a');
    assert.equal(active(run(first, { type: 'next', random: 0.99 })), 'b');
  });

  test('a single-song queue restarts on Next and seek tokens always change', () => {
    const one = run(fresh(), { type: 'playFromSearch', track: yt('a') });
    const a = run(one, { type: 'next', random: 0 });
    const b = run(a, { type: 'next', random: 0 });
    assert.equal(a.seekRequest?.ms, 0);
    assert.equal(b.seekRequest?.ms, 0);
    assert.notEqual(a.seekRequest?.token, b.seekRequest?.token);
  });

  test('previous restarts the song after 3 s, otherwise goes back', () => {
    const state = run(playingSeeds(), { type: 'next', random: 0 });
    const restarted = run(state, { type: 'previous', positionMs: 3001 });
    assert.equal(active(restarted), 's2');
    assert.equal(restarted.seekRequest?.ms, 0);
    assert.equal(restarted.isPlaying, true);
    const back = run(state, { type: 'previous', positionMs: 3000 });
    assert.equal(active(back), 's1');
    // On the first song (repeat off) Previous restarts it
    const first = run(back, { type: 'previous', positionMs: 0 });
    assert.equal(active(first), 's1');
    assert.equal(first.seekRequest?.ms, 0);
    // With repeat all it wraps to the last song
    assert.equal(active(run(back, { type: 'cycleRepeat' }, { type: 'previous', positionMs: 0 })), 's5');
  });

  test('previous with shuffle walks the play history, even to a song removed from the queue', () => {
    let state = run(playingSeeds(), { type: 'toggleShuffle' }, { type: 'playQueueItem', trackId: sid(4) }, { type: 'playQueueItem', trackId: sid(2) });
    assert.deepEqual(names(state.playHistory), ['s1', 's4']);
    state = run(state, { type: 'previous', positionMs: 0 });
    assert.equal(active(state), 's4');
    assert.deepEqual(names(state.playHistory), ['s1']);
    state = run(state, { type: 'removeFromQueue', trackId: sid(1) });
    assert.equal(q(state), 's2,s3,s4,s5');
    state = run(state, { type: 'previous', positionMs: 0 });
    assert.equal(active(state), 's1');
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
    assert.equal(active(state), 'b');
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
    assert.equal(active(state), 'c');
    assert.match(state.notice?.message ?? '', /Several songs/);
  });

  test('a single unplayable song, or one with repeat-one, never loops', () => {
    const single = run(fresh(), { type: 'playFromSearch', track: yt('a') }, { type: 'trackUnplayable', trackId: ytId('a'), random: 0 });
    assert.equal(single.isPlaying, false);
    assert.equal(active(single), 'a');
    const repeatOne = run(live(), { type: 'cycleRepeat' }, { type: 'cycleRepeat' }, { type: 'trackUnplayable', trackId: ytId('a'), random: 0 });
    assert.equal(active(repeatOne), 'b');
    // At the end of the queue with repeat off it wraps rather than replaying the broken song
    const lastSong = run(live(), { type: 'playQueueItem', trackId: ytId('d') }, { type: 'trackUnplayable', trackId: ytId('d'), random: 0 });
    assert.equal(active(lastSong), 'a');
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
    assert.deepEqual(names(state.likedIds), ['a']);
    assert.equal(active(state), 'a');
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
    assert.equal(run(state, { type: 'durationDiscovered', trackId: sid(1), durationMs: 201000 }), state);
    assert.equal(run(state, { type: 'durationDiscovered', trackId: sid(1), durationMs: 30000 }), state);
    const longer = run(state, { type: 'durationDiscovered', trackId: sid(1), durationMs: 260000 });
    assert.equal(longer.tracksById[sid(1)].durationMs, 260000);
    assert.equal(selectQueueTracks(longer)[0].durationMs, 260000);
    assert.equal(selectRecentlyPlayedTracks(longer)[0].durationMs, 260000);
  });
});

describe('queue editing', () => {
  test('add to queue keeps the order of hand-queued songs, before radio picks, with a notice', () => {
    let state = run(playingSeeds(), { type: 'addToQueue', track: yt('a') }, { type: 'addToQueue', track: yt('b') });
    assert.equal(q(state), 's1,a,b,s2,s3,s4,s5');
    assert.deepEqual(names(state.userQueuedIds), ['a', 'b']);
    assert.match(state.notice?.message ?? '', /Added “Song b” to your queue/);
    // Queueing a song that is already further down moves it up
    state = run(state, { type: 'addToQueue', track: SEEDS[4] });
    assert.equal(q(state), 's1,a,b,s5,s2,s3,s4');
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
    assert.equal(q(state), 's1,b,a,s2,s3,s4,s5');
    assert.deepEqual(names(state.userQueuedIds).sort(), ['a', 'b']);
    assert.match(state.notice?.message ?? '', /play next/);
    assert.equal(active(run(state, { type: 'next', random: 0 })), 'b');
  });

  test('remove from queue refuses the playing song and forgets hand-queued marks', () => {
    let state = run(playingSeeds(), { type: 'addToQueue', track: yt('a') });
    assert.equal(run(state, { type: 'removeFromQueue', trackId: sid(1) }), state);
    state = run(state, { type: 'removeFromQueue', trackId: ytId('a') });
    assert.equal(q(state), 's1,s2,s3,s4,s5');
    assert.deepEqual(state.userQueuedIds, []);
    assert.equal(state.tracksById[ytId('a')], undefined, 'a song nothing references any more is forgotten');
  });

  test('moving queue items around the playing song keeps every invariant', () => {
    let state = run(playingSeeds(), { type: 'next', random: 0 }, { type: 'addToQueue', track: yt('a') });
    assert.equal(q(state), 's1,s2,a,s3,s4,s5');
    // Move the playing song down: the hand-queued song is now behind it and loses its mark
    state = run(state, { type: 'moveQueueItem', trackId: sid(2), direction: 1 });
    assert.equal(q(state), 's1,a,s2,s3,s4,s5');
    assert.equal(active(state), 's2');
    assert.deepEqual(state.userQueuedIds, []);
    assert.equal(active(run(state, { type: 'next', random: 0 })), 's3');
    // Out of range moves are ignored
    assert.equal(run(state, { type: 'moveQueueItem', trackId: sid(1), direction: -1 }), state);
    assert.equal(run(state, { type: 'moveQueueItem', trackId: sid(5), direction: 1 }), state);
    state = run(state, { type: 'moveQueueItem', trackId: sid(5), direction: -1 });
    assert.equal(q(state), 's1,a,s2,s3,s5,s4');
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

describe('liked songs, downloads and recently played', () => {
  test('liking puts a song at the front of Liked Songs; unliking removes it', () => {
    let state = run(fresh(), { type: 'playFromSearch', track: yt('a') });
    state = run(state, {
      type: 'recommendationsLoaded',
      trackId: ytId('a'),
      seedVideoId: vid('a'),
      tracks: [yt('r1'), yt('r2')],
      continuation: null,
    });
    state = run(state, { type: 'toggleLike', trackId: ytId('r1') }, { type: 'toggleLike', trackId: ytId('a') }, { type: 'toggleLike', trackId: ytId('r2') });
    assert.deepEqual(names(state.likedIds), ['r2', 'a', 'r1'], 'newest first');
    assert.deepEqual(selectLikedTracks(state).map((t) => t.title), ['Song r2', 'Song a', 'Song r1']);
    assert.match(state.notice?.message ?? '', /Added to Liked Songs/);
    state = run(state, { type: 'toggleLike', trackId: ytId('a') });
    assert.deepEqual(names(state.likedIds), ['r2', 'r1']);
    assert.match(state.notice?.message ?? '', /Removed from Liked Songs/);
    // Liking it again moves it to the front
    assert.deepEqual(names(run(state, { type: 'toggleLike', trackId: ytId('a') }).likedIds), ['a', 'r2', 'r1']);
    assertInvariants(state);
  });

  test('downloads are a separate newest-first list', () => {
    let state = playingSeeds();
    state = run(state, { type: 'toggleDownloaded', trackId: sid(3) }, { type: 'toggleDownloaded', trackId: sid(1) });
    assert.deepEqual(names(state.downloadedIds), ['s1', 's3']);
    assert.deepEqual(state.likedIds, [], 'downloading does not like');
    assert.match(state.notice?.message ?? '', /Added to Downloads/);
    assert.deepEqual(selectDownloadedTracks(state).map((t) => nameOf(t.id)), ['s1', 's3']);
    state = run(state, { type: 'toggleDownloaded', trackId: sid(3) });
    assert.deepEqual(names(state.downloadedIds), ['s1']);
    assert.match(state.notice?.message ?? '', /Removed from Downloads/);
  });

  test('a search card the player has not seen yet can be liked or downloaded without queueing it', () => {
    const state = playingSeeds();
    const liked = run(state, { type: 'toggleLike', trackId: ytId('n'), track: yt('n') });
    assert.deepEqual(names(liked.likedIds), ['n']);
    assert.equal(liked.tracksById[ytId('n')].title, 'Song n');
    assert.deepEqual(liked.queueIds, state.queueIds, 'liking does not queue the song');
    const downloaded = run(state, { type: 'toggleDownloaded', trackId: ytId('n'), track: yt('n') });
    assert.deepEqual(names(downloaded.downloadedIds), ['n']);
    // A track payload whose id does not match is ignored
    assert.equal(run(state, { type: 'toggleLike', trackId: 'other', track: yt('n') }), state);
    assertInvariants(liked);
    // Unliking a song nothing else references forgets it
    const unliked = run(liked, { type: 'toggleLike', trackId: ytId('n') });
    assert.equal(unliked.tracksById[ytId('n')], undefined);
    assertInvariants(unliked);
  });

  test('liked and downloaded songs are kept after they leave the queue', () => {
    let state = run(playingSeeds(), { type: 'addToQueue', track: yt('a') }, { type: 'toggleLike', trackId: ytId('a') }, { type: 'toggleDownloaded', trackId: ytId('a') });
    state = run(state, { type: 'clearUpcoming' });
    assert.ok(!state.queueIds.includes(ytId('a')));
    assert.equal(state.tracksById[ytId('a')].title, 'Song a');
    assertInvariants(state);
  });

  test('recently played is newest first, deduplicated and capped at 30', () => {
    let state = fresh();
    for (let i = 1; i <= 35; i++) state = run(state, { type: 'playFromSearch', track: yt(`p${i}`) });
    assert.equal(state.recentlyPlayedIds.length, MAX_RECENTLY_PLAYED);
    assert.equal(nameOf(state.recentlyPlayedIds[0]), 'p35');
    assert.equal(nameOf(state.recentlyPlayedIds[29]), 'p6');
    // Playing an older song again moves it to the front (no duplicate)
    state = run(state, { type: 'playQueueItem', trackId: ytId('p10') });
    assert.deepEqual(names(state.recentlyPlayedIds.slice(0, 2)), ['p10', 'p35']);
    assert.equal(state.recentlyPlayedIds.length, MAX_RECENTLY_PLAYED);
    // Next / auto-advance record too
    state = run(state, { type: 'next', random: 0 });
    assert.equal(nameOf(state.recentlyPlayedIds[0]), 'p11');
    assertInvariants(state);
  });

  test('the stream counts as loading only for a song the listener wants to hear', () => {
    let state = run(fresh(), { type: 'playFromSearch', track: yt('a') });
    assert.equal(selectIsStreamLoading(state), true);
    state = run(state, { type: 'streamStatusChanged', status: 'playing' });
    assert.equal(selectIsStreamLoading(state), false);
    state = run(state, { type: 'streamStatusChanged', status: 'buffering' });
    assert.equal(selectIsStreamLoading(state), true);
    assert.equal(selectIsStreamLoading(run(state, { type: 'togglePlay' })), false);
    // Waiting for the network also shows the spinner
    state = run(state, { type: 'streamStatusChanged', status: 'paused' }, { type: 'networkLost' });
    assert.equal(selectIsStreamLoading(state), true);
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
    assert.equal(nameOf(state.queueIds[1]), 'r1');
    assert.deepEqual(state.radio, { seedVideoId: vid('a'), continuation: 'TOKEN1', status: 'idle', failedAttempts: 0 });
    assert.ok(!state.recentlyPlayedIds.includes(ytId('r1')), 'queued radio picks are not "played"');
    assertInvariants(state);
  });

  test('a queue with more than 5 upcoming songs only updates the shelf', () => {
    const state = playingSeeds();
    const withSix = run(state, { type: 'addToQueue', track: yt('x') }, { type: 'addToQueue', track: yt('y') });
    assert.equal(selectUpcomingCount(withSix), 6);
    const loaded = run(withSix, { type: 'recommendationsLoaded', trackId: sid(1), seedVideoId: vid('s'), tracks: recs('r', 3), continuation: 'T' });
    assert.deepEqual(loaded.queueIds, withSix.queueIds);
    assert.equal(loaded.recommendations.length, 3);
    assert.equal(loaded.radio, null);
    // 5 upcoming: topped up
    const five = run(state, { type: 'addToQueue', track: yt('x') });
    assert.equal(selectUpcomingCount(five), 5);
    const toppedUp = run(five, { type: 'recommendationsLoaded', trackId: sid(1), seedVideoId: vid('s'), tracks: recs('r', 3), continuation: 'T' });
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
    assert.equal(q(state), 'a');
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
    assert.equal(q(state), 'a,u1,r1,r2');
    assert.deepEqual(names(state.userQueuedIds), ['u1']);
    const after = run(state, { type: 'addToQueue', track: yt('u2') });
    assert.equal(q(after), 'a,u1,u2,r1,r2');
  });

  test('radio top-up keeps at most 30 played songs and appends at most 10', () => {
    const many = Array.from({ length: 40 }, (_, i) => S(i + 1));
    let state = run(fresh(), { type: 'playFromList', track: many[0], context: many }, { type: 'playQueueItem', trackId: sid(40) });
    state = run(state, { type: 'recommendationsLoaded', trackId: sid(40), seedVideoId: vid('s'), tracks: recs('r', 15), continuation: null });
    assert.equal(state.queueIds.length, 30 + 1 + 10);
    assert.equal(nameOf(state.queueIds[0]), 's10');
    assertInvariants(state);
  });

  test('playing something new ends the previous radio session (no stale pages for the old context)', () => {
    const withRadio = run(started(), {
      type: 'recommendationsLoaded',
      trackId: ytId('a'),
      seedVideoId: vid('a'),
      tracks: recs('r', 2),
      continuation: 'TOKEN1',
    });
    assert.notEqual(withRadio.radio, null);
    assert.equal(run(withRadio, { type: 'playFromSearch', track: yt('b') }).radio, null);
    assert.equal(run(withRadio, { type: 'playFromList', track: SEEDS[0], context: SEEDS }).radio, null);
    assert.equal(run(withRadio, { type: 'shuffleList', context: SEEDS, random: 0 }).radio, null);
    // Moving inside the queue keeps the session going
    assert.notEqual(run(withRadio, { type: 'next', random: 0 }).radio, null);
    assert.notEqual(run(withRadio, { type: 'playQueueItem', trackId: ytId('r1') }).radio, null);
  });

  test('a failed recommendations request shows the fallback shelf without the active song', () => {
    const state = run(started(), { type: 'recommendationsFailed', trackId: ytId('a'), fallback: [yt('a'), yt('f1')] });
    assert.deepEqual(state.recommendations.map((r) => r.videoId), [vid('f1')]);
    assert.equal(q(state), 'a');
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
    assert.deepEqual(names(state.queueIds.slice(-2)), ['p1', 'p2']);
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
    // Nothing to wait for when nothing is loaded
    const empty = fresh();
    assert.equal(run(empty, { type: 'networkLost' }), empty);
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
    const snapshot = run(playingSeeds(), { type: 'next', random: 0 }, { type: 'networkLost' }, { type: 'toggleLike', trackId: sid(3) });
    const restored = run(fresh(), { type: 'restore', snapshot, positionMs: 42000 });
    assert.equal(active(restored), 's2');
    assert.deepEqual(restored.queueIds, snapshot.queueIds);
    assert.deepEqual(restored.likedIds, snapshot.likedIds);
    assert.deepEqual(restored.recentlyPlayedIds, snapshot.recentlyPlayedIds);
    assert.equal(restored.playingFrom, 'liked');
    assert.equal(restored.isPlaying, false);
    assert.equal(restored.streamStatus, 'paused');
    assert.equal(restored.seekRequest?.ms, 42000);
    assert.deepEqual(restored.network, { waiting: false, retryAttempt: 0 });
    assert.equal(run(fresh(), { type: 'restore', snapshot, positionMs: 0 }).seekRequest, null);
    assert.equal(run(fresh(), { type: 'restore', snapshot, positionMs: 9_999_999 }).seekRequest?.ms, 199500);
  });

  test('restoring a broken snapshot repairs the invariants', () => {
    const base = playingSeeds();
    const broken = run(fresh(), { type: 'restore', snapshot: { ...base, queueIds: [sid(2), sid(3), sid(2), 'ghost'], activeTrackId: sid(1) }, positionMs: 0 });
    assert.equal(q(broken), 's1,s2,s3');
    assertInvariants(broken);
    // An unknown active song falls back to the first queued one
    const unknownActive = run(fresh(), { type: 'restore', snapshot: { ...base, activeTrackId: 'ghost' }, positionMs: 5000 });
    assert.equal(active(unknownActive), 's1');
    assertInvariants(unknownActive);
    // Nothing usable: nothing active, nothing playing
    const empty = run(fresh(), {
      type: 'restore',
      snapshot: { ...base, queueIds: ['ghost'], activeTrackId: 'ghost', isPlaying: true },
      positionMs: 5000,
    });
    assert.equal(empty.activeTrackId, null);
    assert.equal(empty.seekRequest, null);
    assertInvariants(empty);
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
  const fixtureNames = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const knownIds = [...state.queueIds, ...state.likedIds, ...state.downloadedIds, ...state.recentlyPlayedIds, 'unknown-id'];
  const activeId = state.activeTrackId ?? 'none';
  const anyId = () => (rnd() < 0.7 && state.activeTrackId ? pick([state.activeTrackId, ...knownIds]) : pick(knownIds));
  const status = pick(['loading', 'buffering', 'playing', 'paused', 'blocked'] as const);
  const radio = state.radio;
  const radioToken = rnd() < 0.8 && radio?.continuation ? radio.continuation : 'TOKEN';
  const radioSeed = rnd() < 0.8 && radio ? radio.seedVideoId : vid('zz');
  const source = pick(['home', 'search', 'liked', 'downloads', 'library', 'radio', undefined] as const);
  const someList = () =>
    pick([selectLikedTracks(state), selectDownloadedTracks(state), selectRecentlyPlayedTracks(state), SEEDS.slice(0, 1 + Math.floor(rnd() * 5))]);
  const actions: Array<() => PlayerAction> = [
    () => ({ type: 'playFromSearch', track: yt(pick(fixtureNames), pick([20000, 180000])), source }),
    () => {
      const list = someList();
      return list.length > 0
        ? { type: 'playFromList', track: pick(list), context: list.slice(0, Math.floor(rnd() * (list.length + 1))), source }
        : { type: 'togglePlay' };
    },
    () => ({ type: 'shuffleList', context: someList(), random: rnd(), source }),
    () => ({ type: 'playQueueItem', trackId: anyId() }),
    () => ({ type: 'togglePlay' }),
    () => ({ type: 'setPlaying', playing: rnd() < 0.5 }),
    () => ({ type: 'next', random: rnd() }),
    () => ({ type: 'previous', positionMs: pick([0, 2000, 5000]) }),
    () => ({ type: 'trackEnded', random: rnd(), trackId: rnd() < 0.9 ? activeId : anyId() }),
    () => ({ type: 'trackUnplayable', trackId: rnd() < 0.9 ? activeId : anyId(), random: rnd() }),
    () => ({ type: 'alternateVideoFound', trackId: anyId(), videoId: vid(pick(fixtureNames) + pick(fixtureNames)), durationMs: pick([10000, 250000]) }),
    () => ({ type: 'streamStatusChanged', status }),
    () => ({ type: 'seekRequested', ms: Math.floor(rnd() * 400000) - 1000 }),
    () => ({ type: 'seekHandled', token: rnd() < 0.5 ? state.seekRequest?.token : undefined }),
    () => ({ type: 'durationDiscovered', trackId: anyId(), durationMs: pick([25000, 190000, 300000]) }),
    () => ({ type: 'addToQueue', track: rnd() < 0.5 ? yt(pick(fixtureNames)) : pick(SEEDS) }),
    () => ({ type: 'playNext', track: rnd() < 0.5 ? yt(pick(fixtureNames)) : pick(SEEDS) }),
    () => ({ type: 'removeFromQueue', trackId: anyId() }),
    () => ({ type: 'moveQueueItem', trackId: anyId(), direction: pick([-1, 1] as const) }),
    () => ({ type: 'clearUpcoming' }),
    () => {
      const name = pick(fixtureNames);
      return rnd() < 0.4 ? { type: 'toggleLike', trackId: ytId(name), track: yt(name) } : { type: 'toggleLike', trackId: anyId() };
    },
    () => {
      const name = pick(fixtureNames);
      return rnd() < 0.4 ? { type: 'toggleDownloaded', trackId: ytId(name), track: yt(name) } : { type: 'toggleDownloaded', trackId: anyId() };
    },
    () => ({ type: 'toggleShuffle' }),
    () => ({ type: 'cycleRepeat' }),
    () => ({ type: 'toggleAutoplayRadio' }),
    () => ({
      type: 'recommendationsLoaded',
      trackId: rnd() < 0.8 ? activeId : anyId(),
      seedVideoId: vid(pick(fixtureNames)),
      tracks: Array.from({ length: Math.floor(rnd() * 14) }, () => yt(pick(fixtureNames) + pick(fixtureNames))),
      continuation: rnd() < 0.7 ? `TOKEN${Math.floor(rnd() * 3)}` : null,
    }),
    () => ({ type: 'recommendationsFailed', trackId: activeId, fallback: [yt(pick(fixtureNames))] }),
    () => ({ type: 'radioPageRequested', seedVideoId: radioSeed, continuation: radioToken }),
    () => ({
      type: 'radioPageLoaded',
      seedVideoId: radioSeed,
      continuation: radioToken,
      tracks: Array.from({ length: Math.floor(rnd() * 30) }, () => yt(pick(fixtureNames) + pick(fixtureNames))),
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
    let state = createInitialPlayerState();
    if (sequence % 7 !== 0) {
      const list = SEEDS.slice(0, 1 + (sequence % 5));
      state = run(state, { type: 'playFromList', track: list[0], context: list });
    }
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
