import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPlayerState, liveTrackId, playerReducer } from './playerCore';
import { createPlayerStore } from './playerStore';

const SEED = {
  videoId: 'seed_1_____',
  title: 'Seed 1',
  artist: 'A',
  album: 'B',
  durationMs: 200000,
  thumbnailUrl: '',
};

/** A player with one song loaded (paused). */
const loaded = () => playerReducer(createInitialPlayerState(), { type: 'addToQueue', track: SEED });

test('dispatch runs the reducer and the latest state is readable right away', () => {
  const store = createPlayerStore(loaded());
  store.dispatch({ type: 'togglePlay' });
  assert.equal(store.getState().isPlaying, true);
  store.dispatch({ type: 'togglePlay' });
  assert.equal(store.getState().isPlaying, false);
});

test('subscribers hear about real changes only (no-op actions never cause a render)', () => {
  const store = createPlayerStore(loaded());
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.dispatch({ type: 'seekHandled' }); // nothing to handle
  store.dispatch({ type: 'durationDiscovered', trackId: liveTrackId(SEED.videoId), durationMs: 200500 }); // within tolerance
  assert.equal(calls, 0);
  const before = store.getState();
  store.dispatch({ type: 'toggleShuffle' });
  assert.equal(calls, 1);
  assert.notEqual(store.getState(), before);
  off();
  store.dispatch({ type: 'toggleShuffle' });
  assert.equal(calls, 1);
});

test('dispatch reports whether the state changed', () => {
  const store = createPlayerStore(createInitialPlayerState());
  assert.equal(store.dispatch({ type: 'dismissNotice' }), false);
  assert.equal(store.dispatch({ type: 'cycleRepeat' }), true);
});
