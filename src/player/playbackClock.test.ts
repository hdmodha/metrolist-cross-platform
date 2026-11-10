import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackClock } from './playbackClock';

test('the clock starts at the given position and reports updates', () => {
  const clock = createPlaybackClock(1200);
  assert.equal(clock.getPositionMs(), 1200);
  clock.setPositionMs(5000);
  assert.equal(clock.getPositionMs(), 5000);
  assert.equal(createPlaybackClock().getPositionMs(), 0);
});

test('subscribers are notified only when the position really changes', () => {
  const clock = createPlaybackClock();
  const seen: number[] = [];
  const unsubscribe = clock.subscribe(() => seen.push(clock.getPositionMs()));
  clock.setPositionMs(250);
  clock.setPositionMs(250);
  clock.setPositionMs(500);
  unsubscribe();
  clock.setPositionMs(750);
  assert.deepEqual(seen, [250, 500]);
});

test('invalid positions are clamped to a non-negative whole number', () => {
  const clock = createPlaybackClock(-50);
  assert.equal(clock.getPositionMs(), 0);
  clock.setPositionMs(Number.NaN);
  assert.equal(clock.getPositionMs(), 0);
  clock.setPositionMs(1234.6);
  assert.equal(clock.getPositionMs(), 1235);
  clock.setPositionMs(Number.POSITIVE_INFINITY);
  assert.equal(clock.getPositionMs(), 1235, 'non-finite input is ignored');
});

test('a subscriber that unsubscribes while being notified does not break the others', () => {
  const clock = createPlaybackClock();
  const calls: string[] = [];
  const offA = clock.subscribe(() => {
    calls.push('a');
    offA();
  });
  clock.subscribe(() => calls.push('b'));
  clock.setPositionMs(1);
  clock.setPositionMs(2);
  assert.deepEqual(calls, ['a', 'b', 'b']);
});
