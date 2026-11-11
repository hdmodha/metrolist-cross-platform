import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';
import { createInitialPlayerState, playerReducer, type PlayerState } from './playerCore';
import {
  EMBED_PRECHECK_UPCOMING,
  alternateSearchQuery,
  KEYBOARD_SEEK_STEP_MS,
  planEmbedPrecheck,
  selectEmbedCheckTargets,
  STALL_BEFORE_WAITING_MS,
  STREAM_ERROR_API_UNAVAILABLE,
  planNetworkRetry,
  shouldWaitForNetworkAfterStall,
  isPositionSaveDue,
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
  const online = (code: number, retried = false) => ({ code, online: true, retried });

  test('an unavailable player API or an offline device waits for the network', () => {
    const state = playingLive();
    assert.deepEqual(planStreamErrorRecovery(state, { code: STREAM_ERROR_API_UNAVAILABLE, online: true, retried: false }), { kind: 'waitForNetwork' });
    assert.deepEqual(planStreamErrorRecovery(state, { code: 150, online: false, retried: false }), { kind: 'waitForNetwork' });
  });

  test('an upload its owner keeps off other apps (101 / 150) first looks for another upload of the same song', () => {
    for (const code of [101, 150]) {
      const plan = planStreamErrorRecovery(playingLive(), online(code));
      assert.deepEqual(plan, {
        kind: 'findAlternate',
        trackId: `ytm-${vid('a')}`,
        videoId: vid('a'),
        query: 'A Song a',
        tried: [vid('a')],
        reason: 'embedDisabled',
      });
    }
  });

  test('a removed / private video (100) or an invalid id (2) looks for another upload at once', () => {
    assert.equal(planStreamErrorRecovery(playingLive(), online(100))?.kind, 'findAlternate');
    assert.equal(planStreamErrorRecovery(playingLive(), online(2))?.kind, 'findAlternate');
    const plan = planStreamErrorRecovery(playingLive(), online(100));
    assert.equal(plan && 'reason' in plan ? plan.reason : null, 'unavailable');
  });

  test('a player error (5) may be transient: the same video is retried once, then another upload', () => {
    assert.deepEqual(planStreamErrorRecovery(playingLive(), online(5)), {
      kind: 'retry',
      trackId: `ytm-${vid('a')}`,
      videoId: vid('a'),
      reason: 'playerError',
    });
    assert.equal(planStreamErrorRecovery(playingLive(), online(5, true))?.kind, 'findAlternate');
  });

  test('an embedder / referrer rejection (152 / 153) is retried once, then skipped (other uploads fail alike)', () => {
    for (const code of [152, 153]) {
      assert.equal(planStreamErrorRecovery(playingLive(), online(code))?.kind, 'retry');
      assert.deepEqual(planStreamErrorRecovery(playingLive(), online(code, true)), {
        kind: 'skip',
        trackId: `ytm-${vid('a')}`,
        reason: 'embedderRejected',
      });
    }
  });

  test('once 3 uploads were tried the song is skipped', () => {
    let state = playingLive();
    const id = `ytm-${vid('a')}`;
    state = playerReducer(state, { type: 'alternateVideoFound', trackId: id, videoId: vid('a2') });
    state = playerReducer(state, { type: 'alternateVideoFound', trackId: id, videoId: vid('a3') });
    assert.deepEqual(planStreamErrorRecovery(state, online(100)), { kind: 'skip', trackId: id, reason: 'unavailable' });
    assert.deepEqual(planStreamErrorRecovery(state, online(5, true)), { kind: 'skip', trackId: id, reason: 'playerError' });
  });

  test('nothing to do without an active track', () => {
    assert.equal(planStreamErrorRecovery(createInitialPlayerState(), online(150)), null);
  });

  test('a late error of the previous video (it arrived after a switch) is ignored', () => {
    let state = playingLive();
    state = playerReducer(state, { type: 'playFromSearch', track: yt('b') });
    // The error came from song A's video, but song B is the active one now
    for (const code of [5, 100, 150, 152]) {
      assert.equal(planStreamErrorRecovery(state, { ...online(code), videoId: vid('a') }), null, `code ${code}`);
    }
    // ... also while waiting for the network: a stale error says nothing about the new video
    assert.equal(planStreamErrorRecovery(state, { code: 150, online: false, retried: false, videoId: vid('a') }), null);
    // An error of the active track's current video is handled as usual
    assert.equal(planStreamErrorRecovery(state, { ...online(150), videoId: vid('b') })?.kind, 'findAlternate');
  });

  test('after a switch to another upload, only errors of that upload count', () => {
    let state = playingLive();
    const id = `ytm-${vid('a')}`;
    state = playerReducer(state, { type: 'alternateVideoFound', trackId: id, videoId: vid('a2') });
    assert.equal(planStreamErrorRecovery(state, { ...online(150), videoId: vid('a') }), null);
    assert.equal(planStreamErrorRecovery(state, { ...online(150), videoId: vid('a2') })?.kind, 'findAlternate');
  });

  test('an error without a video id (the player API itself failed) still applies to the active track', () => {
    const state = playingLive();
    assert.deepEqual(planStreamErrorRecovery(state, { code: STREAM_ERROR_API_UNAVAILABLE, online: true, retried: false, videoId: undefined }), { kind: 'waitForNetwork' });
    assert.equal(planStreamErrorRecovery(state, online(150))?.kind, 'findAlternate');
  });
});

describe('embeddability pre-check', () => {
  const queueOf = (...names: string[]) => {
    let state = playerReducer(createInitialPlayerState(), { type: 'playFromSearch', track: yt(names[0]) });
    for (const name of names.slice(1)) state = playerReducer(state, { type: 'addToQueue', track: yt(name) });
    return state;
  };
  const ref = (name: string) => ({ trackId: `ytm-${vid(name)}`, videoId: vid(name) });

  test('checks the active song and the next 3 upcoming ones, in play order', () => {
    const state = queueOf('a', 'b', 'c', 'd', 'e', 'f');
    assert.equal(EMBED_PRECHECK_UPCOMING, 3);
    assert.deepEqual(selectEmbedCheckTargets(state), [ref('a'), ref('b'), ref('c'), ref('d')]);
    assert.deepEqual(selectEmbedCheckTargets(createInitialPlayerState()), []);
  });

  test('songs already known to be unplayable are not checked again; the current upload is what counts', () => {
    let state = queueOf('a', 'b', 'c', 'd', 'e');
    state = playerReducer(state, { type: 'trackUnplayable', trackId: `ytm-${vid('b')}`, random: 0, reason: 'embedDisabled', videoId: vid('b') });
    state = playerReducer(state, { type: 'alternateVideoFound', trackId: `ytm-${vid('c')}`, videoId: vid('c2'), expectedVideoId: vid('c') });
    assert.deepEqual(selectEmbedCheckTargets(state), [ref('a'), { trackId: `ytm-${vid('c')}`, videoId: vid('c2') }, ref('d'), ref('e')]);
  });

  test('with shuffle on, hand-queued songs (which play first) are checked first', () => {
    let state = playerReducer(createInitialPlayerState(), {
      type: 'playFromList',
      track: yt('a'),
      context: [yt('a'), yt('b'), yt('c'), yt('d'), yt('e')],
    });
    state = playerReducer(state, { type: 'toggleShuffle' });
    state = playerReducer(state, { type: 'addToQueue', track: yt('q') });
    assert.deepEqual(selectEmbedCheckTargets(state)[1], ref('q'));
  });

  test('asks only about uploads never checked and not in flight; reports the ones known to be blocked', () => {
    const targets = [ref('a'), ref('b'), ref('c'), ref('d')];
    const known: Record<string, boolean | null> = { [vid('a')]: true, [vid('b')]: false, [vid('c')]: null };
    const plan = planEmbedPrecheck(targets, (id) => (id in known ? known[id] : undefined), new Set());
    assert.deepEqual(plan, { check: [vid('d')], blocked: [ref('b')] });
    assert.deepEqual(planEmbedPrecheck(targets, (id) => (id in known ? known[id] : undefined), new Set([vid('d')])).check, []);
  });
});

test('the search for other uploads names the artist, or uses an "A - B" title as it is', () => {
  assert.equal(alternateSearchQuery({ title: 'Nightcall', artist: 'Kavinsky' }), 'Kavinsky Nightcall');
  assert.equal(alternateSearchQuery({ title: 'Kavinsky - Nightcall (Official Audio)', artist: 'Kavinsky VEVO' }), 'Kavinsky Nightcall');
  // A re-upload by someone else: the uploader's name would only spoil the search
  assert.equal(alternateSearchQuery({ title: 'The Weeknd - Blinding Lights', artist: 'David Dean Burkhart' }), 'The Weeknd - Blinding Lights');
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
