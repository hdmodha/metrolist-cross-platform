import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkEmbeddable,
  fetchRadioContinuation,
  fetchRecommendations,
  peekEmbeddability,
  resetEmbeddabilityCache,
  searchTracks,
} from './apiClient';

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
  resetEmbeddabilityCache();
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

test('Inside the native shell one timed-out InnerTube request is retried instead of failing the search', async () => {
  stubFetch(async () => {
    throw new Error('fetch must not be used inside the native shell');
  });
  const timeouts: unknown[] = [];
  let calls = 0;
  g.window = {
    Capacitor: {
      isNativePlatform: () => true,
      nativePromise: async (_plugin: string, _method: string, options: Record<string, unknown>) => {
        calls++;
        timeouts.push(options.readTimeout);
        if (calls === 1) throw new Error('The request timed out.');
        return {
          status: 200,
          data: {
            contents: [
              {
                musicResponsiveListItemRenderer: {
                  playlistItemData: { videoId: 'gdZLi9oWNZg' },
                  flexColumns: [
                    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Dynamite' }] } } },
                    { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'BTS • Dynamite • 3:19' }] } } },
                  ],
                },
              },
            ],
          },
        };
      },
    },
  };
  const tracks = await searchTracks('bts dynamite native retry');
  assert.deepEqual(tracks.map((t) => t.videoId), ['gdZLi9oWNZg']);
  assert.equal(calls, 2);
  assert.ok(timeouts.every((t) => typeof t === 'number' && t > 0 && t <= 8000));
});

test('checkEmbeddable asks the backend once per video and remembers the answers', async () => {
  const urls = stubFetch(async (url) => {
    const ids = new URL(url, 'http://app.test').searchParams.get('ids')?.split(',') ?? [];
    const results: Record<string, boolean | null> = {};
    for (const id of ids) results[id] = id === 'DrLaoBKGS3g' ? false : id === 'gdZLi9oWNZg' ? null : true;
    return json({ results });
  });
  assert.equal(peekEmbeddability('DrLaoBKGS3g'), undefined);
  const first = await checkEmbeddable(['DrLaoBKGS3g', 'b1kbLwvqugk', 'gdZLi9oWNZg', 'not-an-id']);
  assert.deepEqual(first, { DrLaoBKGS3g: false, b1kbLwvqugk: true, gdZLi9oWNZg: null });
  assert.deepEqual(urls, ['/api/innertube/embeddable?ids=DrLaoBKGS3g%2Cb1kbLwvqugk%2CgdZLi9oWNZg']);
  assert.equal(peekEmbeddability('DrLaoBKGS3g'), false);
  assert.equal(peekEmbeddability('b1kbLwvqugk'), true);

  // Known answers come from memory; only the new id is asked
  const second = await checkEmbeddable(['DrLaoBKGS3g', 'b1kbLwvqugk', 'Z7MIQJluULU']);
  assert.deepEqual(second, { DrLaoBKGS3g: false, b1kbLwvqugk: true, Z7MIQJluULU: true });
  assert.deepEqual(urls.slice(1), ['/api/innertube/embeddable?ids=Z7MIQJluULU']);
});

test('checkEmbeddable never fails the caller: an unreachable backend means "unknown"', async () => {
  stubFetch(async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
  assert.deepEqual(await checkEmbeddable(['DrLaoBKGS3g']), { DrLaoBKGS3g: null });
  // A caller abort is still an abort
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(checkEmbeddable(['b1kbLwvqugk'], controller.signal));
});

test('Inside the native shell the oEmbed check goes straight to youtube.com through CapacitorHttp', async () => {
  stubFetch(async () => {
    throw new Error('fetch must not be used inside the native shell');
  });
  const requests: Array<Record<string, unknown>> = [];
  g.window = {
    Capacitor: {
      isNativePlatform: () => true,
      nativePromise: async (plugin: string, method: string, options: Record<string, unknown>) => {
        assert.equal(`${plugin}.${method}`, 'CapacitorHttp.request');
        requests.push(options);
        const url = new URL(String(options.url));
        const id = new URL(url.searchParams.get('url') ?? '').searchParams.get('v');
        if (id === 'gdZLi9oWNZg') throw new Error('timed out');
        return { status: id === 'DrLaoBKGS3g' ? 401 : 200, data: {} };
      },
    },
  };
  const results = await checkEmbeddable(['DrLaoBKGS3g', 'b1kbLwvqugk', 'gdZLi9oWNZg']);
  assert.deepEqual(results, { DrLaoBKGS3g: false, b1kbLwvqugk: true, gdZLi9oWNZg: null });
  assert.equal(requests.length, 3);
  for (const r of requests) {
    assert.equal(r.method, 'GET');
    assert.match(String(r.url), /^https:\/\/www\.youtube\.com\/oembed\?format=json&url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3D/);
  }
});
