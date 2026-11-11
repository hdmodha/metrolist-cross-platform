/**
 * Hardening applied to every web contents the app creates:
 * - same-origin navigation only; other http(s) URLs open in the default browser; the rest is denied
 *   (`window.open` / `target="_blank"` included). Iframes such as the YouTube player are not
 *   navigations of the window and keep working;
 * - no `<webview>`;
 * - web permissions the app does not need (camera, microphone, geolocation, notifications, …) and
 *   device access (HID, USB, serial) are denied.
 */
import { app, shell, type BrowserWindowConstructorOptions, type Session, type WebContents } from 'electron';
import { decideNavigation, decideWindowOpen } from './policies/navigation';
import { isPermissionAllowed } from './policies/permissions';

export const BACKGROUND_COLOR = '#09090B';

/** The renderer settings of every Metrolist window. */
export function secureWebPreferences(): NonNullable<BrowserWindowConstructorOptions['webPreferences']> {
  return {
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    spellcheck: false,
    // Keep playback timers (position, "track ended", radio prefetch) running while hidden or minimised
    backgroundThrottling: false,
    devTools: !app.isPackaged,
  };
}

function openExternally(url: string): void {
  shell.openExternal(url).catch((err: unknown) => console.warn('[metrolist] could not open link:', err));
}

/** `appOrigin` is read when a navigation happens (it is known once the server listens). */
export function applyNavigationPolicy(contents: WebContents, getAppOrigin: () => string): void {
  contents.on('will-navigate', (event) => {
    const decision = decideNavigation(event.url, getAppOrigin());
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'external') openExternally(event.url);
  });
  contents.on('will-redirect', (event) => {
    if (!event.isMainFrame) return;
    if (decideNavigation(event.url, getAppOrigin()) !== 'allow') event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const decision = decideWindowOpen(url, getAppOrigin());
    if (decision === 'allow') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { backgroundColor: BACKGROUND_COLOR, webPreferences: secureWebPreferences() },
      };
    }
    if (decision === 'external') openExternally(url);
    return { action: 'deny' };
  });
}

export function applyPermissionPolicy(ses: Session): void {
  ses.setPermissionRequestHandler((_contents, permission, callback) => callback(isPermissionAllowed(permission)));
  ses.setPermissionCheckHandler((_contents, permission) => isPermissionAllowed(permission));
  ses.setDevicePermissionHandler(() => false);
}
