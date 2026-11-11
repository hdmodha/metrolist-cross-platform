import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AD_BLOCK_HOST_RULES,
  AD_BLOCK_PATH_RULES,
  NEVER_BLOCK_HOSTS,
  NEVER_BLOCK_PATHS,
  adBlockRulesJson,
  shouldBlockRequest,
} from './adBlock';

/** Requests the YouTube player (or the app) needs: none of them may ever be blocked. */
const PLAYBACK_URLS = [
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
];

const AD_URLS = [
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

test('ad and tracking requests are blocked', () => {
  for (const url of AD_URLS) assert.equal(shouldBlockRequest(url), true, url);
});

test('nothing playback needs is ever blocked', () => {
  for (const url of PLAYBACK_URLS) assert.equal(shouldBlockRequest(url), false, url);
});

test('host rules match the host and its subdomains only, never look-alikes or paths', () => {
  assert.equal(shouldBlockRequest('https://doubleclick.net/x'), true);
  assert.equal(shouldBlockRequest('https://a.b.doubleclick.net/x'), true);
  assert.equal(shouldBlockRequest('https://doubleclick.net.example.com/x'), false);
  assert.equal(shouldBlockRequest('https://notdoubleclick.net/x'), false);
  assert.equal(shouldBlockRequest('https://example.com/doubleclick.net'), false);
  assert.equal(shouldBlockRequest('https://example.com/?u=https://googleads.g.doubleclick.net/pagead/id'), false);
  assert.equal(shouldBlockRequest('https://GOOGLEADS.G.DOUBLECLICK.NET./pagead/id'), true, 'case and a trailing dot do not matter');
  // Path rules only apply on YouTube hosts
  assert.equal(shouldBlockRequest('https://example.com/pagead/x'), false);
  assert.equal(shouldBlockRequest('https://notyoutube.com/pagead/x'), false);
  assert.equal(shouldBlockRequest('https://www.youtube.com/watch?v=x&next=/pagead/'), false);
});

test('top-level navigations and non-http(s) URLs are left alone', () => {
  assert.equal(shouldBlockRequest('https://googleads.g.doubleclick.net/pagead/id', 'mainFrame'), false);
  assert.equal(shouldBlockRequest('https://googleads.g.doubleclick.net/pagead/id', 'xhr'), true);
  assert.equal(shouldBlockRequest('https://googleads.g.doubleclick.net/pagead/id', 'subFrame'), true);
  for (const url of ['devtools://devtools/bundled/x', 'data:text/plain,doubleclick.net', 'blob:https://doubleclick.net/1', 'file:///pagead/', 'chrome-extension://x/y', 'not a url', '']) {
    assert.equal(shouldBlockRequest(url), false, url);
  }
});

test('no blocking rule overlaps what playback needs', () => {
  for (const rule of AD_BLOCK_HOST_RULES) {
    for (const keep of NEVER_BLOCK_HOSTS) {
      assert.ok(!(keep === rule.host || keep.endsWith(`.${rule.host}`) || rule.host.endsWith(`.${keep}`)), `${rule.host} vs ${keep}`);
    }
  }
  for (const rule of AD_BLOCK_PATH_RULES) {
    for (const keep of NEVER_BLOCK_PATHS) {
      assert.ok(!keep.startsWith(rule.pathPrefix) && !rule.pathPrefix.startsWith(keep), `${rule.pathPrefix} vs ${keep}`);
    }
  }
  for (const rule of [...AD_BLOCK_HOST_RULES, ...AD_BLOCK_PATH_RULES]) assert.ok(rule.why.length > 20, 'every rule says why it is safe');
});

test('matching is linear: hostile URLs are fast', () => {
  const longHost = `${'a.'.repeat(100)}doubleclick.net`;
  const longPath = `https://www.youtube.com/${'p/'.repeat(20000)}`;
  const started = Date.now();
  for (let i = 0; i < 200; i++) {
    shouldBlockRequest(`https://${longHost}/x`);
    shouldBlockRequest(longPath);
  }
  assert.ok(Date.now() - started < 500);
});

test('the generated JSON for the Android app is in sync with the rules (npm run adblock:rules)', () => {
  const file = path.join(path.dirname(new URL(import.meta.url).pathname), 'adBlockRules.json');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  assert.deepEqual(onDisk, adBlockRulesJson(), 'src/shared/adBlockRules.json is stale: run `npm run adblock:rules`');
});
