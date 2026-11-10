import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_NOW_PLAYING, nowPlayingStep, type NowPlayingHistory } from './nowPlayingHistory';

const closed: NowPlayingHistory = INITIAL_NOW_PLAYING;
const opened: NowPlayingHistory = { open: true, entryPushed: true };

describe('Now Playing and the Back button', () => {
  test('opening pushes exactly one history entry', () => {
    assert.deepEqual(closed, { open: false, entryPushed: false });
    const step = nowPlayingStep(closed, { type: 'open' });
    assert.deepEqual(step, { state: opened, effect: 'push' });
    assert.deepEqual(nowPlayingStep(opened, { type: 'open' }), { state: opened, effect: null });
  });

  test('Back (popstate without our flag) closes it', () => {
    assert.deepEqual(nowPlayingStep(opened, { type: 'popstate', flagged: false }), { state: closed, effect: null });
  });

  test('closing with the chevron, Escape or a swipe closes at once and removes our entry', () => {
    const step = nowPlayingStep(opened, { type: 'close' });
    assert.deepEqual(step, { state: closed, effect: 'back' });
    // The popstate caused by that `history.back()` changes nothing
    assert.deepEqual(nowPlayingStep(step.state, { type: 'popstate', flagged: false }), { state: closed, effect: null });
    assert.deepEqual(nowPlayingStep(closed, { type: 'close' }), { state: closed, effect: null });
  });

  test('Forward onto our entry opens it again; Back without it open is left to the browser', () => {
    assert.deepEqual(nowPlayingStep(closed, { type: 'popstate', flagged: true }), { state: opened, effect: null });
    assert.deepEqual(nowPlayingStep(closed, { type: 'popstate', flagged: false }), { state: closed, effect: null });
  });

  test('navigating away from Now Playing replaces our entry instead of stacking on it', () => {
    assert.deepEqual(nowPlayingStep(opened, { type: 'navigate' }), { state: closed, effect: 'replace' });
    assert.deepEqual(nowPlayingStep(closed, { type: 'navigate' }), { state: closed, effect: null });
  });

  test('a reload on our entry reopens Now Playing when a song is loaded, otherwise drops the flag', () => {
    assert.deepEqual(nowPlayingStep(closed, { type: 'boot', flagged: true, canOpen: true }), { state: opened, effect: null });
    assert.deepEqual(nowPlayingStep(closed, { type: 'boot', flagged: true, canOpen: false }), { state: closed, effect: 'clearFlag' });
    assert.deepEqual(nowPlayingStep(closed, { type: 'boot', flagged: false, canOpen: true }), { state: closed, effect: null });
  });
});
