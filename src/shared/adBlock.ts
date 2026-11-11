/**
 * Ad and tracking blocklist for the requests of the YouTube player, in the spirit of Brave's
 * blocker: the ad / tracking requests are cancelled, the video itself plays normally. Pure, shared:
 * the Electron main process applies it to every request (`electron/adBlocker.ts`), and the same
 * rules are emitted as `adBlockRules.json` (`npm run adblock:rules`) for the Android app.
 *
 * Conservative by design. A rule only names endpoints that serve ads or send tracking beacons and
 * whose answer the player does not need to play: their requests are fire-and-forget pings or ad
 * payloads. `NEVER_BLOCK_*` lists what playback needs; it wins over every rule (and a test proves
 * that no rule overlaps it). Linear-time matching: `URL` parsing, `endsWith` / `startsWith`, no
 * regular expression on URLs.
 */

export interface HostRule {
  /** Blocks this host and all of its subdomains. */
  host: string;
  why: string;
}

export interface PathRule {
  /** Blocks paths starting with `pathPrefix` on these hosts (and their subdomains). */
  hosts: readonly string[];
  pathPrefix: string;
  why: string;
}

/** YouTube's own hosts, where the path rules apply. */
export const YOUTUBE_HOSTS = ['youtube.com', 'youtube-nocookie.com'] as const;

export const AD_BLOCK_HOST_RULES: readonly HostRule[] = [
  {
    host: 'doubleclick.net',
    why: 'Google ad serving: ad requests (googleads.g.doubleclick.net/pagead/id), the ad status script (static.doubleclick.net/instream/ad_status.js) and ad click / impression pings. The player only checks whether it loaded and plays without it.',
  },
  {
    host: 'googleadservices.com',
    why: 'Ad conversion tracking pixels. Never part of loading or playing a video.',
  },
  {
    host: 'googlesyndication.com',
    why: 'AdSense / ad delivery (pagead2, tpc): ad scripts and ad creatives only.',
  },
  {
    host: 'google-analytics.com',
    why: 'Analytics beacons (collect, ga.js). Fire-and-forget; no page depends on the answer.',
  },
  {
    host: 'googletagservices.com',
    why: 'Google Publisher Tag (gpt.js), the loader of display ad slots. Not used by the video player.',
  },
  {
    host: 'adservice.google.com',
    why: 'Ad personalisation and conversion service. Only called by ad code.',
  },
];

export const AD_BLOCK_PATH_RULES: readonly PathRule[] = [
  {
    hosts: YOUTUBE_HOSTS,
    pathPrefix: '/pagead/',
    why: 'Ad view / conversion pings served from youtube.com (paralleladview, viewthroughconversion, adview). Only sent around ads.',
  },
  {
    hosts: YOUTUBE_HOSTS,
    pathPrefix: '/ptracking',
    why: 'Partner / ad-host tracking pixel (pltype=adhost). A beacon; its answer is ignored.',
  },
  {
    hosts: YOUTUBE_HOSTS,
    pathPrefix: '/api/stats/ads',
    why: 'Ad playback statistics. Sent only while an ad plays; video statistics use /api/stats/playback and /watchtime, which stay allowed.',
  },
  {
    hosts: YOUTUBE_HOSTS,
    pathPrefix: '/api/stats/atr',
    why: 'Attribution / ad tracking beacon sent once a video started (listed by EasyPrivacy). Fire-and-forget; playback and watch-time reporting are separate endpoints.',
  },
  {
    hosts: YOUTUBE_HOSTS,
    pathPrefix: '/get_midroll_info',
    why: 'Fetches the mid-roll ad schedule. Without it the player simply has no mid-roll ads.',
  },
  {
    hosts: YOUTUBE_HOSTS,
    pathPrefix: '/youtubei/v1/log_event',
    why: 'Client telemetry (logging events). Batched fire-and-forget; /youtubei/v1/player and /next are different endpoints and stay allowed.',
  },
];

/**
 * Hosts playback needs: video / audio streams (googlevideo.com), thumbnails and artwork (ytimg.com,
 * ggpht.com, googleusercontent.com), player and anti-abuse scripts (gstatic.com, googleapis.com).
 */
export const NEVER_BLOCK_HOSTS: readonly string[] = [
  'googlevideo.com',
  'ytimg.com',
  'ggpht.com',
  'googleusercontent.com',
  'gstatic.com',
  'googleapis.com',
];

/**
 * YouTube paths playback needs: the IFrame API and player scripts, the embed page, the player /
 * next endpoints, and playback / watch-time statistics (YouTube may refuse to keep playing a video
 * whose playback is not reported).
 */
export const NEVER_BLOCK_PATHS: readonly string[] = [
  '/iframe_api',
  '/s/player/',
  '/embed/',
  '/youtubei/v1/player',
  '/youtubei/v1/next',
  '/api/stats/playback',
  '/api/stats/watchtime',
];

function isOnHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Whether the request for `url` should be cancelled. `resourceType` is Electron's
 * `details.resourceType`: a top-level navigation (`mainFrame`) is never blocked here (the window's
 * navigation policy handles those). Anything that is not http(s) is left alone.
 */
export function shouldBlockRequest(url: string, resourceType?: string): boolean {
  if (resourceType === 'mainFrame') return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  let host = parsed.hostname.toLowerCase();
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (NEVER_BLOCK_HOSTS.some((keep) => isOnHost(host, keep))) return false;

  if (AD_BLOCK_HOST_RULES.some((rule) => isOnHost(host, rule.host))) return true;

  const path = parsed.pathname;
  if (NEVER_BLOCK_PATHS.some((keep) => path.startsWith(keep))) return false;
  return AD_BLOCK_PATH_RULES.some(
    (rule) => rule.hosts.some((domain) => isOnHost(host, domain)) && path.startsWith(rule.pathPrefix)
  );
}

/** The rules as plain data (`adBlockRules.json`), for platforms that cannot import this module. */
export function adBlockRulesJson(): {
  version: 1;
  description: string;
  blockHosts: string[];
  blockPaths: Array<{ hosts: string[]; pathPrefix: string }>;
  neverBlockHosts: string[];
  neverBlockPaths: string[];
} {
  return {
    version: 1,
    description:
      'Generated from src/shared/adBlock.ts by `npm run adblock:rules`; do not edit. A host rule matches the host and its subdomains. Never-block entries win over every rule. Top-level navigations and non-http(s) URLs are never blocked.',
    blockHosts: AD_BLOCK_HOST_RULES.map((rule) => rule.host),
    blockPaths: AD_BLOCK_PATH_RULES.map((rule) => ({ hosts: [...rule.hosts], pathPrefix: rule.pathPrefix })),
    neverBlockHosts: [...NEVER_BLOCK_HOSTS],
    neverBlockPaths: [...NEVER_BLOCK_PATHS],
  };
}
