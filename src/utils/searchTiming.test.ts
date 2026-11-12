import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSearchFailure, formatSearchTiming } from './searchTiming';

test('formats the search timing lines with rounded milliseconds', () => {
  assert.equal(formatSearchTiming(20, 811.6), 'search: 20 results in 812 ms');
  assert.equal(formatSearchTiming(1, 5), 'search: 1 result in 5 ms');
  assert.equal(formatSearchTiming(0, 0.2), 'search: 0 results in 0 ms');
  assert.equal(formatSearchFailure(811.6), 'search failed after 812 ms');
});
