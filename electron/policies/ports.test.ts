import test from 'node:test';
import assert from 'node:assert/strict';
import { DESKTOP_PORTS, PREFERRED_PORT, isPortUnavailable, listenOnPreferredPort, shouldShowPortNotice } from './ports';

function errno(code: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(code);
  err.code = code;
  return err;
}

test('the preferred port is fixed (localStorage is per origin) with a short fallback list', () => {
  assert.equal(PREFERRED_PORT, 47823);
  assert.equal(DESKTOP_PORTS[0], PREFERRED_PORT);
  assert.ok(DESKTOP_PORTS.length >= 3 && DESKTOP_PORTS.length <= 8);
  assert.equal(new Set(DESKTOP_PORTS).size, DESKTOP_PORTS.length);
  assert.ok(DESKTOP_PORTS.every((p) => Number.isInteger(p) && p > 1024 && p < 65536));
});

test('the preferred port is used when it is free', async () => {
  const tried: number[] = [];
  const result = await listenOnPreferredPort(async (port) => {
    tried.push(port);
    return `server@${port}`;
  });
  assert.deepEqual(tried, [47823]);
  assert.deepEqual(result, { value: 'server@47823', port: 47823, usedFallback: false, unavailable: [] });
});

test('busy ports are skipped in order', async () => {
  const busy = new Set([47823, 47824]);
  const result = await listenOnPreferredPort(async (port) => {
    if (busy.has(port)) throw errno(port === 47823 ? 'EADDRINUSE' : 'EACCES');
    return port;
  });
  assert.deepEqual(result, { value: 47825, port: 47825, usedFallback: true, unavailable: [47823, 47824] });
});

test('when every listed port is busy, any free port (0) is the last resort', async () => {
  const tried: number[] = [];
  const result = await listenOnPreferredPort(async (port) => {
    tried.push(port);
    if (port !== 0) throw errno('EADDRINUSE');
    return 'ephemeral';
  });
  assert.deepEqual(tried, [...DESKTOP_PORTS, 0]);
  assert.equal(result.port, 0);
  assert.equal(result.usedFallback, true);
});

test('other errors are not retried', async () => {
  const tried: number[] = [];
  await assert.rejects(
    listenOnPreferredPort(async (port) => {
      tried.push(port);
      throw new Error('dist/ is missing');
    }),
    /dist\/ is missing/
  );
  assert.deepEqual(tried, [47823]);
});

test('isPortUnavailable recognises busy / forbidden ports only', () => {
  assert.equal(isPortUnavailable(errno('EADDRINUSE')), true);
  assert.equal(isPortUnavailable(errno('EACCES')), true);
  assert.equal(isPortUnavailable(errno('ENOENT')), false);
  assert.equal(isPortUnavailable(new Error('x')), false);
  assert.equal(isPortUnavailable('EADDRINUSE'), false);
});

test('the "saved data not available" notice is shown once per fallback port', () => {
  assert.equal(shouldShowPortNotice(47823, []), false);
  assert.equal(shouldShowPortNotice(47824, []), true);
  assert.equal(shouldShowPortNotice(47824, [47824]), false);
  assert.equal(shouldShowPortNotice(47825, [47824]), true);
  // A random port changes every launch: always worth saying
  assert.equal(shouldShowPortNotice(51234, [51234]), true);
});
