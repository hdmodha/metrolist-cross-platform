import test from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEM_PAUSE_WINDOW_MS, createSystemPauseGuard, initialGuardState, reduceGuard, type GuardEvent } from './systemPauseGuard';
import { SYSTEM_PAUSE_GUARD_VECTORS, systemPauseGuardVectorsJson } from './systemPauseGuardVectors';

test('every shared vector (also run by the Android JUnit test and the iOS runner) gives the expected decisions', () => {
  assert.ok(SYSTEM_PAUSE_GUARD_VECTORS.length >= 15);
  for (const vector of SYSTEM_PAUSE_GUARD_VECTORS) {
    let state = initialGuardState();
    vector.steps.forEach((step, index) => {
      const result = reduceGuard(state, step.event);
      state = result.state;
      if (step.event.type === 'update') {
        assert.equal(result.decision, step.expect, `${vector.name} (step ${index})`);
      } else {
        assert.equal(result.decision, 'none', `${vector.name} (step ${index}): only updates decide`);
        assert.equal(step.expect, undefined, `${vector.name} (step ${index}): only updates carry a decision`);
      }
    });
  }
});

test('every vector case has a decision on its last update and resumes are covered both ways', () => {
  const decisions = SYSTEM_PAUSE_GUARD_VECTORS.flatMap((v) => v.steps.map((s) => s.expect).filter(Boolean));
  assert.ok(decisions.includes('resume'));
  assert.ok(decisions.filter((d) => d === 'none').length > decisions.filter((d) => d === 'resume').length);
});

test('the window is short: a couple of seconds, enough for the page to settle an external pause (700 ms)', () => {
  assert.ok(SYSTEM_PAUSE_WINDOW_MS >= 1500 && SYSTEM_PAUSE_WINDOW_MS <= 3000);
});

test('the reducer is pure: the same state object is never mutated', () => {
  const start = initialGuardState();
  const frozen = Object.freeze({ ...start });
  const events: GuardEvent[] = [
    { type: 'update', state: 'playing', at: 0 },
    { type: 'background', at: 10 },
    { type: 'update', state: 'paused', pausedBy: 'player', at: 20 },
  ];
  let state = frozen;
  for (const event of events) state = Object.freeze(reduceGuard(state, event).state);
  assert.deepEqual(frozen, start);
});

test('the stateful wrapper (the shape of the Java / Swift classes) answers like the reducer', () => {
  const guard = createSystemPauseGuard();
  assert.equal(guard.onUpdate('playing', undefined, 0), false);
  guard.onBackground(100);
  guard.onBackground(5000);
  assert.equal(guard.onUpdate('paused', 'player', 600), true);
  assert.equal(guard.onUpdate('paused', 'player', 700), false);
  guard.onForeground();
  guard.onBackground(10_000);
  guard.onUserCommand('pause');
  assert.equal(guard.onUpdate('paused', 'player', 10_100), false);
});

test('the JSON for the native tests carries every case', () => {
  const json = systemPauseGuardVectorsJson();
  assert.equal(json.windowMs, SYSTEM_PAUSE_WINDOW_MS);
  assert.equal(json.cases.length, SYSTEM_PAUSE_GUARD_VECTORS.length);
  assert.deepEqual(JSON.parse(JSON.stringify(json.cases)), JSON.parse(JSON.stringify(SYSTEM_PAUSE_GUARD_VECTORS)));
});
