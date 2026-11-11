import test from 'node:test';
import assert from 'node:assert/strict';
import { NEVER_BLOCK_HOSTS, NEVER_BLOCK_PATHS, shouldBlockRequest } from './adBlock';
import { AD_BLOCK_VECTORS, AD_URLS, PLAYBACK_URLS } from './adBlockVectors';
import {
  WEBKIT_KNOWN_DIFFERENCES,
  escapeWebKitRegex,
  hostUrlFilter,
  simulateWebKitContentBlocker,
  webkitContentBlockerRules,
} from './webkitContentBlocker';

const rules = webkitContentBlockerRules();
const onIos = (url: string) => simulateWebKitContentBlocker(rules, url);

test('nothing playback needs is ever blocked on iOS', () => {
  for (const url of PLAYBACK_URLS) assert.equal(onIos(url), false, url);
});

test('ad and tracking requests are blocked on iOS', () => {
  for (const url of AD_URLS) assert.equal(onIos(url), true, url);
});

test('every shared vector gives the TypeScript answer on iOS, except exactly the documented differences', () => {
  const differing = AD_BLOCK_VECTORS.filter((v) => onIos(v.url) !== v.block).map((v) => ({ url: v.url, resourceType: v.resourceType }));
  assert.deepEqual(
    differing,
    WEBKIT_KNOWN_DIFFERENCES.map((d) => ({ url: d.url, resourceType: d.resourceType }))
  );
  for (const difference of WEBKIT_KNOWN_DIFFERENCES) {
    assert.ok(difference.why.length > 20);
    // None of them concerns something playback needs
    assert.equal(shouldBlockRequest(difference.url, difference.resourceType) || difference.resourceType === 'mainFrame', true);
    assert.ok(!PLAYBACK_URLS.includes(difference.url));
  }
});

test('the never-block entries come last, as ignore-previous-rules, for every never-block host and path', () => {
  const firstIgnore = rules.findIndex((r) => r.action.type === 'ignore-previous-rules');
  assert.ok(firstIgnore > 0);
  assert.ok(rules.slice(firstIgnore).every((r) => r.action.type === 'ignore-previous-rules'), 'no block rule after the first ignore rule');
  const ignored = rules.slice(firstIgnore).map((r) => r.trigger['url-filter']);
  for (const host of NEVER_BLOCK_HOSTS) assert.ok(ignored.includes(hostUrlFilter(host)), host);
  for (const path of NEVER_BLOCK_PATHS) {
    assert.ok(ignored.some((f) => f.endsWith(escapeWebKitRegex(path.slice(1)))), path);
  }
  // The never-block hosts are the very last entries
  assert.deepEqual(ignored.slice(-NEVER_BLOCK_HOSTS.length), NEVER_BLOCK_HOSTS.map(hostUrlFilter));
});

test('filters only use what WebKit content blockers support (no alternation, anchors only at the start)', () => {
  for (const r of rules) {
    const filter = r.trigger['url-filter'];
    assert.equal(r.trigger['url-filter-is-case-sensitive'], true);
    assert.ok(filter.startsWith('^https?://'), filter);
    assert.ok(!/(^|[^\\])\|/.test(filter), `no | in ${filter}`);
    assert.ok(!filter.slice(1).includes('^') && !filter.includes('$'), `anchors in ${filter}`);
    assert.ok(!/[{}]/.test(filter), `no counted repetition in ${filter}`);
    assert.ok(/^[\x20-\x7e]+$/.test(filter), 'ASCII only');
    assert.deepEqual(Object.keys(r).sort(), ['action', 'trigger']);
  }
  // WebKit refuses an empty list and very large ones; ours is small
  assert.ok(rules.length > 10 && rules.length < 200);
});

test('escaping covers every operator character', () => {
  assert.equal(escapeWebKitRegex('a.b*c+d?(e)[f]{g}|h^i$j\\k/l'), 'a\\.b\\*c\\+d\\?\\(e\\)\\[f\\]\\{g\\}\\|h\\^i\\$j\\\\k\\/l');
  assert.equal(hostUrlFilter('Doubleclick.NET'), '^https?://([a-z0-9_.-]*\\.)?doubleclick\\.net\\.?(:[0-9]+)?/');
});
