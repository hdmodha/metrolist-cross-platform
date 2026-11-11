/**
 * The ad / tracking blocklist of `adBlock.ts` as a WebKit content-blocker rule list, for the iOS
 * app (`WKContentRuleListStore` compiles it; `npm run adblock:rules` writes it to the iOS plugin's
 * resources). WebKit matches a rule's `url-filter` (a restricted regular expression, compiled to an
 * automaton by WebKit, so matching is linear) against the canonical URL of every load; later
 * `ignore-previous-rules` entries cancel earlier `block` entries.
 *
 * The translation:
 * - host rules: `^https?://([a-z0-9_.-]*\.)?<host>\.?(:[0-9]+)?/` (the host and its subdomains, an
 *   optional trailing dot and port; user info is not matched: see the differences below);
 * - path rules: the same per YouTube host, followed by the path prefix (one rule per host: WebKit
 *   has no `|`);
 * - never-block paths: `ignore-previous-rules` for the hosts the path rules apply to, so a host rule
 *   (doubleclick.net/embed/…) still wins, exactly like `shouldBlockRequest`;
 * - never-block hosts: `ignore-previous-rules` on any path, placed LAST.
 * Filters are case-sensitive: WebKit lower-cases the scheme and host when it canonicalizes a URL, and
 * the TypeScript matcher compares paths case-sensitively.
 *
 * Known differences from `shouldBlockRequest` (each one is pinned by `WEBKIT_KNOWN_DIFFERENCES` and
 * the test; none of them touches what playback needs):
 * 1. Top-level navigations: a content blocker cannot tell the main frame apart on iOS 13–16, so an
 *    ad URL loaded as the top-level document is blocked on iOS (the TypeScript / Android / desktop
 *    matchers let navigations through). The app's main frame is its own `capacitor://` origin and
 *    Capacitor opens other origins outside the app, so this does not arise in practice.
 * 2. URLs with user info (`https://user@doubleclick.net/…`): not blocked on iOS. Matching user info
 *    would also match a user name that looks like an ad host in front of an unrelated host.
 */
import { AD_BLOCK_HOST_RULES, AD_BLOCK_PATH_RULES, NEVER_BLOCK_HOSTS, NEVER_BLOCK_PATHS } from './adBlock';

export interface WebKitContentRule {
  trigger: { 'url-filter': string; 'url-filter-is-case-sensitive': true };
  action: { type: 'block' | 'ignore-previous-rules' };
}

/** Escapes everything WebKit's URL-filter syntax could read as an operator. */
export function escapeWebKitRegex(text: string): string {
  let out = '';
  for (const ch of text) {
    out += '\\^$.*+?()[]{}|/'.includes(ch) ? `\\${ch}` : ch;
  }
  return out;
}

/** `^https?://` + the host and its subdomains + optional trailing dot and port, up to the path's `/`. */
export function hostUrlFilter(host: string): string {
  return `^https?://([a-z0-9_.-]*\\.)?${escapeWebKitRegex(host.toLowerCase())}\\.?(:[0-9]+)?/`;
}

function rule(urlFilter: string, type: WebKitContentRule['action']['type']): WebKitContentRule {
  return { trigger: { 'url-filter': urlFilter, 'url-filter-is-case-sensitive': true }, action: { type } };
}

function pathFilter(host: string, pathPrefix: string): string {
  // hostUrlFilter ends with the path's leading '/'
  return hostUrlFilter(host) + escapeWebKitRegex(pathPrefix.startsWith('/') ? pathPrefix.slice(1) : pathPrefix);
}

export function webkitContentBlockerRules(): WebKitContentRule[] {
  const rules: WebKitContentRule[] = [];
  for (const hostRule of AD_BLOCK_HOST_RULES) rules.push(rule(hostUrlFilter(hostRule.host), 'block'));
  for (const pathRule of AD_BLOCK_PATH_RULES) {
    for (const host of pathRule.hosts) rules.push(rule(pathFilter(host, pathRule.pathPrefix), 'block'));
  }
  const pathRuleHosts = [...new Set(AD_BLOCK_PATH_RULES.flatMap((r) => r.hosts))];
  for (const keep of NEVER_BLOCK_PATHS) {
    for (const host of pathRuleHosts) rules.push(rule(pathFilter(host, keep), 'ignore-previous-rules'));
  }
  for (const keep of NEVER_BLOCK_HOSTS) rules.push(rule(hostUrlFilter(keep), 'ignore-previous-rules'));
  return rules;
}

/**
 * What WebKit does with `url` under `rules` (for tests): the URL is canonicalized like WebKit does
 * (the WHATWG URL parser; a URL it rejects is never loaded), every rule whose filter matches is
 * applied in order, and the last decision stands.
 */
export function simulateWebKitContentBlocker(rules: readonly WebKitContentRule[], url: string): boolean {
  let href: string;
  try {
    href = new URL(url).href;
  } catch {
    return false;
  }
  let blocked = false;
  for (const r of rules) {
    const matcher = new RegExp(r.trigger['url-filter'], r.trigger['url-filter-is-case-sensitive'] ? '' : 'i');
    if (!matcher.test(href)) continue;
    blocked = r.action.type === 'block';
  }
  return blocked;
}

/**
 * Shared vectors whose iOS answer differs from `shouldBlockRequest`, with the reason (see the
 * module comment). The test fails if the list is not exactly the set of differing vectors.
 */
export const WEBKIT_KNOWN_DIFFERENCES: ReadonlyArray<{ url: string; resourceType?: string; why: string }> = [
  {
    url: 'https://googleads.g.doubleclick.net/pagead/id',
    resourceType: 'mainFrame',
    why: 'Blocked on iOS: a content blocker cannot exempt top-level navigations before iOS 17. The app never navigates its main frame to an ad host.',
  },
  {
    url: 'https://user:pw@googleads.g.doubleclick.net/x',
    why: 'Not blocked on iOS: user info is not matched (no YouTube ad request carries any).',
  },
  {
    url: 'https://example.com@googleads.g.doubleclick.net/x',
    why: 'Not blocked on iOS: user info is not matched (no YouTube ad request carries any).',
  },
];
