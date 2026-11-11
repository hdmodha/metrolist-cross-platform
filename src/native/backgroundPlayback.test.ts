import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type { BackgroundPlaybackPlugin, BackgroundPlaybackUpdate } from '@metrolist/capacitor-background-playback';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';
import { createPlaybackClock } from '../player/playbackClock';
import { createInitialPlayerState, playerReducer, selectActiveTrack, type PlayerState } from '../player/playerCore';
import { createPlayerStore } from '../player/playerStore';
import {
  POSITION_SYNC_INTERVAL_MS,
  commandToPlayerCall,
  connectBackgroundPlayback,
  planBackgroundSync,
  playbackStateFor,
  toBackgroundUpdate,
  type BackgroundPlayerActions,
  type SentUpdate,
} from './backgroundPlayback';

const vid = (name: string) => `vid${name}`.padEnd(11, '_');
const yt = (name: string, durationMs = 200000): InnerTubeParsedTrack => ({
  videoId: vid(name),
  title: `Song ${name}`,
  artist: `Artist ${name}`,
  album: `Album ${name}`,
  durationMs,
  thumbnailUrl: `https://i.ytimg.com/vi/${vid(name)}/hqdefault.jpg`,
});

function playing(name = 'a'): PlayerState {
  let state = playerReducer(createInitialPlayerState(), { type: 'playFromSearch', track: yt(name) });
  state = playerReducer(state, { type: 'streamStatusChanged', status: 'playing' });
  return state;
}

const update = (overrides: Partial<BackgroundPlaybackUpdate> = {}): BackgroundPlaybackUpdate => ({
  title: 'Song a',
  artist: 'Artist a',
  album: 'Album a',
  artworkUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
  durationMs: 200000,
  positionMs: 10000,
  state: 'playing',
  ...overrides,
});
const sent = (u: BackgroundPlaybackUpdate, sentAtMs = 1000): SentUpdate => ({ update: u, sentAtMs });

describe('mapping the player to the notification', () => {
  test('playing / buffering / paused: what the listener wants, and whether it is audible yet', () => {
    assert.equal(playbackStateFor(true, 'playing'), 'playing');
    for (const status of ['loading', 'buffering', 'paused', 'blocked'] as const) {
      assert.equal(playbackStateFor(true, status), 'buffering', status);
    }
    for (const status of ['loading', 'buffering', 'playing', 'paused', 'blocked'] as const) {
      assert.equal(playbackStateFor(false, status), 'paused', status);
    }
  });

  test('the active song with its metadata, duration and a clamped position', () => {
    const state = playing();
    const track = selectActiveTrack(state)!;
    assert.deepEqual(toBackgroundUpdate(state, 12345.6), {
      title: track.title,
      artist: track.artist,
      album: track.album,
      artworkUrl: track.coverUrl,
      durationMs: 200000,
      positionMs: 12346,
      state: 'playing',
    });
    assert.equal(toBackgroundUpdate(state, -5)?.positionMs, 0);
    assert.equal(toBackgroundUpdate(state, 999999)?.positionMs, 200000);
    assert.equal(toBackgroundUpdate(state, Number.NaN)?.positionMs, 0);
    assert.equal(toBackgroundUpdate(createInitialPlayerState(), 0), null);
  });

  test('only http(s) artwork is handed to the native side', () => {
    let state = playing();
    const id = state.activeTrackId!;
    state = { ...state, tracksById: { ...state.tracksById, [id]: { ...state.tracksById[id], coverUrl: 'data:image/png;base64,AAAA' } } };
    assert.equal(toBackgroundUpdate(state, 0)?.artworkUrl, '');
  });
});

describe('when to send an update', () => {
  test('nothing is shown before the first play (a restored, paused session stays quiet)', () => {
    assert.equal(planBackgroundSync(null, null, 0), 'skip');
    assert.equal(planBackgroundSync(null, update({ state: 'paused' }), 0), 'skip');
    assert.equal(planBackgroundSync(null, update({ state: 'buffering' }), 0), 'send');
    assert.equal(planBackgroundSync(null, update(), 0), 'send');
  });

  test('nothing active any more after something was shown: stop', () => {
    assert.equal(planBackgroundSync(sent(update()), null, 2000), 'stop');
  });

  test('a new song, new metadata or a new state is sent at once', () => {
    const last = sent(update());
    assert.equal(planBackgroundSync(last, update({ title: 'Song b' }), 1100), 'send');
    assert.equal(planBackgroundSync(last, update({ artworkUrl: 'https://i.ytimg.com/b.jpg' }), 1100), 'send');
    assert.equal(planBackgroundSync(last, update({ durationMs: 210000 }), 1100), 'send');
    assert.equal(planBackgroundSync(last, update({ state: 'paused', positionMs: 10100 }), 1100), 'send');
    assert.equal(planBackgroundSync(last, update({ state: 'buffering', positionMs: 10100 }), 1100), 'send');
  });

  test('while playing, the position is re-sent at most every 5 seconds', () => {
    const last = sent(update({ positionMs: 10000 }), 1000);
    assert.equal(POSITION_SYNC_INTERVAL_MS, 5000);
    assert.equal(planBackgroundSync(last, update({ positionMs: 10250 }), 1250), 'skip');
    assert.equal(planBackgroundSync(last, update({ positionMs: 14900 }), 5900), 'skip');
    assert.equal(planBackgroundSync(last, update({ positionMs: 15000 }), 6000), 'send');
  });

  test('a seek is sent at once (the position jumps away from where playback would be)', () => {
    const last = sent(update({ positionMs: 10000 }), 1000);
    assert.equal(planBackgroundSync(last, update({ positionMs: 60000 }), 1300), 'send');
    assert.equal(planBackgroundSync(last, update({ positionMs: 0 }), 1300), 'send');
    const paused = sent(update({ state: 'paused', positionMs: 10000 }), 1000);
    assert.equal(planBackgroundSync(paused, update({ state: 'paused', positionMs: 10000 }), 30000), 'skip');
    assert.equal(planBackgroundSync(paused, update({ state: 'paused', positionMs: 40000 }), 1200), 'send');
  });
});

describe('commands from the notification, lock screen and headset', () => {
  test('map to player actions', () => {
    assert.deepEqual(commandToPlayerCall({ action: 'play' }), { kind: 'setPlaying', playing: true });
    assert.deepEqual(commandToPlayerCall({ action: 'pause' }), { kind: 'setPlaying', playing: false });
    assert.deepEqual(commandToPlayerCall({ action: 'pause', reason: 'noisy' }), { kind: 'setPlaying', playing: false });
    assert.deepEqual(commandToPlayerCall({ action: 'next' }), { kind: 'next' });
    assert.deepEqual(commandToPlayerCall({ action: 'previous' }), { kind: 'previous' });
    assert.deepEqual(commandToPlayerCall({ action: 'seekTo', positionMs: 42000.4 }), { kind: 'seekTo', ms: 42000 });
  });

  test('anything malformed is ignored', () => {
    for (const bad of [null, undefined, 'play', 42, {}, { action: 'stop' }, { action: 'seekTo' }, { action: 'seekTo', positionMs: -1 }, { action: 'seekTo', positionMs: Number.NaN }, { action: 'seekTo', positionMs: '5' }]) {
      assert.equal(commandToPlayerCall(bad), null, JSON.stringify(bad));
    }
  });
});

/** A plugin that records calls and lets the test fire commands. */
function fakePlugin() {
  const calls: Array<{ method: string; update?: BackgroundPlaybackUpdate }> = [];
  let listener: ((command: unknown) => void) | null = null;
  const plugin: BackgroundPlaybackPlugin = {
    update: async (u) => {
      calls.push({ method: 'update', update: u });
    },
    stop: async () => {
      calls.push({ method: 'stop' });
    },
    ensureNotificationPermission: async () => {
      calls.push({ method: 'ensureNotificationPermission' });
      return { granted: true };
    },
    addCommandListener: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
  };
  return {
    plugin,
    calls,
    updates: () => calls.filter((c) => c.method === 'update').map((c) => c.update!),
    fire: (command: unknown) => listener?.(command),
    hasListener: () => listener !== null,
  };
}

function harness(initial: PlayerState) {
  const store = createPlayerStore(initial);
  const clock = createPlaybackClock(0);
  let now = 1000;
  const recorded: string[] = [];
  const actions: BackgroundPlayerActions = {
    setPlaying: (p) => {
      recorded.push(`setPlaying:${p}`);
      store.dispatch({ type: 'setPlaying', playing: p });
    },
    next: () => {
      recorded.push('next');
      store.dispatch({ type: 'next', random: 0 });
    },
    previous: () => {
      recorded.push('previous');
      store.dispatch({ type: 'previous', positionMs: clock.getPositionMs() });
    },
    seekTo: (ms) => {
      recorded.push(`seekTo:${ms}`);
      clock.setPositionMs(ms);
    },
  };
  const fake = fakePlugin();
  const disconnect = connectBackgroundPlayback({ plugin: fake.plugin, store, clock, actions, now: () => now });
  return { store, clock, fake, recorded, disconnect, advance: (ms: number) => (now += ms) };
}

describe('connecting the player to the plugin', () => {
  test('a restored, paused session sends nothing until the listener presses play', () => {
    const restored = playerReducer(createInitialPlayerState(), { type: 'restore', snapshot: playing(), positionMs: 30000 });
    const h = harness(restored);
    assert.deepEqual(h.fake.calls, []);
    h.store.dispatch({ type: 'setPlaying', playing: true });
    assert.equal(h.fake.updates().length, 1);
    assert.equal(h.fake.updates()[0].state, 'buffering');
    h.disconnect();
  });

  test('playing sends the metadata and a playing state, and asks for the notification permission once', () => {
    const h = harness(createInitialPlayerState());
    h.store.dispatch({ type: 'playFromSearch', track: yt('a') });
    h.store.dispatch({ type: 'streamStatusChanged', status: 'playing' });
    const last = h.fake.updates().at(-1)!;
    assert.equal(last.title, 'Song a');
    assert.equal(last.artist, 'Artist a');
    assert.equal(last.state, 'playing');
    h.store.dispatch({ type: 'playFromSearch', track: yt('b') });
    h.store.dispatch({ type: 'streamStatusChanged', status: 'playing' });
    assert.equal(h.fake.updates().at(-1)!.title, 'Song b');
    assert.equal(h.fake.calls.filter((c) => c.method === 'ensureNotificationPermission').length, 1);
    h.disconnect();
  });

  test('clock ticks send the position at most every 5 seconds; a seek at once', () => {
    const h = harness(createInitialPlayerState());
    h.store.dispatch({ type: 'playFromSearch', track: yt('a') });
    h.store.dispatch({ type: 'streamStatusChanged', status: 'playing' });
    const before = h.fake.updates().length;
    for (let i = 1; i <= 16; i++) {
      h.advance(250);
      h.clock.setPositionMs(i * 250);
    }
    assert.equal(h.fake.updates().length, before, '4 s of ticks: nothing new');
    for (let i = 17; i <= 20; i++) {
      h.advance(250);
      h.clock.setPositionMs(i * 250);
    }
    assert.equal(h.fake.updates().length, before + 1, 'at 5 s the position is re-sent');
    h.clock.setPositionMs(90000);
    assert.equal(h.fake.updates().at(-1)!.positionMs, 90000, 'a seek is sent at once');
    h.disconnect();
  });

  test('commands from the plugin drive the player through its actions', () => {
    let state = playerReducer(createInitialPlayerState(), { type: 'playFromList', track: yt('a'), context: [yt('a'), yt('b'), yt('c')] });
    state = playerReducer(state, { type: 'streamStatusChanged', status: 'playing' });
    const h = harness(state);
    h.fake.fire({ action: 'next' });
    assert.equal(selectActiveTrack(h.store.getState())?.title, 'Song b');
    h.fake.fire({ action: 'pause', reason: 'noisy' });
    assert.equal(h.store.getState().isPlaying, false);
    assert.equal(h.fake.updates().at(-1)!.state, 'paused');
    h.fake.fire({ action: 'play', reason: 'notification' });
    assert.equal(h.store.getState().isPlaying, true);
    h.fake.fire({ action: 'seekTo', positionMs: 42000 });
    assert.equal(h.clock.getPositionMs(), 42000);
    h.fake.fire({ action: 'previous' });
    h.fake.fire({ action: 'bogus' });
    assert.deepEqual(h.recorded, ['next', 'setPlaying:false', 'setPlaying:true', 'seekTo:42000', 'previous']);
    h.disconnect();
    assert.equal(h.fake.hasListener(), false);
  });

  test('nothing active any more: the plugin is stopped once; disconnecting stops listening', () => {
    const h = harness(playing());
    assert.equal(h.fake.updates().length, 1);
    h.store.dispatch({ type: 'restore', snapshot: { ...createInitialPlayerState() }, positionMs: 0 });
    assert.equal(h.fake.calls.filter((c) => c.method === 'stop').length, 1);
    h.store.dispatch({ type: 'toggleShuffle' });
    assert.equal(h.fake.calls.filter((c) => c.method === 'stop').length, 1);
    h.disconnect();
    const count = h.fake.calls.length;
    h.store.dispatch({ type: 'playFromSearch', track: yt('z') });
    assert.equal(h.fake.calls.length, count);
  });

  test('a plugin call that fails never breaks the player', async () => {
    const store = createPlayerStore(createInitialPlayerState());
    const clock = createPlaybackClock(0);
    const failing: BackgroundPlaybackPlugin = {
      update: () => Promise.reject(new Error('bridge gone')),
      stop: () => Promise.reject(new Error('bridge gone')),
      ensureNotificationPermission: () => Promise.reject(new Error('bridge gone')),
      addCommandListener: () => () => undefined,
    };
    const noop = () => undefined;
    const disconnect = connectBackgroundPlayback({
      plugin: failing,
      store,
      clock,
      actions: { setPlaying: noop, next: noop, previous: noop, seekTo: noop },
    });
    store.dispatch({ type: 'playFromSearch', track: yt('a') });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(store.getState().isPlaying, true);
    disconnect();
  });
});
