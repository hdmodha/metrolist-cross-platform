import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppActivity, positionPollIntervalMs } from './appActivity';

test('poll interval: 250 ms in the foreground, 1 s in the background', () => {
  assert.equal(positionPollIntervalMs(false), 250);
  assert.equal(positionPollIntervalMs(true), 1000);
});

test('the store notifies only on a real change, with a new snapshot', () => {
  const activity = createAppActivity();
  const first = activity.getSnapshot();
  assert.deepEqual(first, { isBackground: false });
  let calls = 0;
  const off = activity.subscribe(() => calls++);
  activity.setBackground(false);
  assert.equal(calls, 0);
  assert.equal(activity.getSnapshot(), first);
  activity.setBackground(true);
  assert.equal(calls, 1);
  assert.deepEqual(activity.getSnapshot(), { isBackground: true });
  off();
  activity.setBackground(false);
  assert.equal(calls, 1);
});
