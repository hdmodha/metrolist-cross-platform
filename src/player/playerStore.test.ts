import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPlayerState } from './playerCore';
import { createPlayerStore } from './playerStore';

const SEED = {
  id: 's1',
  videoId: 'seed_1',
  title: 'Seed 1',
  artist: 'A',
  album: 'B',
  durationMs: 200000,
  bpm: 100,
  rootFreqHz: 220,
  chordIntervals: [0, 3, 7],
  coverUrl: '',
  genre: 'Ambient' as const,
  liked: false,
  cachedOffline: false,
};

test('dispatch runs the reducer and the latest state is readable right away', () => {
  const store = createPlayerStore(createInitialPlayerState([SEED]));
  store.dispatch({ type: 'togglePlay' });
  assert.equal(store.getState().isPlaying, true);
  store.dispatch({ type: 'togglePlay' });
  assert.equal(store.getState().isPlaying, false);
});

test('subscribers hear about real changes only (no-op actions never cause a render)', () => {
  const store = createPlayerStore(createInitialPlayerState([SEED]));
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.dispatch({ type: 'seekHandled' }); // nothing to handle
  store.dispatch({ type: 'durationDiscovered', trackId: 's1', durationMs: 200500 }); // within tolerance
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
  const store = createPlayerStore(createInitialPlayerState([SEED]));
  assert.equal(store.dispatch({ type: 'dismissNotice' }), false);
  assert.equal(store.dispatch({ type: 'cycleRepeat' }), true);
});
