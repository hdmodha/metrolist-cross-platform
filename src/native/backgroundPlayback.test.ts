import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createBackgroundPlayback,
  parseNativeDebugLog,
  type BackgroundPlaybackPlugin,
  type BackgroundPlaybackUpdate,
  type CapacitorBridgeGlobal,
} from '@metrolist/capacitor-background-playback';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';
import { createPlaybackClock } from '../player/playbackClock';
import { createInitialPlayerState, playerReducer, selectActiveTrack, type PlayerState } from '../player/playerCore';
import { createPlayerStore } from '../player/playerStore';
import {
  POSITION_SYNC_INTERVAL_MS,
  commandToPlayerCall,
  connectBackgroundPlayback,
  lifecycleToActivity,
  lifecycleToPlayerEffect,
  planBackgroundSync,
  playbackStateFor,
  startPositionAfterSwitch,
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

  test('a pause says who paused (the listener, or the player itself); playing never carries it', () => {
    const state = playing();
    assert.equal(toBackgroundUpdate(state, 0)?.pausedBy, undefined);
    assert.equal(toBackgroundUpdate(state, 0, 'player')?.pausedBy, undefined, 'only with paused');
    const paused = playerReducer(state, { type: 'setPlaying', playing: false });
    assert.equal(toBackgroundUpdate(paused, 0)?.pausedBy, 'user');
    assert.equal(toBackgroundUpdate(paused, 0, 'player')?.pausedBy, 'player');
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
    const pausedByUser = sent(update({ state: 'paused', pausedBy: 'user' }));
    assert.equal(planBackgroundSync(pausedByUser, update({ state: 'paused', pausedBy: 'player' }), 1100), 'send');
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

  test('the plugin\'s one play after a system pause plays like any other', () => {
    assert.deepEqual(commandToPlayerCall({ action: 'play', reason: 'systemPause' }), { kind: 'setPlaying', playing: true });
  });

  test('anything malformed is ignored', () => {
    for (const bad of [null, undefined, 'play', 42, {}, { action: 'stop' }, { action: 'seekTo' }, { action: 'seekTo', positionMs: -1 }, { action: 'seekTo', positionMs: Number.NaN }, { action: 'seekTo', positionMs: '5' }]) {
      assert.equal(commandToPlayerCall(bad), null, JSON.stringify(bad));
    }
  });
});

describe('the app leaving and returning to the foreground', () => {
  test('pause / stop save the player (the page may stay "visible" and get no visibilitychange)', () => {
    assert.equal(lifecycleToPlayerEffect({ state: 'pause' }), 'save');
    assert.equal(lifecycleToPlayerEffect({ state: 'stop' }), 'save');
    assert.equal(lifecycleToPlayerEffect({ state: 'resume' }), 'none');
    for (const bad of [null, 'pause', {}, { state: 'explode' }, { state: 3 }]) assert.equal(lifecycleToPlayerEffect(bad), null, JSON.stringify(bad));
  });
});

describe('lifecycle events and the app activity', () => {
  test('stop is background, resume is foreground, pause alone is neither', () => {
    assert.equal(lifecycleToActivity({ state: 'stop' }), 'background');
    assert.equal(lifecycleToActivity({ state: 'resume' }), 'foreground');
    assert.equal(lifecycleToActivity({ state: 'pause' }), null);
    for (const bad of [null, 'stop', {}, { state: 1 }]) assert.equal(lifecycleToActivity(bad), null, JSON.stringify(bad));
  });
});

describe('the plugin on each platform', () => {
  const shell = (platform: string, native = true): CapacitorBridgeGlobal => ({
    isNativePlatform: () => native,
    getPlatform: () => platform,
    nativePromise: async () => ({ entries: [{ at: 5, level: 'warn', message: 'hello' }] }),
    addListener: () => ({ remove: () => undefined }),
  });

  test('Android and iOS shells get the plugin; the web, desktop and other shells do not', () => {
    assert.equal(createBackgroundPlayback(shell('android'))?.platform, 'android');
    assert.equal(createBackgroundPlayback(shell('ios'))?.platform, 'ios');
    assert.equal(createBackgroundPlayback(shell('web', false)), null);
    assert.equal(createBackgroundPlayback(shell('android', false)), null);
    assert.equal(createBackgroundPlayback(shell('electron')), null);
    assert.equal(createBackgroundPlayback(undefined), null);
    assert.equal(createBackgroundPlayback({ isNativePlatform: () => true, getPlatform: () => 'ios' }), null);
  });

  test('the native debug log is validated', async () => {
    assert.deepEqual(await createBackgroundPlayback(shell('ios'))!.getDebugLog(), [{ at: 5, level: 'warn', message: 'hello' }]);
    assert.deepEqual(parseNativeDebugLog(null), []);
    assert.deepEqual(parseNativeDebugLog({ entries: 'x' }), []);
    assert.deepEqual(
      parseNativeDebugLog({ entries: [null, { at: 'x', message: 'a' }, { at: 1, message: 2 }, { at: 2, level: 'loud', message: 'ok' }] }),
      [{ at: 2, level: 'info', message: 'ok' }]
    );
  });
});

/** A plugin that records calls and lets the test fire commands. */
function fakePlugin() {
  const calls: Array<{ method: string; update?: BackgroundPlaybackUpdate }> = [];
  let listener: ((command: unknown) => void) | null = null;
  let lifecycleListener: ((event: unknown) => void) | null = null;
  const plugin: BackgroundPlaybackPlugin = {
    platform: 'android',
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
    getDebugLog: async () => [],
    addCommandListener: (l) => {
      listener = l;
      return () => {
        listener = null;
      };
    },
    addLifecycleListener: (l) => {
      lifecycleListener = l;
      return () => {
        lifecycleListener = null;
      };
    },
  };
  return {
    plugin,
    calls,
    updates: () => calls.filter((c) => c.method === 'update').map((c) => c.update!),
    fire: (command: unknown) => listener?.(command),
    fireLifecycle: (event: unknown) => lifecycleListener?.(event),
    hasListener: () => listener !== null || lifecycleListener !== null,
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
  let origin: 'user' | 'player' = 'user';
  const logged: string[] = [];
  let saves = 0;
  const disconnect = connectBackgroundPlayback({
    plugin: fake.plugin,
    store,
    clock,
    actions,
    now: () => now,
    pauseOrigin: () => origin,
    onSave: () => saves++,
    log: (message) => logged.push(message),
  });
  return {
    store,
    clock,
    fake,
    recorded,
    logged,
    saves: () => saves,
    disconnect,
    advance: (ms: number) => (now += ms),
    /** Dispatches as the YouTube player pausing / playing by itself (usePlayer's onExternalPlayPause). */
    asPlayer: (fn: () => void) => {
      origin = 'player';
      try {
        fn();
      } finally {
        origin = 'user';
      }
    },
  };
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

  test('a new song is sent from 0, not from the previous song\'s position (the clock is reset later)', () => {
    let state = playerReducer(createInitialPlayerState(), { type: 'playFromList', track: yt('a'), context: [yt('a'), yt('b')] });
    state = playerReducer(state, { type: 'streamStatusChanged', status: 'playing' });
    const h = harness(state);
    h.clock.setPositionMs(94000);
    assert.equal(h.fake.updates().at(-1)!.positionMs, 94000);
    h.store.dispatch({ type: 'next', random: 0 });
    const first = h.fake.updates().at(-1)!;
    assert.equal(first.title, 'Song b');
    assert.equal(first.state, 'buffering');
    assert.equal(first.positionMs, 0, 'the clock still says 94 s here');
    const count = h.fake.updates().length;
    h.clock.setPositionMs(0); // the effect that resets it
    assert.equal(h.fake.updates().length, count, 'nothing new to say');
    h.clock.setPositionMs(30000); // a later seek is honoured
    assert.equal(h.fake.updates().at(-1)!.positionMs, 30000);
    h.disconnect();
  });

  test('a restored song keeps its saved position; a seek request at the switch is honoured', () => {
    const restored = playerReducer(createInitialPlayerState(), { type: 'restore', snapshot: playing(), positionMs: 30000 });
    const h = harness(restored);
    h.clock.setPositionMs(30000);
    h.store.dispatch({ type: 'setPlaying', playing: true });
    assert.equal(h.fake.updates().at(-1)!.positionMs, 30000, 'same song: the clock is right');
    h.disconnect();
    assert.equal(startPositionAfterSwitch({ seekRequest: { token: 1, ms: 12000 } }), 12000);
    assert.equal(startPositionAfterSwitch({ seekRequest: null }), 0);
    assert.equal(startPositionAfterSwitch({ seekRequest: { token: 1, ms: Number.NaN } }), 0);
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

  test('a pause the player made itself is reported as such, and stays so until playback resumes', () => {
    const h = harness(playing());
    h.asPlayer(() => h.store.dispatch({ type: 'setPlaying', playing: false }));
    assert.equal(h.fake.updates().at(-1)!.state, 'paused');
    assert.equal(h.fake.updates().at(-1)!.pausedBy, 'player');
    h.clock.setPositionMs(60000);
    assert.equal(h.fake.updates().at(-1)!.positionMs, 60000);
    assert.equal(h.fake.updates().at(-1)!.pausedBy, 'player', 'a later position update keeps who paused');
    h.fake.fire({ action: 'play', reason: 'systemPause' });
    assert.equal(h.store.getState().isPlaying, true);
    assert.equal(h.fake.updates().at(-1)!.pausedBy, undefined);
    h.store.dispatch({ type: 'setPlaying', playing: false });
    assert.equal(h.fake.updates().at(-1)!.pausedBy, 'user', 'the app\'s own pause');
    assert.ok(h.logged.some((l) => /Command from the plugin: play \(systemPause\)/.test(l)), h.logged.join('|'));
    assert.ok(h.logged.some((l) => /To the plugin: paused \(by player\)/.test(l)), h.logged.join('|'));
    h.disconnect();
  });

  test('the app going to the background saves the player; resume and malformed events do not', () => {
    const h = harness(playing());
    h.fake.fireLifecycle({ state: 'pause' });
    h.fake.fireLifecycle({ state: 'stop' });
    assert.equal(h.saves(), 2);
    h.fake.fireLifecycle({ state: 'resume' });
    h.fake.fireLifecycle({ nope: true });
    assert.equal(h.saves(), 2);
    assert.ok(h.logged.includes('App lifecycle: stop'));
    h.disconnect();
    assert.equal(h.fake.hasListener(), false);
    h.fake.fireLifecycle({ state: 'stop' });
    assert.equal(h.saves(), 2);
  });

  test('a plugin call that fails never breaks the player', async () => {
    const store = createPlayerStore(createInitialPlayerState());
    const clock = createPlaybackClock(0);
    const failing: BackgroundPlaybackPlugin = {
      platform: 'android',
      update: () => Promise.reject(new Error('bridge gone')),
      stop: () => Promise.reject(new Error('bridge gone')),
      ensureNotificationPermission: () => Promise.reject(new Error('bridge gone')),
      getDebugLog: () => Promise.reject(new Error('bridge gone')),
      addCommandListener: () => () => undefined,
      addLifecycleListener: () => () => undefined,
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
