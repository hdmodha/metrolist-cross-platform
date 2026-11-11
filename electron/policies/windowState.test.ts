import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SIZE, MIN_SIZE, parseWindowState, restoreWindowState, type Rect } from './windowState';

const laptop: Rect = { x: 0, y: 25, width: 1440, height: 875 };
const external: Rect = { x: 1440, y: 0, width: 2560, height: 1415 };

test('minimum size is about 360 x 560', () => {
  assert.deepEqual(MIN_SIZE, { width: 360, height: 560 });
});

test('no saved state: default size, centred on the primary display', () => {
  const state = restoreWindowState(null, [laptop], laptop);
  assert.equal(state.maximized, false);
  assert.equal(state.bounds.width, DEFAULT_SIZE.width);
  assert.equal(state.bounds.height, DEFAULT_SIZE.height);
  assert.equal(state.bounds.x, Math.round(laptop.x + (laptop.width - DEFAULT_SIZE.width) / 2));
  assert.equal(state.bounds.y, Math.round(laptop.y + (laptop.height - DEFAULT_SIZE.height) / 2));
});

test('the default size shrinks to a small primary display', () => {
  const small: Rect = { x: 0, y: 0, width: 1024, height: 600 };
  const state = restoreWindowState(null, [small], small);
  assert.deepEqual(state.bounds, { x: 0, y: 0, width: 1024, height: 600 });
});

test('a visible saved window is restored exactly, including maximised', () => {
  const saved = { bounds: { x: 1600, y: 100, width: 1200, height: 900 }, maximized: true };
  assert.deepEqual(restoreWindowState(saved, [laptop, external], laptop), saved);
});

test('a window on a display that is gone is moved back onto the primary display', () => {
  const saved = { bounds: { x: 3000, y: 200, width: 1000, height: 700 }, maximized: false };
  const state = restoreWindowState(saved, [laptop], laptop);
  assert.deepEqual(state.bounds, { x: 220, y: 113, width: 1000, height: 700 });
});

test('a window hanging off the edge is pulled fully onto the display it mostly sits on', () => {
  const saved = { bounds: { x: 1100, y: -50, width: 800, height: 700 }, maximized: false };
  const state = restoreWindowState(saved, [laptop, external], laptop);
  // Mostly on the external display (x >= 1440 covers 460 px of 800): stays there, moved inside it
  assert.deepEqual(state.bounds, { x: 1440, y: 0, width: 800, height: 700 });
  const onLaptop = restoreWindowState({ bounds: { x: 900, y: -50, width: 800, height: 700 }, maximized: false }, [laptop, external], laptop);
  assert.deepEqual(onLaptop.bounds, { x: 640, y: 25, width: 800, height: 700 });
});

test('sizes are clamped between the minimum and the display', () => {
  const tiny = restoreWindowState({ bounds: { x: 10, y: 40, width: 100, height: 100 }, maximized: false }, [laptop], laptop);
  assert.deepEqual(tiny.bounds, { x: 10, y: 40, width: 360, height: 560 });
  const huge = restoreWindowState({ bounds: { x: 0, y: 25, width: 5000, height: 3000 }, maximized: false }, [laptop], laptop);
  assert.deepEqual(huge.bounds, { x: 0, y: 25, width: 1440, height: 875 });
});

test('a sliver left on a display does not count as visible', () => {
  const saved = { bounds: { x: 1430, y: 880, width: 800, height: 700 }, maximized: false };
  const state = restoreWindowState(saved, [laptop], laptop);
  assert.deepEqual(state.bounds, { x: 320, y: 113, width: 800, height: 700 });
});

test('parseWindowState validates every field', () => {
  const good = { bounds: { x: -100, y: 20, width: 1200, height: 800 }, maximized: false };
  assert.deepEqual(parseWindowState(good), good);
  assert.deepEqual(parseWindowState(JSON.parse(JSON.stringify(good))), good);
  for (const bad of [
    null,
    undefined,
    'x',
    42,
    {},
    { bounds: good.bounds },
    { bounds: { ...good.bounds, width: '1200' }, maximized: false },
    { bounds: { ...good.bounds, height: Number.NaN }, maximized: false },
    { bounds: { ...good.bounds, x: Number.POSITIVE_INFINITY }, maximized: false },
    { bounds: { ...good.bounds, width: 0 }, maximized: false },
    { bounds: { ...good.bounds, width: 100_000 }, maximized: false },
    { bounds: good.bounds, maximized: 'yes' },
  ]) {
    assert.equal(parseWindowState(bad), null, JSON.stringify(bad));
  }
});
