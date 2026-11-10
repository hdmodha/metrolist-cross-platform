import test from 'node:test';
import assert from 'node:assert/strict';
import { LruTtlCache } from './lruCache';

test('LRU cache returns stored values until they expire', () => {
  const cache = new LruTtlCache<string>({ maxEntries: 3, ttlMs: 1000 });
  cache.set('a', 'A', 0);
  assert.equal(cache.get('a', 0), 'A');
  assert.equal(cache.get('a', 999), 'A');
  // Expired entries are gone (and removed)
  assert.equal(cache.get('a', 1000), undefined);
  assert.equal(cache.size, 0);
  assert.equal(cache.get('missing', 0), undefined);
});

test('LRU cache evicts the least recently used entry when full', () => {
  const cache = new LruTtlCache<number>({ maxEntries: 2, ttlMs: 10_000 });
  cache.set('a', 1, 0);
  cache.set('b', 2, 1);
  // Reading "a" makes "b" the least recently used one
  assert.equal(cache.get('a', 2), 1);
  cache.set('c', 3, 3);
  assert.equal(cache.get('b', 4), undefined);
  assert.equal(cache.get('a', 4), 1);
  assert.equal(cache.get('c', 4), 3);
  assert.equal(cache.size, 2);
});

test('LRU cache overwrites in place and refreshes the TTL', () => {
  const cache = new LruTtlCache<number>({ maxEntries: 2, ttlMs: 100 });
  cache.set('a', 1, 0);
  cache.set('b', 2, 0);
  cache.set('a', 10, 90);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('a', 150), 10);
  assert.equal(cache.get('b', 150), undefined);
  cache.delete('a');
  assert.equal(cache.get('a', 150), undefined);
  cache.set('x', 1, 0);
  cache.clear();
  assert.equal(cache.size, 0);
});

test('LRU cache rejects nonsensical limits', () => {
  assert.throws(() => new LruTtlCache({ maxEntries: 0, ttlMs: 10 }));
  assert.throws(() => new LruTtlCache({ maxEntries: 2, ttlMs: 0 }));
});
