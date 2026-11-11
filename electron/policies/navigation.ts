/**
 * Where a URL may go from the desktop window. Pure: the main process applies the verdict.
 * - `allow`: same origin as the app (`http://127.0.0.1:<port>`), stays in the window.
 * - `external`: an `http:` / `https:` URL of another origin, opened in the default browser.
 * - `deny`: everything else (`file:`, `javascript:`, `data:`, custom schemes, URLs with credentials).
 * Iframes (the YouTube player) are not navigations of the window and are not affected.
 */
export type LinkDecision = 'allow' | 'external' | 'deny';

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function decideNavigation(targetUrl: string, appOrigin: string): LinkDecision {
  const target = parse(targetUrl);
  if (!target) return 'deny';
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return 'deny';
  if (target.username || target.password) return 'deny';
  const app = parse(appOrigin);
  if (app && (app.protocol === 'http:' || app.protocol === 'https:') && target.origin === app.origin) return 'allow';
  return 'external';
}

/** `window.open` / `target="_blank"` follow the same rule as navigations. */
export function decideWindowOpen(targetUrl: string, appOrigin: string): LinkDecision {
  return decideNavigation(targetUrl, appOrigin);
}
