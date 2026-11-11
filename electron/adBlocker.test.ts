import test from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from 'electron';
import { installAdBlocker } from './adBlocker';

type Listener = (details: { url: string; resourceType: string }, callback: (response: { cancel: boolean }) => void) => void;

function fakeSession() {
  const registered: { filter?: { urls: string[] }; listener?: Listener } = {};
  const session = {
    webRequest: {
      onBeforeRequest: (filter: { urls: string[] }, listener: Listener) => {
        registered.filter = filter;
        registered.listener = listener;
      },
    },
  } as unknown as Session;
  const request = (url: string, resourceType = 'xhr') =>
    new Promise<boolean>((resolve) => registered.listener!({ url, resourceType }, (response) => resolve(response.cancel)));
  return { session, registered, request };
}

test('cancels ad / tracking requests of every frame, lets the rest through, and counts what it blocked', async () => {
  const { session, registered, request } = fakeSession();
  const lines: string[] = [];
  const blocker = installAdBlocker(session, (line) => lines.push(line));
  assert.deepEqual(registered.filter, { urls: ['http://*/*', 'https://*/*'] });

  assert.equal(await request('https://googleads.g.doubleclick.net/pagead/id', 'subFrame'), true);
  assert.equal(await request('https://www.youtube.com/api/stats/ads?ver=2'), true);
  assert.equal(await request('https://www.youtube.com/api/stats/playback?ns=yt'), false);
  assert.equal(await request('https://rr1---sn-x.googlevideo.com/videoplayback?id=1', 'media'), false);
  assert.equal(await request('http://127.0.0.1:47823/', 'mainFrame'), false);
  assert.equal(blocker.blockedCount(), 2);
  assert.deepEqual(lines, ['[metrolist] ad blocker: 1 ad / tracking request(s) blocked so far (latest: googleads.g.doubleclick.net)']);

  for (let i = 0; i < 48; i++) await request('https://www.google-analytics.com/collect');
  assert.equal(blocker.blockedCount(), 50);
  assert.equal(lines.length, 2, 'then one line every 50 blocked requests');
});
