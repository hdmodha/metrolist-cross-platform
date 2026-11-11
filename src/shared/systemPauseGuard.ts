/**
 * The "system paused us" guard of the native background-playback plugins (Android
 * `SystemPauseGuard.java`, iOS `SystemPauseGuard.swift`); this module is the reference both are
 * held to through the shared vectors (`systemPauseGuardVectors.ts`).
 *
 * When the app goes to the background, the OS / the web engine may pause the YouTube player
 * (Android's WebView hides the page and Chromium pauses video players in hidden frames; WebKit may
 * pause video when an iOS app leaves the foreground). The page then reports `paused`, with
 * `pausedBy: 'player'` because the player paused itself, not the listener. If that report comes
 * within `SYSTEM_PAUSE_WINDOW_MS` of going to the background while music was wanted, the plugin
 * sends `play` back to the page — once per background episode, so it never loops.
 *
 * It never fights the listener: a pause from the app (`pausedBy` `user` or missing), from the
 * notification / lock screen / headset (`userCommand` `pause`), a pause that came while the app was
 * in the foreground, or after the window, all stand. Pure; time comes in with the events.
 */

/** From going to the background to the page's `paused` (the page settles an external pause for 700 ms). */
export const SYSTEM_PAUSE_WINDOW_MS = 2500;

export type GuardPlaybackState = 'playing' | 'buffering' | 'paused';
export type PausedBy = 'user' | 'player';

export type GuardEvent =
  | { type: 'update'; state: GuardPlaybackState; pausedBy?: PausedBy; at: number }
  | { type: 'background'; at: number }
  | { type: 'foreground'; at: number }
  | { type: 'userCommand'; action: string; at: number };

export interface GuardState {
  /** What the page last reported (or the guard's own resume): the listener wants music. */
  wantsPlayback: boolean;
  /** When the app went to the background; `null` while it is in the foreground. */
  backgroundAt: number | null;
  /** Music was wanted when the app went to the background, and nothing ended the episode since. */
  armed: boolean;
  /** The one resume of this background episode was spent. */
  used: boolean;
}

export function initialGuardState(): GuardState {
  return { wantsPlayback: false, backgroundAt: null, armed: false, used: false };
}

export function reduceGuard(state: GuardState, event: GuardEvent): { state: GuardState; decision: 'resume' | 'none' } {
  switch (event.type) {
    case 'background':
      if (state.backgroundAt !== null) return { state, decision: 'none' };
      return { state: { ...state, backgroundAt: event.at, armed: state.wantsPlayback, used: false }, decision: 'none' };
    case 'foreground':
      return { state: { ...state, backgroundAt: null, armed: false, used: false }, decision: 'none' };
    case 'userCommand':
      // The listener paused from the notification / lock screen / headset: that pause stands
      return { state: event.action === 'pause' ? { ...state, armed: false } : state, decision: 'none' };
    case 'update': {
      if (event.state !== 'paused') return { state: { ...state, wantsPlayback: true }, decision: 'none' };
      const resume =
        state.backgroundAt !== null &&
        state.armed &&
        !state.used &&
        event.pausedBy === 'player' &&
        event.at >= state.backgroundAt &&
        event.at - state.backgroundAt <= SYSTEM_PAUSE_WINDOW_MS;
      if (resume) return { state: { ...state, wantsPlayback: true, used: true }, decision: 'resume' };
      // Any pause that stands ends the episode
      return { state: { ...state, wantsPlayback: false, armed: false }, decision: 'none' };
    }
  }
}

/** The guard as an object with the methods of the Java / Swift classes (`onUpdate` → resume?). */
export function createSystemPauseGuard() {
  let state = initialGuardState();
  const apply = (event: GuardEvent) => {
    const result = reduceGuard(state, event);
    state = result.state;
    return result.decision === 'resume';
  };
  return {
    onBackground: (at: number) => void apply({ type: 'background', at }),
    onForeground: () => void apply({ type: 'foreground', at: 0 }),
    onUserCommand: (action: string) => void apply({ type: 'userCommand', action, at: 0 }),
    onUpdate: (playbackState: GuardPlaybackState, pausedBy: PausedBy | undefined, at: number) =>
      apply({ type: 'update', state: playbackState, pausedBy, at }),
  };
}
