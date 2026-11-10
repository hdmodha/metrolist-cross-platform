import test from 'node:test';
import assert from 'node:assert/strict';
import { countRender } from './renderProbe';

type ProbeGlobal = { window?: { __renderProbe?: Record<string, number> } };
const g = globalThis as unknown as ProbeGlobal;

test('render counting is a no-op unless a test installs a probe', () => {
  delete g.window;
  assert.doesNotThrow(() => countRender('App'));
  g.window = {};
  countRender('App');
  assert.equal(g.window.__renderProbe, undefined);
});

test('an installed probe counts renders per component', () => {
  g.window = { __renderProbe: {} };
  countRender('SeekBar');
  countRender('SeekBar');
  countRender('App');
  assert.deepEqual(g.window.__renderProbe, { SeekBar: 2, App: 1 });
  delete g.window;
});
