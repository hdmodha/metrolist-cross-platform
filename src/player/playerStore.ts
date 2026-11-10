/**
 * Holds the player state outside React and runs `playerReducer` on dispatch. React reads it with
 * `useSyncExternalStore`; long-lived callbacks (YouTube player events, OS media keys, timers) read
 * `getState()` synchronously instead of a possibly stale render. Actions that change nothing never
 * notify, so they never cause a render.
 */
import { playerReducer, type PlayerAction, type PlayerState } from './playerCore';

export interface PlayerStore {
  getState: () => PlayerState;
  /** Returns `true` when the action changed the state. */
  dispatch: (action: PlayerAction) => boolean;
  subscribe: (listener: () => void) => () => void;
}

export function createPlayerStore(initial: PlayerState): PlayerStore {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch: (action) => {
      const next = playerReducer(state, action);
      if (next === state) return false;
      state = next;
      for (const listener of [...listeners]) listener();
      return true;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
