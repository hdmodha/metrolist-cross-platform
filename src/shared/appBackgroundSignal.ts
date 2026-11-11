/**
 * The desktop app tells its page when the window is minimised or hidden (macOS: closing hides it),
 * so the page saves the player then, like it does on `visibilitychange` → hidden in a browser and on
 * the native plugins' `lifecycle` events: with `backgroundThrottling: false` the page stays
 * "visible" and gets no visibilitychange. The main process runs `appBackgroundScript()` in the page
 * (`webContents.executeJavaScript`, no preload needed); `usePlayer` listens for the event.
 */
export const APP_BACKGROUND_EVENT = 'metrolist:app-background';

/** Window events of the desktop app that dispatch it. */
export const APP_BACKGROUND_WINDOW_EVENTS = ['minimize', 'hide'] as const;

/** The script the main process runs in the page: a constant, never built from input. */
export function appBackgroundScript(): string {
  return `window.dispatchEvent(new Event(${JSON.stringify(APP_BACKGROUND_EVENT)}));`;
}
