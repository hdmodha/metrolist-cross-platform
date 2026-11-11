import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedDesktopHost } from './hostAllowlist';

test('accepts 127.0.0.1 and localhost on the bound port only', () => {
  assert.equal(isAllowedDesktopHost('127.0.0.1:47823', 47823), true);
  assert.equal(isAllowedDesktopHost('localhost:47823', 47823), true);
  assert.equal(isAllowedDesktopHost('LocalHost:47823', 47823), true);
  assert.equal(isAllowedDesktopHost('127.0.0.1:47824', 47823), false);
  assert.equal(isAllowedDesktopHost('localhost:3000', 47823), false);
});

test('rejects other names, missing ports and malformed headers (DNS rebinding)', () => {
  for (const host of [
    undefined,
    '',
    'evil.example',
    'evil.example:47823',
    '127.0.0.1',
    'localhost',
    'localhost.:47823',
    '0.0.0.0:47823',
    '[::1]:47823',
    '127.0.0.2:47823',
    '127.0.0.1:47823.evil.example',
    'user@127.0.0.1:47823',
    ' 127.0.0.1:47823',
    '127.0.0.1:047823',
  ]) {
    assert.equal(isAllowedDesktopHost(host, 47823), false, `host ${JSON.stringify(host)}`);
  }
});

test('rejects everything when the port is not a valid TCP port', () => {
  assert.equal(isAllowedDesktopHost('127.0.0.1:0', 0), false);
  assert.equal(isAllowedDesktopHost('127.0.0.1:NaN', Number.NaN), false);
  assert.equal(isAllowedDesktopHost('127.0.0.1:70000', 70000), false);
});
