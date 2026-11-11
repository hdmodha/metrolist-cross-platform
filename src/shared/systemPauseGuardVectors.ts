/**
 * Test vectors of the "system paused us" guard (`systemPauseGuard.ts`): sequences of events, each
 * `update` with the decision the guard must take. The TypeScript reference runs them in
 * `systemPauseGuard.test.ts`; `npm run adblock:rules` writes them as JSON for the Android plugin's
 * JUnit test (`SystemPauseGuardTest`) and the iOS plugin's vector runner (CI, macOS), so the three
 * implementations give exactly the same answers. Add a case here, not in one test only.
 */
import { SYSTEM_PAUSE_WINDOW_MS, type GuardEvent } from './systemPauseGuard';

export interface GuardVectorStep {
  event: GuardEvent;
  /** Only on `update` events: what the guard decides. */
  expect?: 'resume' | 'none';
}

export interface GuardVectorCase {
  name: string;
  steps: GuardVectorStep[];
}

const W = SYSTEM_PAUSE_WINDOW_MS;
const playing = (at: number): GuardVectorStep => ({ event: { type: 'update', state: 'playing', at }, expect: 'none' });
const background = (at: number): GuardVectorStep => ({ event: { type: 'background', at } });
const foreground = (at: number): GuardVectorStep => ({ event: { type: 'foreground', at } });
const playerPause = (at: number, expect: 'resume' | 'none'): GuardVectorStep => ({
  event: { type: 'update', state: 'paused', pausedBy: 'player', at },
  expect,
});

export const SYSTEM_PAUSE_GUARD_VECTORS: readonly GuardVectorCase[] = [
  {
    name: 'the player pauses itself right after the app went to the background: resume once',
    steps: [playing(0), background(1000), playerPause(1800, 'resume')],
  },
  {
    name: 'buffering counts as wanting playback',
    steps: [{ event: { type: 'update', state: 'buffering', at: 0 }, expect: 'none' }, background(10), playerPause(900, 'resume')],
  },
  {
    name: 'exactly at the end of the window still resumes',
    steps: [playing(0), background(1000), playerPause(1000 + W, 'resume')],
  },
  {
    name: 'a pause after the window is the listener\'s business: no resume',
    steps: [playing(0), background(1000), playerPause(1001 + W, 'none')],
  },
  {
    name: 'only once per background episode: a second system pause stands',
    steps: [playing(0), background(1000), playerPause(1500, 'resume'), playing(1700), playerPause(2000, 'none')],
  },
  {
    name: 'a pause the listener asked for (in the app) is never fought',
    steps: [
      playing(0),
      background(1000),
      { event: { type: 'update', state: 'paused', pausedBy: 'user', at: 1200 }, expect: 'none' },
    ],
  },
  {
    name: 'an update without pausedBy counts as the listener\'s pause',
    steps: [playing(0), background(1000), { event: { type: 'update', state: 'paused', at: 1200 }, expect: 'none' }],
  },
  {
    name: 'a pause from the notification / lock screen / headset disarms the guard',
    steps: [playing(0), background(1000), { event: { type: 'userCommand', action: 'pause', at: 1100 } }, playerPause(1300, 'none')],
  },
  {
    name: 'other commands (next, seek) leave it armed',
    steps: [
      playing(0),
      background(1000),
      { event: { type: 'userCommand', action: 'next', at: 1100 } },
      { event: { type: 'userCommand', action: 'seekTo', at: 1150 } },
      playerPause(1300, 'resume'),
    ],
  },
  {
    name: 'already paused when the app went to the background: nothing to protect',
    steps: [
      playing(0),
      { event: { type: 'update', state: 'paused', pausedBy: 'user', at: 500 }, expect: 'none' },
      background(1000),
      playerPause(1200, 'none'),
    ],
  },
  {
    name: 'nothing reported yet when the app went to the background: no resume',
    steps: [background(1000), playerPause(1200, 'none')],
  },
  {
    name: 'a player pause while the app is in the foreground is not the system\'s',
    steps: [playing(0), playerPause(500, 'none')],
  },
  {
    name: 'back in the foreground: the episode ends, a later pause is not resumed',
    steps: [playing(0), background(1000), foreground(1200), playerPause(1400, 'none')],
  },
  {
    name: 'a new background episode may resume once again',
    steps: [
      playing(0),
      background(1000),
      playerPause(1500, 'resume'),
      playing(1600),
      foreground(5000),
      background(9000),
      playerPause(9500, 'resume'),
    ],
  },
  {
    name: 'a repeated background signal keeps the first time (onStop after the window was hidden)',
    steps: [playing(0), background(1000), background(1000 + W), playerPause(1001 + W, 'none')],
  },
  {
    name: 'a pause that is not resumed ends the episode even if playback restarts',
    steps: [
      playing(0),
      background(1000),
      { event: { type: 'update', state: 'paused', pausedBy: 'user', at: 1100 }, expect: 'none' },
      playing(1200),
      playerPause(1300, 'none'),
    ],
  },
  {
    name: 'a clock going backwards never resumes',
    steps: [playing(0), background(1000), playerPause(999, 'none')],
  },
];

/** The vectors as plain data for the native tests (`npm run adblock:rules`). */
export function systemPauseGuardVectorsJson(): { description: string; windowMs: number; cases: GuardVectorCase[] } {
  return {
    description:
      'Generated from src/shared/systemPauseGuardVectors.ts by `npm run adblock:rules`; do not edit. Events in order; every `update` step carries the decision (`resume` / `none`) the guard must take. Java (SystemPauseGuardTest) and Swift (CI vector runner) run them like the TypeScript reference.',
    windowMs: SYSTEM_PAUSE_WINDOW_MS,
    cases: SYSTEM_PAUSE_GUARD_VECTORS.map((c) => ({ name: c.name, steps: c.steps.map((s) => ({ ...s, event: { ...s.event } })) })),
  };
}
