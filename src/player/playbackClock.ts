/**
 * The playback position lives here, outside React state: it changes four times a second while music
 * plays, and keeping it in state re-rendered the whole app on every tick. Only the components that
 * show the position (the seek bar) subscribe to it, through `useSyncExternalStore`.
 */
export interface PlaybackClock {
  getPositionMs: () => number;
  setPositionMs: (ms: number) => void;
  subscribe: (listener: () => void) => () => void;
}

function normalize(ms: number): number {
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.round(ms));
}

export function createPlaybackClock(initialMs = 0): PlaybackClock {
  let position = Number.isFinite(initialMs) ? normalize(initialMs) : 0;
  const listeners = new Set<() => void>();
  return {
    getPositionMs: () => position,
    setPositionMs: (ms) => {
      if (ms === Number.POSITIVE_INFINITY || ms === Number.NEGATIVE_INFINITY) return;
      const next = normalize(ms);
      if (next === position) return;
      position = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
