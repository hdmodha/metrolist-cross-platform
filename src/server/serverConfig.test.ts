import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DEFAULT_RATE_LIMIT_PER_MINUTE, readPort, readRateLimitPerMinute, resolveDistPath } from './serverConfig';

test('the rate limit defaults to 240 and may only be set to a positive integer', () => {
  assert.equal(DEFAULT_RATE_LIMIT_PER_MINUTE, 240);
  assert.equal(readRateLimitPerMinute(undefined), 240);
  assert.equal(readRateLimitPerMinute(''), 240);
  assert.equal(readRateLimitPerMinute('abc'), 240);
  assert.equal(readRateLimitPerMinute('0'), 240);
  assert.equal(readRateLimitPerMinute('-5'), 240);
  assert.equal(readRateLimitPerMinute('2.5'), 240);
  assert.equal(readRateLimitPerMinute('100000'), 100000);
});

test('PORT falls back to 3000 unless it is a valid TCP port', () => {
  assert.equal(readPort(undefined), 3000);
  assert.equal(readPort(''), 3000);
  assert.equal(readPort('abc'), 3000);
  assert.equal(readPort('0'), 3000);
  assert.equal(readPort('70000'), 3000);
  assert.equal(readPort('3077'), 3077);
  assert.equal(readPort('8080', 9000), 8080);
  assert.equal(readPort(undefined, 9000), 9000);
});

test('dist/ is found next to the source entry or one level up from the bundled one', () => {
  const root = path.resolve('/srv/metrolist');
  const has = (paths: string[]) => (p: string) => paths.includes(p);
  // `npx tsx server.ts` at the repository root
  assert.equal(resolveDistPath(root, has([path.join(root, 'dist', 'index.html')])), path.join(root, 'dist'));
  // `node dist-server/server.mjs`
  assert.equal(
    resolveDistPath(path.join(root, 'dist-server'), has([path.join(root, 'dist', 'index.html')])),
    path.join(root, 'dist')
  );
  // Nothing built yet: the conventional location (the server then answers 404s)
  assert.equal(resolveDistPath(root, has([])), path.join(root, 'dist'));
});
