import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AD_BLOCK_HOST_RULES,
  AD_BLOCK_PATH_RULES,
  NEVER_BLOCK_HOSTS,
  NEVER_BLOCK_PATHS,
  adBlockRulesJson,
  shouldBlockRequest,
} from './adBlock';
import { adBlockGeneratedFiles, serializeGenerated } from './adBlockArtifacts';
import { AD_BLOCK_VECTORS, AD_URLS, PLAYBACK_URLS } from './adBlockVectors';

test('every shared test vector (also run by the Android JUnit test) gives the expected answer', () => {
  assert.ok(AD_BLOCK_VECTORS.length > 100);
  for (const vector of AD_BLOCK_VECTORS) {
    assert.equal(shouldBlockRequest(vector.url, vector.resourceType), vector.block, `${JSON.stringify(vector.url)} ${vector.resourceType ?? ''}`);
  }
});

test('ad and tracking requests are blocked', () => {
  for (const url of AD_URLS) assert.equal(shouldBlockRequest(url), true, url);
});

test('nothing playback needs is ever blocked', () => {
  for (const url of PLAYBACK_URLS) assert.equal(shouldBlockRequest(url), false, url);
  for (const url of PLAYBACK_URLS) {
    assert.ok(AD_BLOCK_VECTORS.some((v) => v.url === url && !v.block && !v.resourceType), `${url} is a shared vector`);
  }
});

test('no blocking rule overlaps what playback needs', () => {
  for (const rule of AD_BLOCK_HOST_RULES) {
    for (const keep of NEVER_BLOCK_HOSTS) {
      assert.ok(!(keep === rule.host || keep.endsWith(`.${rule.host}`) || rule.host.endsWith(`.${keep}`)), `${rule.host} vs ${keep}`);
    }
  }
  for (const rule of AD_BLOCK_PATH_RULES) {
    for (const keep of NEVER_BLOCK_PATHS) {
      assert.ok(!keep.startsWith(rule.pathPrefix) && !rule.pathPrefix.startsWith(keep), `${rule.pathPrefix} vs ${keep}`);
    }
  }
  for (const rule of [...AD_BLOCK_HOST_RULES, ...AD_BLOCK_PATH_RULES]) assert.ok(rule.why.length > 20, 'every rule says why it is safe');
});

test('matching is linear: hostile URLs are fast', () => {
  const longHost = `${'a.'.repeat(100)}doubleclick.net`;
  const longPath = `https://www.youtube.com/${'p/'.repeat(20000)}`;
  const started = Date.now();
  for (let i = 0; i < 200; i++) {
    shouldBlockRequest(`https://${longHost}/x`);
    shouldBlockRequest(longPath);
  }
  assert.ok(Date.now() - started < 500);
});

test('the generated rule and vector files are in sync (npm run adblock:rules)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const files = adBlockGeneratedFiles();
  assert.deepEqual(
    files.map((f) => f.path),
    [
      'src/shared/adBlockRules.json',
      'native/capacitor-background-playback/android/src/main/assets/metrolist-ad-block-rules.json',
      'native/capacitor-background-playback/android/src/test/resources/ad-block-vectors.json',
    ]
  );
  assert.deepEqual(files[1].data, adBlockRulesJson(), 'the Android asset holds the same rules');
  for (const file of files) {
    const onDisk = fs.readFileSync(path.join(root, file.path), 'utf8');
    assert.equal(onDisk, serializeGenerated(file.data), `${file.path} is stale: run \`npm run adblock:rules\``);
  }
});
