import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialPlayerState, type PlayerState } from './playerCore';
import { MAX_TIME_TO_SOUND_MS, createPlaybackTimingTracker } from './playbackTiming';

const base = createInitialPlayerState();
const st = (patch: Partial<PlayerState>): PlayerState => ({ ...base, ...patch });

function setup() {
  let t = 1000;
  const tracker = createPlaybackTimingTracker(() => t);
  return { tracker, advance: (ms: number) => (t += ms) };
}

test('a new song completes when the stream reports playing', () => {
  const { tracker, advance } = setup();
  const idle = st({});
  const loading = st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'loading' });
  assert.equal(tracker.observe(idle, loading), null);
  advance(839.6);
  assert.equal(tracker.observe(loading, st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'playing' })), 'time to sound: 840 ms (new song)');
});

test('each measurement logs once', () => {
  const { tracker, advance } = setup();
  const loading = st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'loading' });
  const playing = st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'playing' });
  tracker.observe(st({}), loading);
  advance(100);
  assert.ok(tracker.observe(loading, playing));
  assert.equal(tracker.observe(playing, st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'playing', consecutiveStreamFailures: 1 })), null);
});

test('resume on the same track is measured, a stale playing status does not complete it', () => {
  const { tracker, advance } = setup();
  const paused = st({ activeTrackId: 'a', isPlaying: false, streamStatus: 'playing' });
  const resumed = st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'playing' });
  assert.equal(tracker.observe(paused, resumed), null);
  advance(50);
  assert.equal(tracker.observe(resumed, st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'buffering' })), null);
  advance(250);
  assert.equal(tracker.observe(resumed, st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'playing' })), 'time to sound: 300 ms (resume)');
});

test('pausing, nothing active or a changed track cancels; a change while wanted starts anew', () => {
  const { tracker, advance } = setup();
  const a = st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'loading' });
  tracker.observe(st({}), a);
  advance(500);
  const pausedA = st({ activeTrackId: 'a', isPlaying: false, streamStatus: 'paused' });
  assert.equal(tracker.observe(a, pausedA), null);
  assert.equal(tracker.observe(pausedA, st({ activeTrackId: 'a', isPlaying: false, streamStatus: 'playing' })), null);

  const a2 = st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'loading' });
  tracker.observe(st({}), a2);
  advance(900);
  const b = st({ activeTrackId: 'b', isPlaying: true, streamStatus: 'loading' });
  tracker.observe(a2, b);
  advance(70);
  assert.equal(tracker.observe(b, st({ activeTrackId: 'b', isPlaying: true, streamStatus: 'playing' })), 'time to sound: 70 ms (new song)');

  const c = st({ activeTrackId: 'c', isPlaying: true, streamStatus: 'loading' });
  tracker.observe(st({}), c);
  assert.equal(tracker.observe(c, st({})), null);
  assert.equal(tracker.observe(st({}), st({ activeTrackId: null, isPlaying: true, streamStatus: 'playing' })), null);
});

test('measurements over 60 s are dropped', () => {
  const { tracker, advance } = setup();
  const loading = st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'loading' });
  tracker.observe(st({}), loading);
  advance(MAX_TIME_TO_SOUND_MS + 1);
  assert.equal(tracker.observe(loading, st({ activeTrackId: 'a', isPlaying: true, streamStatus: 'playing' })), null);
});
