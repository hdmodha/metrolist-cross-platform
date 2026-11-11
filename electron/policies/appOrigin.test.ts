import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_LEGACY_CHARS,
  MAX_LEGACY_KEYS,
  appUrl,
  legacyUrl,
  needsMigration,
  parseMigratedPorts,
  sanitizeLegacyStorage,
} from './appOrigin';

test('the window uses a host name, the old data lives under the IP address', () => {
  assert.equal(appUrl(47823), 'http://localhost:47823/');
  assert.equal(legacyUrl(47823), 'http://127.0.0.1:47823/');
});

test('only metrolist.* keys with string values are copied', () => {
  assert.deepEqual(
    sanitizeLegacyStorage({
      'metrolist.player.v2': '{"v":2}',
      'metrolist.recentSearches.v1': '["a"]',
      'metrolist.number': 5,
      other: 'x',
      __proto__: { 'metrolist.inherited': 'no' },
    }),
    { 'metrolist.player.v2': '{"v":2}', 'metrolist.recentSearches.v1': '["a"]' }
  );
});

test('anything that is not a plain object copies nothing', () => {
  for (const raw of [null, undefined, 'metrolist.player.v2', 42, ['metrolist.a'], true]) {
    assert.deepEqual(sanitizeLegacyStorage(raw), {});
  }
});

test('too many keys or too much data copies nothing (never half a library)', () => {
  const many: Record<string, string> = {};
  for (let i = 0; i <= MAX_LEGACY_KEYS; i++) many[`metrolist.k${i}`] = 'v';
  assert.deepEqual(sanitizeLegacyStorage(many), {});
  assert.deepEqual(sanitizeLegacyStorage({ 'metrolist.big': 'x'.repeat(MAX_LEGACY_CHARS) }), {});
  assert.equal(Object.keys(sanitizeLegacyStorage({ 'metrolist.ok': 'x'.repeat(1000) })).length, 1);
});

test('each port is migrated once', () => {
  assert.deepEqual(parseMigratedPorts({ migratedPorts: [47823, 0, 70000, 1.5, '47824', 47824] }), [47823, 47824]);
  for (const raw of [null, 'x', {}, { migratedPorts: 'all' }]) assert.deepEqual(parseMigratedPorts(raw), []);
  assert.equal(needsMigration(47823, []), true);
  assert.equal(needsMigration(47823, [47823]), false);
  assert.equal(needsMigration(47824, [47823]), true);
});
