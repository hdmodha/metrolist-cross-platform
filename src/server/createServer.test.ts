/**
 * The server factory, started for real on an ephemeral port. No upstream (YouTube Music) call is made:
 * the InnerTube transport is replaced by a stub wherever a route would reach it.
 */
import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { InnerTubeHttpError, type InnerTubeTransport } from '../utils/metrolistCore';
import { startMetrolistServer, type MetrolistServerOptions, type RunningMetrolistServer } from './createServer';

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(
  port: number,
  urlPath: string,
  options: { method?: string; host?: string; headers?: Record<string, string> } = {}
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: urlPath,
        method: options.method ?? 'GET',
        headers: { Host: options.host ?? `127.0.0.1:${port}`, ...options.headers },
        agent: false,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** Like `request`, but the body stays raw bytes (compressed answers). */
function rawRequest(port: number, urlPath: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, headers: { Host: `127.0.0.1:${port}`, ...headers }, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const APP_JS = `console.log("app");\n`.repeat(400);

const INDEX_HTML = '<!doctype html><title>Metrolist test shell</title><main></main>';
const MANIFEST = '{"name":"Metrolist"}';

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function makeDist(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrolist-dist-'));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, 'index.html'), INDEX_HTML);
  fs.writeFileSync(path.join(dir, 'manifest.webmanifest'), MANIFEST);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), APP_JS);
  return dir;
}

const noUpstream: InnerTubeTransport = async () => {
  throw new Error('No upstream call is allowed in this test');
};

async function start(overrides: Partial<MetrolistServerOptions> & Pick<MetrolistServerOptions, 'mode'>) {
  return startMetrolistServer({
    port: 0,
    distPath: makeDist(),
    innerTubeTransport: noUpstream,
    ...(overrides.mode === 'web' ? { host: '127.0.0.1' } : {}),
    ...overrides,
  });
}

describe('desktop mode: saved data of the old origin', () => {
  test('is handed out once, to the localhost page only, never cached; web mode has no such route', async () => {
    let pending: Record<string, string> | null = { 'metrolist.player.v2': '{"v":2}' };
    const take = () => {
      const out = pending;
      pending = null;
      return out;
    };
    const desktop = await start({ mode: 'desktop', takeLegacyStorage: take });
    try {
      const wrongHost = await request(desktop.port, '/api/desktop/legacy-storage');
      assert.equal(wrongHost.status, 404);
      const first = await request(desktop.port, '/api/desktop/legacy-storage', { host: `localhost:${desktop.port}` });
      assert.equal(first.status, 200);
      assert.equal(first.headers['cache-control'], 'no-store');
      assert.deepEqual(JSON.parse(first.body), { entries: { 'metrolist.player.v2': '{"v":2}' } });
      const second = await request(desktop.port, '/api/desktop/legacy-storage', { host: `localhost:${desktop.port}` });
      assert.deepEqual(JSON.parse(second.body), { entries: {} });
    } finally {
      await desktop.close();
    }
    const web = await start({ mode: 'web', takeLegacyStorage: () => ({ 'metrolist.a': 'b' }) });
    try {
      const reply = await request(web.port, '/api/desktop/legacy-storage', { host: `localhost:${web.port}` });
      assert.doesNotMatch(reply.body, /metrolist\.a/);
    } finally {
      await web.close();
    }
  });
});

describe('desktop mode', () => {
  let server: RunningMetrolistServer;
  before(async () => {
    server = await start({ mode: 'desktop' });
  });
  after(() => server.close());

  test('binds 127.0.0.1 only, on the requested (here ephemeral) port', () => {
    const address = server.server.address();
    assert.ok(address && typeof address === 'object');
    assert.equal(address.address, '127.0.0.1');
    assert.equal(address.port, server.port);
    assert.ok(server.port > 0);
    assert.equal(server.host, '127.0.0.1');
    assert.equal(server.url, `http://127.0.0.1:${server.port}/`);
  });

  test('refuses to bind anything but 127.0.0.1', async () => {
    for (const host of ['0.0.0.0', '::', 'localhost', '192.168.1.10']) {
      await assert.rejects(startMetrolistServer({ mode: 'desktop', host, port: 0 }), /127\.0\.0\.1/);
    }
  });

  test('answers 127.0.0.1:<port> and localhost:<port>, rejects every other Host (DNS rebinding)', async () => {
    assert.equal((await request(server.port, '/')).status, 200);
    assert.equal((await request(server.port, '/', { host: `localhost:${server.port}` })).status, 200);
    for (const host of ['evil.example', `evil.example:${server.port}`, `127.0.0.1:${server.port + 1}`, '127.0.0.1']) {
      const reply = await request(server.port, '/api/innertube/search?q=x', { host });
      assert.equal(reply.status, 403, host);
      assert.doesNotMatch(reply.body, /Metrolist test shell/);
    }
  });

  test('sends no CORS headers, not even for a preflight', async () => {
    const preflight = await request(server.port, '/api/innertube/search', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    });
    assert.equal(preflight.headers['access-control-allow-origin'], undefined);
    const get = await request(server.port, '/api/innertube/search?q=', { headers: { Origin: 'https://evil.example' } });
    assert.equal(get.headers['access-control-allow-origin'], undefined);
  });

  test('serves the built files and the SPA shell for app paths', async () => {
    const manifest = await request(server.port, '/manifest.webmanifest');
    assert.equal(manifest.status, 200);
    assert.equal(manifest.body, MANIFEST);
    assert.equal((await request(server.port, '/assets/app.js')).body, APP_JS);
    for (const appPath of ['/', '/library', '/some/deep/link?x=1']) {
      const reply = await request(server.port, appPath);
      assert.equal(reply.status, 200, appPath);
      assert.equal(reply.body, INDEX_HTML, appPath);
    }
    assert.equal((await request(server.port, '/library', { method: 'POST' })).status, 404);
  });

  test('unknown /api routes answer JSON 404, never the SPA shell', async () => {
    const reply = await request(server.port, '/api/nope');
    assert.equal(reply.status, 404);
    assert.match(String(reply.headers['content-type']), /application\/json/);
    assert.deepEqual(JSON.parse(reply.body), { error: 'Unknown API route.' });
  });

  test('keeps the security headers', async () => {
    const reply = await request(server.port, '/');
    assert.equal(reply.headers['x-content-type-options'], 'nosniff');
    assert.equal(reply.headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.equal(reply.headers['x-powered-by'], undefined);
  });
});

describe('web mode', () => {
  test('binds all interfaces by default', async () => {
    const server = await startMetrolistServer({ mode: 'web', port: 0, distPath: makeDist(), innerTubeTransport: noUpstream });
    try {
      const address = server.server.address();
      assert.ok(address && typeof address === 'object');
      assert.equal(address.address, '0.0.0.0');
      // No Host check in web mode (it may sit behind any domain or proxy)
      assert.equal((await request(server.port, '/', { host: 'metrolist.example.com' })).status, 200);
    } finally {
      await server.close();
    }
  });

  test('sends permissive CORS headers on /api only, and answers preflights', async () => {
    const server = await start({ mode: 'web' });
    try {
      const preflight = await request(server.port, '/api/innertube/search', { method: 'OPTIONS' });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers['access-control-allow-origin'], '*');
      assert.equal(preflight.headers['access-control-allow-methods'], 'GET, OPTIONS');
      const missing = await request(server.port, '/api/innertube/search');
      assert.equal(missing.status, 400);
      assert.equal(missing.headers['access-control-allow-origin'], '*');
      const page = await request(server.port, '/');
      assert.equal(page.headers['access-control-allow-origin'], undefined);
    } finally {
      await server.close();
    }
  });

  test('search goes through the configured InnerTube transport only', async () => {
    const calls: string[] = [];
    const transport: InnerTubeTransport = async (endpoint) => {
      calls.push(endpoint);
      return {};
    };
    const server = await start({ mode: 'web', innerTubeTransport: transport });
    try {
      const reply = await request(server.port, '/api/innertube/search?q=daft%20punk');
      assert.equal(reply.status, 200);
      const body = JSON.parse(reply.body) as { query: string; count: number; tracks: unknown[] };
      assert.equal(body.query, 'daft punk');
      assert.equal(body.count, 0);
      assert.ok(calls.length > 0 && calls.every((c) => c === 'search'));
      const bad = await request(server.port, '/api/innertube/recommendations?videoId=abc&continuation=%3Cscript%3E');
      assert.equal(bad.status, 400);
    } finally {
      await server.close();
    }
  });
});

describe('upstream retry', () => {
  test('one InnerTube timeout or network failure is retried instead of failing the search with 502', async () => {
    let calls = 0;
    const transport: InnerTubeTransport = async (_endpoint, _body, options) => {
      calls++;
      assert.ok(options?.timeoutMs && options.timeoutMs <= 8000, 'every attempt has a timeout');
      if (calls === 1) {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      }
      return {};
    };
    const server = await start({ mode: 'web', innerTubeTransport: transport });
    try {
      const reply = await request(server.port, '/api/innertube/search?q=bts%20dynamite');
      assert.equal(reply.status, 200);
      assert.ok(calls >= 2);
    } finally {
      await server.close();
    }
  });

  test('an HTTP error answer from YouTube is not retried', async () => {
    let calls = 0;
    const transport: InnerTubeTransport = async () => {
      calls++;
      throw new InnerTubeHttpError(403, 'InnerTube next upstream returned 403');
    };
    const server = await start({ mode: 'web', innerTubeTransport: transport });
    try {
      const reply = await request(server.port, '/api/innertube/recommendations?videoId=dQw4w9WgXcQ');
      assert.equal(reply.status, 502);
      assert.equal(calls, 1);
    } finally {
      await server.close();
    }
  });
});

describe('embeddability check (oEmbed)', () => {
  test('answers true / false / null per id, asking only the fixed youtube.com oEmbed URL', async () => {
    const asked: string[] = [];
    const statusById: Record<string, number> = { DrLaoBKGS3g: 401, Z7MIQJluULU: 403, b1kbLwvqugk: 200, gdZLi9oWNZg: 500 };
    const server = await start({
      mode: 'web',
      oEmbedStatus: async (url, timeoutMs) => {
        assert.equal(url.origin, 'https://www.youtube.com');
        assert.equal(url.pathname, '/oembed');
        assert.ok(timeoutMs > 0 && timeoutMs <= 5000);
        asked.push(url.href);
        const id = new URL(url.searchParams.get('url') ?? '').searchParams.get('v') ?? '';
        if (id === 'kJQP7kiw5Fk') throw new Error('timeout');
        return statusById[id] ?? 404;
      },
    });
    try {
      const reply = await request(server.port, '/api/innertube/embeddable?ids=DrLaoBKGS3g,Z7MIQJluULU,b1kbLwvqugk,gdZLi9oWNZg,kJQP7kiw5Fk');
      assert.equal(reply.status, 200);
      assert.equal(reply.headers['access-control-allow-origin'], '*');
      assert.deepEqual(JSON.parse(reply.body), {
        results: { DrLaoBKGS3g: false, Z7MIQJluULU: false, b1kbLwvqugk: true, gdZLi9oWNZg: null, kJQP7kiw5Fk: null },
      });
      assert.equal(asked.length, 5);

      // Definite answers are cached; unknown ones are asked again
      await request(server.port, '/api/innertube/embeddable?ids=DrLaoBKGS3g,b1kbLwvqugk,gdZLi9oWNZg');
      assert.equal(asked.length, 6);
      assert.ok(asked[5].includes('gdZLi9oWNZg'));
    } finally {
      await server.close();
    }
  });

  test('rejects a missing, malformed or too long id list without asking YouTube', async () => {
    let asked = 0;
    const server = await start({
      mode: 'desktop',
      oEmbedStatus: async () => {
        asked++;
        return 200;
      },
    });
    try {
      const eleven = Array.from({ length: 11 }, (_, i) => `video${String(i).padStart(6, '0')}`).join(',');
      for (const query of ['', '?ids=', '?ids=abc', '?ids=DrLaoBKGS3g,%3Cscript%3E', `?ids=${eleven}`, '?ids=DrLaoBKGS3g&ids=b1kbLwvqugk']) {
        const reply = await request(server.port, `/api/innertube/embeddable${query}`);
        assert.equal(reply.status, 400, query);
      }
      assert.equal(asked, 0);
    } finally {
      await server.close();
    }
  });
});

describe('rate limiting', () => {
  for (const mode of ['web', 'desktop'] as const) {
    test(`${mode}: the limiter covers API, static files and the SPA fallback`, async () => {
      const server = await start({ mode, rateLimitPerMinute: 3 });
      try {
        const first = await request(server.port, '/api/nope');
        const policy = String(first.headers['ratelimit-limit'] ?? first.headers['ratelimit-policy'] ?? '');
        assert.match(policy, /^3(;|$)/, 'standard RateLimit headers announce the limit');
        await request(server.port, '/manifest.webmanifest');
        await request(server.port, '/library');
        const limited = await request(server.port, '/library');
        assert.equal(limited.status, 429);
        assert.deepEqual(JSON.parse(limited.body), { error: 'Rate limit exceeded. Please try again shortly.' });
      } finally {
        await server.close();
      }
    });
  }
});

describe('frontend middleware (dev)', () => {
  test('a frontend handler replaces static files, after the API routes', async () => {
    const server = await startMetrolistServer({
      mode: 'web',
      host: '127.0.0.1',
      port: 0,
      innerTubeTransport: noUpstream,
      frontend: (_req, res) => {
        res.end('vite');
      },
    });
    try {
      assert.equal((await request(server.port, '/anything')).body, 'vite');
      assert.equal((await request(server.port, '/api/nope')).status, 404);
    } finally {
      await server.close();
    }
  });
});

test('a busy port rejects with EADDRINUSE (the desktop app falls back to another port)', async () => {
  const first = await start({ mode: 'desktop' });
  try {
    await assert.rejects(startMetrolistServer({ mode: 'desktop', port: first.port }), (err: NodeJS.ErrnoException) => {
      assert.equal(err.code, 'EADDRINUSE');
      return true;
    });
  } finally {
    await first.close();
  }
});

function decode(reply: { headers: http.IncomingHttpHeaders; body: Buffer }): string {
  const encoding = reply.headers['content-encoding'];
  if (encoding === 'br') return zlib.brotliDecompressSync(reply.body).toString('utf8');
  if (encoding === 'gzip') return zlib.gunzipSync(reply.body).toString('utf8');
  return reply.body.toString('utf8');
}

function bigSearchTransport(): InnerTubeTransport {
  const items = Array.from({ length: 40 }, (_, i) => ({
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId: `abcdefghi${String(i).padStart(2, '0')}` },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: `Song number ${i}` }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: 'Some Artist • Some Album • 3:22' }] } } },
      ],
    },
  }));
  const answer = { contents: { sectionListRenderer: { contents: [{ musicShelfRenderer: { contents: items } }] } } };
  return async () => answer;
}

describe('compression and caching', () => {
  test('web mode compresses assets, pages and API answers for clients that accept it; identity otherwise', async () => {
    const server = await start({ mode: 'web', innerTubeTransport: bigSearchTransport() });
    try {
      const gz = await rawRequest(server.port, '/assets/app.js', { 'Accept-Encoding': 'gzip, br' });
      assert.equal(gz.status, 200);
      assert.ok(['br', 'gzip'].includes(String(gz.headers['content-encoding'])));
      assert.ok(gz.body.length < APP_JS.length);
      assert.equal(decode(gz), APP_JS);

      const plain = await rawRequest(server.port, '/assets/app.js');
      assert.equal(plain.headers['content-encoding'], undefined);
      assert.equal(plain.body.toString('utf8'), APP_JS);

      const api = await rawRequest(server.port, '/api/innertube/search?q=song', { 'Accept-Encoding': 'gzip' });
      assert.equal(api.headers['content-encoding'], 'gzip');
      assert.equal((JSON.parse(decode(api)) as { tracks: unknown[] }).tracks.length, 20);
    } finally {
      await server.close();
    }
  });

  test('desktop mode never compresses', async () => {
    const server = await start({ mode: 'desktop', innerTubeTransport: bigSearchTransport() });
    try {
      for (const p of ['/assets/app.js', '/api/innertube/search?q=song']) {
        const reply = await rawRequest(server.port, p, { 'Accept-Encoding': 'gzip, br' });
        assert.equal(reply.status, 200);
        assert.equal(reply.headers['content-encoding'], undefined, p);
      }
    } finally {
      await server.close();
    }
  });

  for (const mode of ['web', 'desktop'] as const) {
    test(`${mode} mode: hashed assets are immutable, everything else is revalidated`, async () => {
      const server = await start({ mode });
      try {
        const asset = await request(server.port, '/assets/app.js');
        assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
        for (const p of ['/', '/index.html', '/manifest.webmanifest', '/library/liked/deep']) {
          const reply = await request(server.port, p);
          assert.equal(reply.status, 200, p);
          assert.equal(reply.headers['cache-control'], 'no-cache', p);
        }
      } finally {
        await server.close();
      }
    });
  }
});
