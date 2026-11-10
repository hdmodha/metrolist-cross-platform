import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  INNERTUBE_API_ORIGIN,
  INNERTUBE_ENDPOINT_URLS,
  fetchInnerTubeRadioPage,
  isValidYouTubeVideoId,
  sanitizeApiQueryText,
  sanitizeRadioContinuation,
  searchInnerTubeTracks,
  type InnerTubeTransport,
} from './src/utils/metrolistCore.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes
const UPSTREAM_TIMEOUT_MS = 8000;

function setBoundedCache<T>(
  cache: Map<string, { timestamp: number; payload: T }>,
  key: string,
  payload: T
) {
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(key)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, { timestamp: Date.now(), payload });
}

const INNERTUBE_HEADERS = {
  'Content-Type': 'application/json',
  Origin: INNERTUBE_API_ORIGIN,
  Referer: `${INNERTUBE_API_ORIGIN}/`,
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
};

/** Server-side InnerTube transport: fixed allow-listed endpoint URLs only (no request-derived hosts). */
const innerTubeTransport: InnerTubeTransport = async (endpoint, body) => {
  const url = new URL(INNERTUBE_ENDPOINT_URLS[endpoint]);
  if (url.origin !== INNERTUBE_API_ORIGIN) {
    throw new Error('Invalid InnerTube upstream origin.');
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: INNERTUBE_HEADERS,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`InnerTube ${endpoint} upstream returned ${response.status}`);
  }
  return response.json();
};

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  // Production HTTP security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), compute-pressure=*'
    );
    next();
  });

  // CodeQL-compliant per-IP rate limiter across all API and static file routes (240 requests per 60s window)
  const rateLimiterMiddleware = rateLimit({
    windowMs: 60_000,
    limit: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Please try again shortly.' },
  });
  app.use(rateLimiterMiddleware);

  // The API is public, read-only and cookie-less, so any origin may call it. This is what lets the
  // packaged Android / iOS app (`https://localhost`) and static web hosts use a deployed backend
  // through `VITE_API_BASE_URL`.
  app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Bounded in-memory caches for <2ms response times on repeated searches & recommendations
  const searchCache = new Map<string, { timestamp: number; payload: unknown }>();
  const recommendationsCache = new Map<string, { timestamp: number; payload: unknown }>();

  /**
   * 1. Live YouTube Music InnerTube `WEB_REMIX` Search Proxy
   */
  app.get('/api/innertube/search', async (req, res) => {
    const query = sanitizeApiQueryText(req.query.q, 120);
    if (!query) {
      res.status(400).json({ error: 'Missing search query parameter "q".' });
      return;
    }

    const cacheKey = query.toLowerCase();
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      res.json(cached.payload);
      return;
    }

    try {
      const tracks = (await searchInnerTubeTracks(innerTubeTransport, query)).slice(0, 20);
      const payload = {
        source: 'YouTube Music InnerTube (WEB_REMIX v1)',
        query,
        count: tracks.length,
        tracks,
      };
      // Never cache an empty answer: it is usually transient and would hide results for 30 minutes
      if (tracks.length > 0) {
        setBoundedCache(searchCache, cacheKey, payload);
      }
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown InnerTube error';
      res.status(502).json({ error: message });
    }
  });

  /**
   * 2. Official YouTube Music Recommendation / Up Next Radio Engine (`/api/innertube/recommendations`)
   */
  app.get('/api/innertube/recommendations', async (req, res) => {
    const rawVideoId = sanitizeApiQueryText(req.query.videoId, 32);
    const title = sanitizeApiQueryText(req.query.title, 120);
    const artist = sanitizeApiQueryText(req.query.artist, 120);

    // Optional radio continuation token (next page of the same `RDAMVM` radio)
    const hasContinuation = req.query.continuation !== undefined;
    const continuation = sanitizeRadioContinuation(req.query.continuation);
    if (hasContinuation && (!continuation || !isValidYouTubeVideoId(rawVideoId))) {
      res.status(400).json({ error: 'Invalid radio continuation request.' });
      return;
    }

    const cacheKey = `${rawVideoId}:${title.toLowerCase()}:${artist.toLowerCase()}:${continuation}`;
    const cached = recommendationsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      res.json(cached.payload);
      return;
    }

    try {
      let seedVideoId = isValidYouTubeVideoId(rawVideoId) ? rawVideoId : '';

      // If the track does not yet have a canonical 11-char YouTube videoId, resolve it via search
      if (!seedVideoId && (title || artist)) {
        const parsedSearch = await searchInnerTubeTracks(
          innerTubeTransport,
          `${title} ${artist}`.trim()
        ).catch(() => []);
        if (parsedSearch.length > 0) {
          seedVideoId = parsedSearch[0].videoId;
        }
      }

      if (!seedVideoId) {
        seedVideoId = 'a5uQMwRMHcs';
      }

      // Query YouTube Music's official RDAMVM Radio / WatchNext recommendation engine
      const page = await fetchInnerTubeRadioPage(
        innerTubeTransport,
        seedVideoId,
        continuation || undefined
      );
      const tracks = page.tracks.slice(0, 20);

      const payload = {
        source: `YouTube Music Radio (RDAMVM${seedVideoId})`,
        seedVideoId,
        count: tracks.length,
        tracks,
        continuation: page.continuation,
      };
      if (tracks.length > 0) {
        setBoundedCache(recommendationsCache, cacheKey, payload);
      }
      res.json(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Recommendation engine error';
      res.status(502).json({ error: message });
    }
  });

  // Unknown API routes must answer with JSON, never with the SPA shell
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown API route.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: false,
        fs: {
          strict: true,
          deny: ['.env', '.env.*', '*.{crt,pem}'],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    // SPA fallback. A path-less middleware (instead of `app.get('*')`) keeps this working on both
    // Express 4 and Express 5, where a bare `*` route pattern throws at startup.
    app.use(rateLimiterMiddleware, (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Metrolist KMP Server running on http://localhost:${PORT}`);
  });
}

startServer();
