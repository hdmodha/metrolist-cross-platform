/**
 * Test vectors of the ad blocker: URL (+ Electron resource type) → blocked or not. The TypeScript
 * tests (`adBlock.test.ts`) run them against `shouldBlockRequest`, and `npm run adblock:rules`
 * writes them for the Android plugin's JUnit test (`AdBlockRulesTest`), so both matchers are held to
 * exactly the same answers. Add a case here, not in one test only.
 */

export interface AdBlockVector {
  url: string;
  /** Electron's `details.resourceType`; on Android `mainFrame` = `request.isForMainFrame()`. */
  resourceType?: 'mainFrame' | 'subFrame' | 'xhr';
  block: boolean;
}

/** Requests the YouTube player (or the app) needs: none of them may ever be blocked. */
export const PLAYBACK_URLS: readonly string[] = [
  'https://rr3---sn-4g5edndk.googlevideo.com/videoplayback?expire=1&id=o-abc&itag=251&source=youtube&mime=audio%2Fwebm',
  'https://redirector.googlevideo.com/videoplayback?id=1',
  'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  'https://i9.ytimg.com/vi_webp/dQw4w9WgXcQ/mqdefault.webp',
  'https://yt3.ggpht.com/abc=s88',
  'https://lh3.googleusercontent.com/abc=w400-h400',
  'https://www.youtube.com/iframe_api',
  'https://www.youtube.com/s/player/1798f86c/www-widgetapi.vflset/www-widgetapi.js',
  'https://www.youtube.com/s/player/1798f86c/player_ias.vflset/en_US/base.js',
  'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1&enablejsapi=1&origin=http%3A%2F%2F127.0.0.1%3A47823',
  'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
  'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
  'https://www.youtube.com/youtubei/v1/next?prettyPrint=false',
  'https://music.youtube.com/youtubei/v1/search?prettyPrint=false',
  'https://music.youtube.com/youtubei/v1/next?prettyPrint=false',
  'https://www.youtube.com/api/stats/playback?ns=yt&el=embedded&cpn=abc&docid=dQw4w9WgXcQ',
  'https://www.youtube.com/api/stats/watchtime?ns=yt&el=embedded&cpn=abc',
  'https://s.youtube.com/api/stats/watchtime?ns=yt',
  'https://www.youtube.com/api/stats/qoe?event=streamingstats',
  'https://www.youtube.com/generate_204?abc',
  'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ',
  'https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/Create',
  'https://www.google.com/js/th/abc.js',
  'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js',
  'https://fonts.googleapis.com/css2?family=Inter',
  'https://fonts.gstatic.com/s/inter/v12/abc.woff2',
  'http://127.0.0.1:47823/api/innertube/search?q=pagead',
  'http://127.0.0.1:47823/pagead/not-youtube',
  'http://localhost:3000/assets/index.js',
  // The Android app's own files (Capacitor serves them from https://localhost)
  'https://localhost/',
  'https://localhost/assets/index.js',
  'https://localhost/pagead/not-youtube',
];

export const AD_URLS: readonly string[] = [
  'https://googleads.g.doubleclick.net/pagead/id',
  'https://static.doubleclick.net/instream/ad_status.js',
  'https://ad.doubleclick.net/ddm/trackclk/N123',
  'https://www.googleadservices.com/pagead/conversion/123/',
  'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js',
  'https://tpc.googlesyndication.com/simgad/123',
  'https://www.google-analytics.com/collect?v=1',
  'https://ssl.google-analytics.com/ga.js',
  'https://www.googletagservices.com/tag/js/gpt.js',
  'https://adservice.google.com/ddm/fls/z/src=1',
  'https://www.youtube.com/pagead/paralleladview?ai=abc',
  'https://www.youtube.com/pagead/viewthroughconversion/123/',
  'https://www.youtube.com/ptracking?pltype=adhost&ptk=youtube_host',
  'https://www.youtube.com/api/stats/ads?ver=2&ns=1',
  'https://www.youtube.com/api/stats/atr?ns=yt&el=embedded&cpn=abc',
  'https://www.youtube.com/get_midroll_info?ei=abc',
  'https://www.youtube.com/youtubei/v1/log_event?alt=json',
  'https://music.youtube.com/youtubei/v1/log_event?alt=json',
  'https://m.youtube.com/pagead/adview?ai=1',
  'https://www.youtube-nocookie.com/youtubei/v1/log_event?alt=json',
];

/** Host rules match the host and its subdomains only, never look-alikes or paths. */
const HOST_MATCHING: readonly AdBlockVector[] = [
  { url: 'https://doubleclick.net/x', block: true },
  { url: 'https://a.b.doubleclick.net/x', block: true },
  { url: 'https://doubleclick.net.example.com/x', block: false },
  { url: 'https://notdoubleclick.net/x', block: false },
  { url: 'https://example.com/doubleclick.net', block: false },
  { url: 'https://example.com/?u=https://googleads.g.doubleclick.net/pagead/id', block: false },
  { url: 'https://GOOGLEADS.G.DOUBLECLICK.NET./pagead/id', block: true },
  { url: 'https://googlevideo.com.doubleclick.net/x', block: true },
  { url: 'https://doubleclick.net.googlevideo.com/x', block: false },
  // Path rules only apply on YouTube hosts
  { url: 'https://example.com/pagead/x', block: false },
  { url: 'https://notyoutube.com/pagead/x', block: false },
  { url: 'https://www.youtube.com/watch?v=x&next=/pagead/', block: false },
  { url: 'https://www.youtube.com/pagead', block: false },
  { url: 'https://www.youtube.com/PAGEAD/x', block: false },
  { url: 'https://www.youtube.com/pagead/x?embed/', block: true },
];

/** Top-level navigations and non-http(s) URLs are left alone. */
const RESOURCE_TYPES_AND_SCHEMES: readonly AdBlockVector[] = [
  { url: 'https://googleads.g.doubleclick.net/pagead/id', resourceType: 'mainFrame', block: false },
  { url: 'https://googleads.g.doubleclick.net/pagead/id', resourceType: 'xhr', block: true },
  { url: 'https://googleads.g.doubleclick.net/pagead/id', resourceType: 'subFrame', block: true },
  { url: 'devtools://devtools/bundled/x', block: false },
  { url: 'data:text/plain,doubleclick.net', block: false },
  { url: 'blob:https://doubleclick.net/1', block: false },
  { url: 'file:///pagead/', block: false },
  { url: 'chrome-extension://x/y', block: false },
  { url: 'ws://doubleclick.net/x', block: false },
  { url: 'mailto:x@doubleclick.net', block: false },
  { url: 'javascript:alert(1)', block: false },
  { url: 'about:blank', block: false },
  { url: 'not a url', block: false },
  { url: '', block: false },
  { url: 'http://doubleclick.net/x', block: true },
];

/**
 * URL parsing: what the WHATWG parser (`new URL`) does, the Android matcher must do too (scheme
 * case, user info, ports, backslashes, dot segments, percent-encoded and full-width hosts, tabs).
 */
const URL_PARSING: readonly AdBlockVector[] = [
  { url: 'HTTPS://GoogleAds.G.DoubleClick.Net/pagead/id', block: true },
  { url: 'https://googleads.g.doubleclick.net:443/pagead/id', block: true },
  { url: 'https://user:pw@googleads.g.doubleclick.net/x', block: true },
  { url: 'https://googleads.g.doubleclick.net@example.com/x', block: false },
  { url: 'https://example.com@googleads.g.doubleclick.net/x', block: true },
  { url: 'https://www.youtube.com/embed/../pagead/adview', block: true },
  { url: 'https://www.youtube.com/pagead/../embed/abc', block: false },
  { url: 'https://www.youtube.com/%2e%2e/pagead/x', block: true },
  { url: 'https://www.youtube.com/embed/%2E%2E/pagead/x', block: true },
  { url: 'https://www.youtube.com/./pagead/x', block: true },
  { url: 'https://www.youtube.com/a/b/../../pagead/x', block: true },
  { url: 'https://www.youtube.com/youtubei/v1/log_event/../player', block: false },
  { url: 'https://www.youtube.com/youtubei/v1/player/../log_event', block: true },
  { url: 'https://www.youtube.com/..', block: false },
  { url: 'https://www.youtube.com/pagead/..', block: false },
  { url: 'https://www.youtube.com/pagead/.', block: true },
  { url: 'https://www.youtube.com//pagead/x', block: false },
  { url: 'https://www.youtube.com\\pagead\\x', block: true },
  { url: 'https:\\\\www.youtube.com\\pagead\\x', block: true },
  { url: 'https:www.youtube.com/pagead/x', block: true },
  { url: 'https:///www.youtube.com/pagead/x', block: true },
  { url: '  https://www.youtube.com/pagead/x  ', block: true },
  { url: 'https://www.you\ttube.com/pag\nead/x', block: true },
  { url: 'https://%64oubleclick.net/x', block: true },
  { url: 'https://ｄｏｕｂｌｅｃｌｉｃｋ.net/x', block: true },
  { url: 'https://ad.doubleclick.net/%2e%2e/x', block: true },
  { url: 'https://www.youtube.com?x=/pagead/', block: false },
  { url: 'https://www.youtube.com#/pagead/', block: false },
  { url: 'https://www.youtube.com/pagead%2Fx', block: false },
  { url: 'https://www.youtube.com/ pagead/x', block: false },
  { url: 'https://www.youtube.com/pagead/ x', block: true },
  { url: 'https://www.youtube.com:8443/pagead/x', block: true },
  { url: 'https://www.youtube.com.:443/ptracking', block: true },
  { url: 'https://music.youtube.com./youtubei/v1/log_event', block: true },
  { url: 'https://doubleclick.net../x', block: false },
  { url: 'https://[::1]/pagead/', block: false },
  { url: 'https://1.2.3.4/pagead/', block: false },
  // Rejected by the URL parser, so never blocked
  { url: 'https://doubleclick.net:99999/x', block: false },
  { url: 'https://doubleclick.net:abc/x', block: false },
  { url: 'https://do^ubleclick.net/x', block: false },
  { url: 'https://doubleclick.net\u0000/x', block: false },
  { url: 'https://doubleclick.net.123/x', block: false },
  { url: 'https://user@/x', block: false },
  { url: 'https:///', block: false },
  { url: 'https://', block: false },
];

/**
 * Cases that pin the iOS translation to a WebKit content-blocker list (`webkitContentBlocker.ts`):
 * a host rule beats a never-block path, path rules start at the path, look-alike hosts, case.
 */
const WEBKIT_TRANSLATION: readonly AdBlockVector[] = [
  { url: 'https://googleads.g.doubleclick.net/embed/x', block: true },
  { url: 'https://ad.doubleclick.net/youtubei/v1/player', block: true },
  { url: 'https://youtube.com/pagead/x', block: true },
  { url: 'https://www.youtube.com/embed/x/pagead/', block: false },
  { url: 'https://www.youtube.com/embed/abc?list=pagead', block: false },
  { url: 'https://www.youtube.com/iframe_api?x=/pagead/', block: false },
  { url: 'https://www.youtube.com:8443/s/player/abc/base.js', block: false },
  { url: 'https://www.youtube.com/api/stats/ads/../playback?ns=yt', block: false },
  { url: 'https://rr1---sn-abc.googlevideo.com/pagead/x', block: false },
  { url: 'https://i.ytimg.com.:443/vi/x/hqdefault.jpg', block: false },
  { url: 'https://www.youtube.com/Pagead/x', block: false },
  { url: 'https://evil-youtube.com/pagead/x', block: false },
  { url: 'https://youtube.com.example.com/pagead/x', block: false },
  { url: 'https://www.youtube-nocookie.com/embed/abc', block: false },
  { url: 'https://www.youtube-nocookie.com/api/stats/atr?ns=yt', block: true },
];

export const AD_BLOCK_VECTORS: readonly AdBlockVector[] = [
  ...AD_URLS.map((url) => ({ url, block: true })),
  ...PLAYBACK_URLS.map((url) => ({ url, block: false })),
  ...HOST_MATCHING,
  ...RESOURCE_TYPES_AND_SCHEMES,
  ...URL_PARSING,
  ...WEBKIT_TRANSLATION,
];

/** `ad-block-vectors.json` for the Android plugin's JUnit test. */
export function adBlockVectorsJson(): { description: string; vectors: AdBlockVector[] } {
  return {
    description:
      'Generated from src/shared/adBlockVectors.ts by `npm run adblock:rules`; do not edit. url (+ resourceType) -> block. The TypeScript and the Android matcher must both give these answers.',
    vectors: AD_BLOCK_VECTORS.map((v) => (v.resourceType ? { url: v.url, resourceType: v.resourceType, block: v.block } : { url: v.url, block: v.block })),
  };
}
