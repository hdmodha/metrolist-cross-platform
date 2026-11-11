import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyStreamError, isContentRestriction, unplayableNotice } from './streamErrors';

test('YouTube IFrame error codes map to a reason and a recovery', () => {
  assert.deepEqual(classifyStreamError(2), { reason: 'invalidVideo', recovery: 'alternate' });
  assert.deepEqual(classifyStreamError(5), { reason: 'playerError', recovery: 'retryThenAlternate' });
  assert.deepEqual(classifyStreamError(100), { reason: 'unavailable', recovery: 'alternate' });
  assert.deepEqual(classifyStreamError(101), { reason: 'embedDisabled', recovery: 'alternate' });
  assert.deepEqual(classifyStreamError(150), { reason: 'embedDisabled', recovery: 'alternate' });
  assert.deepEqual(classifyStreamError(152), { reason: 'embedderRejected', recovery: 'retryThenSkip' });
  assert.deepEqual(classifyStreamError(153), { reason: 'embedderRejected', recovery: 'retryThenSkip' });
  // An unknown code keeps the old behaviour: try another upload
  assert.deepEqual(classifyStreamError(999), { reason: 'unknown', recovery: 'alternate' });
});

test('only restrictions of the upload itself count as content restrictions', () => {
  assert.equal(isContentRestriction('embedDisabled'), true);
  assert.equal(isContentRestriction('unavailable'), true);
  assert.equal(isContentRestriction('invalidVideo'), true);
  assert.equal(isContentRestriction('playerError'), false);
  assert.equal(isContentRestriction('embedderRejected'), false);
  assert.equal(isContentRestriction('unknown'), false);
});

test('every reason has its own honest notice naming the song', () => {
  const reasons = ['embedDisabled', 'unavailable', 'invalidVideo', 'playerError', 'embedderRejected', 'unknown'] as const;
  const texts = reasons.map((r) => unplayableNotice('Iris', r));
  assert.equal(new Set(texts).size, reasons.length);
  for (const text of texts) assert.match(text, /“Iris”/);
  assert.match(unplayableNotice('Iris', 'embedDisabled'), /owner/);
  assert.match(unplayableNotice('Iris', 'unavailable'), /removed|private/);
  assert.equal(unplayableNotice('Iris'), '“Iris” can’t be played here. Skipping…');
});
