import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RECENT_SEARCHES,
  RECENT_SEARCHES_KEY,
  addRecentSearch,
  loadRecentSearches,
  removeRecentSearch,
  saveRecentSearches,
} from './recentSearches';
import type { KeyValueStorage } from './persistence';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    removeItem: (key) => {
      delete data[key];
    },
  };
}

describe('recent searches', () => {
  test('newest first, without case-insensitive duplicates, at most 10', () => {
    let list: string[] = [];
    list = addRecentSearch(list, 'daft punk');
    list = addRecentSearch(list, 'arijit singh');
    assert.deepEqual(list, ['arijit singh', 'daft punk']);
    list = addRecentSearch(list, '  Daft   Punk ');
    assert.deepEqual(list, ['Daft Punk', 'arijit singh'], 'searching again moves it to the top, as typed');
    for (let i = 0; i < 15; i++) list = addRecentSearch(list, `query ${i}`);
    assert.equal(list.length, MAX_RECENT_SEARCHES);
    assert.equal(list[0], 'query 14');
  });

  test('blank or one-letter queries are not remembered', () => {
    const list = ['x y'];
    assert.equal(addRecentSearch(list, ''), list);
    assert.equal(addRecentSearch(list, '   '), list);
    assert.equal(addRecentSearch(list, 'a'), list);
    assert.equal(addRecentSearch(list, 'x y'), list, 'already first: unchanged');
  });

  test('removing one entry', () => {
    assert.deepEqual(removeRecentSearch(['a b', 'c d'], 'A B'), ['c d']);
    const list = ['a b'];
    assert.equal(removeRecentSearch(list, 'zz'), list);
  });

  test('persisted, validated and capped on load; storage problems are harmless', () => {
    const storage = memoryStorage();
    assert.deepEqual(loadRecentSearches(storage), []);
    assert.equal(saveRecentSearches(['b c', 'a b'], storage), true);
    assert.deepEqual(loadRecentSearches(storage), ['b c', 'a b']);
    storage.data[RECENT_SEARCHES_KEY] = JSON.stringify(['ok', 5, '', 'ok', null, ...Array.from({ length: 20 }, (_, i) => `q${i}`)]);
    const loaded = loadRecentSearches(storage);
    assert.equal(loaded.length, MAX_RECENT_SEARCHES);
    assert.deepEqual(loaded.slice(0, 2), ['ok', 'q0']);
    storage.data[RECENT_SEARCHES_KEY] = '{broken';
    assert.deepEqual(loadRecentSearches(storage), []);
    assert.deepEqual(loadRecentSearches(null), []);
    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    };
    assert.deepEqual(loadRecentSearches(throwing), []);
    assert.equal(saveRecentSearches(['x y'], throwing), false);
  });
});
