import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRadioContinuation, fetchRecommendations, searchTracks } from './apiClient';

type FetchStub = (url: string, init?: RequestInit) => Promise<Response>;
type GlobalWithWindow = { window?: unknown; fetch: typeof fetch };

const realFetch = globalThis.fetch;
const g = globalThis as unknown as GlobalWithWindow;

function stubFetch(handler: FetchStub): string[] {
  const urls: string[] = [];
  g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return urls;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const track = (videoId: string) => ({
  videoId,
  title: `Song ${videoId}`,
  artist: 'Artist',
  album: 'Album',
  durationMs: 200000,
  thumbnailUrl: '',
});

afterEach(() => {
  g.fetch = realFetch;
  delete g.window;
});

test('searchTracks caches answers by trimmed, lower-cased query', async () => {
  const urls = stubFetch(async () => json({ tracks: [track('aaaaaaaaaa1')] }));
  const first = await searchTracks('  Daft PUNK ');
  const second = await searchTracks('daft punk');
  assert.deepEqual(second, first);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].startsWith('/api/innertube/search?q='));
});

test('searchTracks never caches empty or failed answers', async () => {
  let calls = 0;
  stubFetch(async () => {
    calls++;
    return json({ tracks: [] });
  });
  assert.deepEqual(await searchTracks('nothing here'), []);
  assert.deepEqual(await searchTracks('nothing here'), []);
  assert.equal(calls, 2);

  stubFetch(async () => json({ error: 'upstream down' }, 502));
  await assert.rejects(searchTracks('flaky query'), /upstream down/);
  const urls = stubFetch(async () => json({ tracks: [track('bbbbbbbbbb1')] }));
  assert.equal((await searchTracks('flaky query')).length, 1);
  assert.equal(urls.length, 1);
});

test('fetchRecommendations resolves tracks, the radio continuation and the seed (backend)', async () => {
  const urls = stubFetch(async () =>
    json({ seedVideoId: 'seedVideo01', tracks: [track('aaaaaaaaaa1')], continuation: 'TOKEN%3D' })
  );
  const page = await fetchRecommendations({ videoId: 'seedVideo01', title: 'T', artist: 'A' });
  assert.deepEqual(page.tracks.map((t) => t.videoId), ['aaaaaaaaaa1']);
  assert.equal(page.continuation, 'TOKEN%3D');
  assert.equal(page.seedVideoId, 'seedVideo01');
  assert.ok(urls[0].includes('videoId=seedVideo01'));

  // Older backends without `continuation` / invalid tokens degrade to an exhausted radio
  stubFetch(async () => json({ tracks: [track('aaaaaaaaaa1')], continuation: 'bad token' }));
  const legacy = await fetchRecommendations({ videoId: 'seedVideo01', title: 'T', artist: 'A' });
  assert.equal(legacy.continuation, null);
  assert.equal(legacy.seedVideoId, 'seedVideo01');
});

test('fetchRadioContinuation asks the backend for the next page of the same radio', async () => {
  const urls = stubFetch(async () =>
    json({ seedVideoId: 'seedVideo01', tracks: [track('bbbbbbbbbb1')], continuation: null })
  );
  const page = await fetchRadioContinuation({ seedVideoId: 'seedVideo01', continuation: 'TOKEN%3D' });
  assert.deepEqual(page.tracks.map((t) => t.videoId), ['bbbbbbbbbb1']);
  assert.equal(page.continuation, null);
  assert.ok(urls[0].includes('videoId=seedVideo01'));
  assert.ok(urls[0].includes(`continuation=${encodeURIComponent('TOKEN%3D')}`));
});

test('Inside the native shell radio pages go straight to YouTube Music through CapacitorHttp', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  stubFetch(async () => {
    throw new Error('fetch must not be used inside the native shell');
  });
  const panel = (ids: string[]) =>
    ids.map((videoId) => ({
      playlistPanelVideoRenderer: {
        videoId,
        title: { runs: [{ text: videoId }] },
        lengthText: { runs: [{ text: '3:00' }] },
      },
    }));
  g.window = {
    Capacitor: {
      isNativePlatform: () => true,
      nativePromise: async (plugin: string, method: string, options: Record<string, unknown>) => {
        assert.equal(plugin, 'CapacitorHttp');
        assert.equal(method, 'request');
        assert.equal(options.url, 'https://music.youtube.com/youtubei/v1/next?prettyPrint=false');
        const body = options.data as Record<string, unknown>;
        bodies.push(body);
        if (body.continuation) {
          return {
            status: 200,
            data: { continuationContents: { playlistPanelContinuation: { contents: panel(['bbbbbbbbbb1']) } } },
          };
        }
        return {
          status: 200,
          data: {
            playlistPanelRenderer: {
              contents: panel(['seedVideo01', 'aaaaaaaaaa1']),
              continuations: [{ nextRadioContinuationData: { continuation: 'TOKEN%3D' } }],
            },
          },
        };
      },
    },
  };

  const first = await fetchRecommendations({ videoId: 'seedVideo01', title: 'T', artist: 'A' });
  assert.deepEqual(first.tracks.map((t) => t.videoId), ['aaaaaaaaaa1']);
  assert.equal(first.continuation, 'TOKEN%3D');
  assert.equal(first.seedVideoId, 'seedVideo01');

  const next = await fetchRadioContinuation({ seedVideoId: 'seedVideo01', continuation: first.continuation! });
  assert.deepEqual(next.tracks.map((t) => t.videoId), ['bbbbbbbbbb1']);
  assert.equal(next.continuation, null);
  assert.equal(bodies[1].continuation, 'TOKEN=');
  assert.equal(bodies[1].playlistId, 'RDAMVMseedVideo01');
});
