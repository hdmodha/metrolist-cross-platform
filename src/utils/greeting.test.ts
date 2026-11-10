import test from 'node:test';
import assert from 'node:assert/strict';
import { greetingFor } from './greeting';

test('the Home greeting follows the time of day', () => {
  assert.equal(greetingFor(5), 'Good morning');
  assert.equal(greetingFor(11), 'Good morning');
  assert.equal(greetingFor(12), 'Good afternoon');
  assert.equal(greetingFor(17), 'Good afternoon');
  assert.equal(greetingFor(18), 'Good evening');
  assert.equal(greetingFor(23), 'Good evening');
  assert.equal(greetingFor(0), 'Good evening');
  assert.equal(greetingFor(4), 'Good evening');
  assert.equal(greetingFor(Number.NaN), 'Good evening');
});
