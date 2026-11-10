import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';
import { createInitialPlayerState, playerReducer, type PlayerState } from './playerCore';
import {
  KEYBOARD_SEEK_STEP_MS,
  STALL_BEFORE_WAITING_MS,
  STREAM_ERROR_API_UNAVAILABLE,
  planNetworkRetry,
  shouldWaitForNetworkAfterStall,
  isPositionSaveDue,
  pickAlternateUpload,
  planStreamErrorRecovery,
  shortcutForKey,
} from './effectPolicies';

const vid = (name: string) => `vid${name}`.padEnd(11, '_');
const yt = (name: string): InnerTubeParsedTrack => ({
  videoId: vid(name),
  title: `${name.toUpperCase()} - Song ${name} (Official Video)`,
  artist: name.toUpperCase(),
  album: '',
  durationMs: 200000,
  thumbnailUrl: '',
});

function playingLive(): PlayerState {
  return playerReducer(createInitialPlayerState(), { type: 'playFromSearch', track: yt('a') });
}

describe('stream error recovery', () => {
  test('an unavailable player API or an offline device waits for the network', () => {
    const state = playingLive();
    assert.deepEqual(planStreamErrorRecovery(state, { code: STREAM_ERROR_API_UNAVAILABLE, online: true }), { kind: 'waitForNetwork' });
    assert.deepEqual(planStreamErrorRecovery(state, { code: 150, online: false }), { kind: 'waitForNetwork' });
  });

  test('an unplayable upload first looks for another upload of the same song', () => {
    const plan = planStreamErrorRecovery(playingLive(), { code: 150, online: true });
    assert.deepEqual(plan, { kind: 'findAlternate', trackId: `ytm-${vid('a')}`, query: 'A Song a', tried: [vid('a')] });
  });

  test('once 3 uploads were tried the song is skipped', () => {
    let state = playingLive();
    const id = `ytm-${vid('a')}`;
    state = playerReducer(state, { type: 'alternateVideoFound', trackId: id, videoId: vid('a2') });
    state = playerReducer(state, { type: 'alternateVideoFound', trackId: id, videoId: vid('a3') });
    assert.deepEqual(planStreamErrorRecovery(state, { code: 100, online: true }), { kind: 'skip', trackId: id });
  });

  test('nothing to do without an active track', () => {
    assert.equal(planStreamErrorRecovery(createInitialPlayerState(), { code: 150, online: true }), null);
  });
});

test('the alternate upload is the first candidate that was not tried yet', () => {
  const candidates = [yt('a'), yt('b'), yt('c')];
  assert.equal(pickAlternateUpload(candidates, [vid('a')])?.videoId, vid('b'));
  assert.equal(pickAlternateUpload(candidates, [vid('a'), vid('b'), vid('c')]), null);
  assert.equal(pickAlternateUpload([], []), null);
});

test('the position is saved at most every 5 seconds', () => {
  assert.equal(isPositionSaveDue(null, 1000), true);
  assert.equal(isPositionSaveDue(1000, 5999), false);
  assert.equal(isPositionSaveDue(1000, 6000), true);
  // A clock that went backwards (device time change) saves rather than waiting forever
  assert.equal(isPositionSaveDue(10_000, 2000), true);
});

describe('keyboard shortcuts', () => {
  const key = (k: string, extra: Partial<Parameters<typeof shortcutForKey>[0]> = {}) => ({
    key: k,
    code: k === ' ' ? 'Space' : k,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    defaultPrevented: false,
    ...extra,
  });

  test('Space toggles playback, arrows seek by 5 s', () => {
    assert.equal(KEYBOARD_SEEK_STEP_MS, 5000);
    assert.equal(shortcutForKey(key(' '), false), 'togglePlay');
    assert.equal(shortcutForKey(key('Spacebar', { code: 'Space' }), false), 'togglePlay');
    assert.equal(shortcutForKey(key('ArrowRight'), false), 'seekForward');
    assert.equal(shortcutForKey(key('ArrowLeft'), false), 'seekBackward');
    assert.equal(shortcutForKey(key('k'), false), null);
  });

  test('never while typing, on a control, with modifiers or when already handled', () => {
    assert.equal(shortcutForKey(key(' '), true), null);
    assert.equal(shortcutForKey(key('ArrowRight'), true), null);
    assert.equal(shortcutForKey(key(' ', { ctrlKey: true }), false), null);
    assert.equal(shortcutForKey(key(' ', { metaKey: true }), false), null);
    assert.equal(shortcutForKey(key('ArrowLeft', { altKey: true }), false), null);
    assert.equal(shortcutForKey(key(' ', { defaultPrevented: true }), false), null);
  });
});

describe('network: only a real failure or stall means "waiting for the network"', () => {
  const stall = (over: Partial<Parameters<typeof shouldWaitForNetworkAfterStall>[0]> = {}) => ({
    isPlaying: true,
    streamStatus: 'buffering' as const,
    stalledForMs: STALL_BEFORE_WAITING_MS,
    online: false,
    ...over,
  });

  test('a stream stuck loading / buffering for 8 s while offline waits for the network', () => {
    assert.equal(STALL_BEFORE_WAITING_MS, 8000);
    assert.equal(shouldWaitForNetworkAfterStall(stall()), true);
    assert.equal(shouldWaitForNetworkAfterStall(stall({ streamStatus: 'loading' })), true);
  });

  test('a short blip, a playing stream, an online device or a paused song never does', () => {
    assert.equal(shouldWaitForNetworkAfterStall(stall({ stalledForMs: 7999 })), false);
    assert.equal(shouldWaitForNetworkAfterStall(stall({ streamStatus: 'playing' })), false, 'still playing from its buffer');
    assert.equal(shouldWaitForNetworkAfterStall(stall({ online: true })), false);
    assert.equal(shouldWaitForNetworkAfterStall(stall({ isPlaying: false })), false);
  });

  test('a retry never re-creates a stream that is playing', () => {
    assert.equal(planNetworkRetry({ waiting: false, streamStatus: 'loading', retryAttempt: 0 }), null);
    assert.equal(planNetworkRetry({ waiting: true, streamStatus: 'playing', retryAttempt: 2 }), 'restored');
    assert.equal(planNetworkRetry({ waiting: true, streamStatus: 'buffering', retryAttempt: 0 }), 'retry');
    assert.equal(planNetworkRetry({ waiting: true, streamStatus: 'loading', retryAttempt: 4 }), 'retry');
    assert.equal(planNetworkRetry({ waiting: true, streamStatus: 'paused', retryAttempt: 5 }), 'giveUp');
  });
});
