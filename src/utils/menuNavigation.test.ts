import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { nextMenuIndex, placeMenu } from './menuNavigation';

describe('menu keyboard navigation', () => {
  test('arrows wrap around, Home / End jump to the ends', () => {
    assert.equal(nextMenuIndex(0, 'ArrowDown', 4), 1);
    assert.equal(nextMenuIndex(3, 'ArrowDown', 4), 0);
    assert.equal(nextMenuIndex(0, 'ArrowUp', 4), 3);
    assert.equal(nextMenuIndex(2, 'Home', 4), 0);
    assert.equal(nextMenuIndex(1, 'End', 4), 3);
    // Nothing focused yet
    assert.equal(nextMenuIndex(-1, 'ArrowDown', 4), 0);
    assert.equal(nextMenuIndex(-1, 'ArrowUp', 4), 3);
  });

  test('other keys and empty menus are not navigation', () => {
    assert.equal(nextMenuIndex(0, 'a', 4), null);
    assert.equal(nextMenuIndex(0, 'Enter', 4), null);
    assert.equal(nextMenuIndex(0, 'ArrowDown', 0), null);
  });
});

describe('menu placement', () => {
  const viewport = { width: 400, height: 800 };
  const insets = { top: 64, bottom: 96 }; // sticky header + fixed now-playing bar
  const menu = { width: 200, height: 180 };
  const trigger = (top: number, left = 340) => ({ top, bottom: top + 40, left, right: left + 40 });

  test('opens below the trigger, right-aligned with it', () => {
    const p = placeMenu({ trigger: trigger(200), menu, viewport, insets });
    assert.deepEqual(p, { top: 244, left: 180, maxHeight: 180, placement: 'below' });
  });

  test('flips above when the fixed bottom bar would cover it', () => {
    const p = placeMenu({ trigger: trigger(600), menu, viewport, insets });
    assert.equal(p.placement, 'above');
    assert.equal(p.top, 600 - 4 - 180);
  });

  test('never leaves the screen horizontally', () => {
    assert.equal(placeMenu({ trigger: trigger(200, 0), menu, viewport, insets }).left, 8);
    const narrow = placeMenu({ trigger: trigger(200, 10), menu: { width: 500, height: 100 }, viewport, insets });
    assert.equal(narrow.left, 8);
  });

  test('a menu taller than the space on either side is clamped and scrolls', () => {
    const tall = placeMenu({ trigger: trigger(380), menu: { width: 200, height: 900 }, viewport, insets });
    assert.ok(tall.top >= insets.top + 8);
    assert.ok(tall.top + tall.maxHeight <= viewport.height - insets.bottom - 8);
    assert.ok(tall.maxHeight < 900);
  });
});
