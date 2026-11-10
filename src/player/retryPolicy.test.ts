import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_NETWORK_RETRIES, canRetryNetwork, computeRetryDelayMs } from './retryPolicy';

test('Retry delay doubles from 3 s and is capped at 30 s', () => {
  assert.equal(computeRetryDelayMs(0), 3000);
  assert.equal(computeRetryDelayMs(1), 6000);
  assert.equal(computeRetryDelayMs(2), 12000);
  assert.equal(computeRetryDelayMs(3), 24000);
  assert.equal(computeRetryDelayMs(4), 30000);
  assert.equal(computeRetryDelayMs(50), 30000);
});

test('Retry delay treats invalid attempts as the first attempt', () => {
  assert.equal(computeRetryDelayMs(-3), 3000);
  assert.equal(computeRetryDelayMs(Number.NaN), 3000);
  assert.equal(computeRetryDelayMs(1.7), 6000);
  assert.equal(computeRetryDelayMs(Number.POSITIVE_INFINITY), 30000);
});

test('At most MAX_NETWORK_RETRIES retries are allowed', () => {
  assert.equal(MAX_NETWORK_RETRIES, 5);
  assert.equal(canRetryNetwork(0), true);
  assert.equal(canRetryNetwork(MAX_NETWORK_RETRIES - 1), true);
  assert.equal(canRetryNetwork(MAX_NETWORK_RETRIES), false);
});
