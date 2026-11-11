/**
 * Whether the app is in the background (nothing shows the playback position): a tiny external store
 * outside React state, fed by every platform (page visibility, the native plugins' `lifecycle`
 * events, the desktop window's minimise / hide), read by the stream bridge to poll as slowly as
 * the situation allows.
 */
export const POSITION_POLL_FOREGROUND_MS = 250;
export const POSITION_POLL_BACKGROUND_MS = 1000;

export function positionPollIntervalMs(isBackground: boolean): number {
  return isBackground ? POSITION_POLL_BACKGROUND_MS : POSITION_POLL_FOREGROUND_MS;
}

export interface AppActivity {
  getSnapshot: () => { isBackground: boolean };
  setBackground: (isBackground: boolean) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createAppActivity(): AppActivity {
  let snapshot = { isBackground: false };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    setBackground(isBackground) {
      if (snapshot.isBackground === isBackground) return;
      snapshot = { isBackground };
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app-wide instance. */
export const appActivity = createAppActivity();
