/**
 * The Metrolist HTTP server: the InnerTube proxy API (`/api/innertube/*`) plus the built frontend.
 *
 * One factory, two modes:
 * - `web` (the CLI `server.ts`, Docker, the portable zip): binds `0.0.0.0` by default and sends
 *   permissive CORS headers on `/api`, so the packaged mobile app and static hosts can use it through
 *   `VITE_API_BASE_URL`.
 * - `desktop` (inside the Electron main process): binds `127.0.0.1` only, sends no CORS headers and
 *   rejects any request whose `Host` is not `127.0.0.1:<port>` / `localhost:<port>` (DNS rebinding).
 *
 * Security guardrails (CLAUDE.md §5) live here: `express-rate-limit` is mounted globally AND on the
 * `sendFile` SPA fallback, upstream calls use fixed allow-listed URLs with an origin check, and there is
 * no bare `'*'` route (Express 5). This module must not use `import.meta`: it is also bundled to CJS.
 */
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import type http from 'node:http';
import path from 'node:path';
import {
  INNERTUBE_API_ORIGIN,
  INNERTUBE_ENDPOINT_URLS,
  InnerTubeHttpError,
  fetchInnerTubeRadioPage,
  isValidYouTubeVideoId,
  sanitizeApiQueryText,
  sanitizeRadioContinuation,
  searchInnerTubeTracks,
  withInnerTubeRetry,
  type InnerTubeTransport,
} from '../utils/metrolistCore';
import { isAllowedDesktopHost } from './hostAllowlist';
import { DEFAULT_RATE_LIMIT_PER_MINUTE } from './serverConfig';

export type ServerMode = 'web' | 'desktop';

/** The only address the desktop server may listen on. */
export const DESKTOP_HOST = '127.0.0.1';

/** A Connect-style handler (e.g. Vite's dev middlewares). */
export type FrontendMiddleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: (err?: unknown) => void
) => void;

export interface MetrolistServerOptions {
  mode: ServerMode;
  /** TCP port; `0` picks a free one (tests). */
  port: number;
  /** Listen address. Web: default `0.0.0.0`. Desktop: must be `127.0.0.1` (the default). */
  host?: string;
  /** The built frontend (`dist/`): static files plus the SPA fallback. */
  distPath?: string;
  /** Serves the frontend instead of `distPath` (Vite's dev middlewares). */
  frontend?: FrontendMiddleware;
  /** Requests per IP per minute (default 240). */
  rateLimitPerMinute?: number;
  /** Replaces the YouTube Music transport (tests). */
  innerTubeTransport?: InnerTubeTransport;
}

export interface RunningMetrolistServer {
  readonly server: http.Server;
  readonly host: string;
  readonly port: number;
  /** `http://<host>:<port>/` (for `0.0.0.0`: `http://localhost:<port>/`). */
  readonly url: string;
  close: () => Promise<void>;
}

const MAX_CACHE_ENTRIES = 200;
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes
/** One upstream InnerTube attempt. */
const UPSTREAM_TIMEOUT_MS = 8000;
/**
 * Everything one API request may spend upstream, retries included (`withInnerTubeRetry`). It stays
 * below the client's own timeout (`apiClient.ts`, 20 s), so the app always gets an answer.
 */
const UPSTREAM_BUDGET_MS = 16000;

function setBoundedCache<T>(cache: Map<string, { timestamp: number; payload: T }>, key: string, payload: T) {
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
export const innerTubeTransport: InnerTubeTransport = async (endpoint, body, options) => {
  const url = new URL(INNERTUBE_ENDPOINT_URLS[endpoint]);
  if (url.origin !== INNERTUBE_API_ORIGIN) {
    throw new Error('Invalid InnerTube upstream origin.');
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: INNERTUBE_HEADERS,
    signal: AbortSignal.timeout(options?.timeoutMs ?? UPSTREAM_TIMEOUT_MS),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new InnerTubeHttpError(response.status, `InnerTube ${endpoint} upstream returned ${response.status}`);
  }
  return response.json();
};

function resolveHost(mode: ServerMode, host: string | undefined): string {
  if (mode === 'desktop') {
    if (host !== undefined && host !== DESKTOP_HOST) {
      throw new Error(`The desktop server only listens on ${DESKTOP_HOST} (got "${host}").`);
    }
    return DESKTOP_HOST;
  }
  return host ?? '0.0.0.0';
}

/** Builds the Express app (not listening). */
export function createMetrolistApp(options: Omit<MetrolistServerOptions, 'port' | 'host'>): Express {
  const { mode, distPath, frontend } = options;
  const baseTransport = options.innerTubeTransport ?? innerTubeTransport;
  /** A timeout / network failure is retried once; one budget per API request. */
  const requestTransport = () =>
    withInnerTubeRetry(baseTransport, { attemptTimeoutMs: UPSTREAM_TIMEOUT_MS, budgetMs: UPSTREAM_BUDGET_MS });
  const app = express();

  app.disable('x-powered-by');

  if (mode === 'desktop') {
    // DNS-rebinding protection, before anything else answers
    app.use((req, res, next) => {
      if (!isAllowedDesktopHost(req.headers.host, req.socket.localPort ?? 0)) {
        res.status(403).type('text/plain').send('Forbidden host.');
        return;
      }
      next();
    });
  }

  app.use(express.json({ limit: '32kb' }));

  // Production HTTP security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), compute-pressure=*');
    next();
  });

  // CodeQL-compliant per-IP rate limiter across all API and static file routes (240 requests per 60s window)
  const rateLimiterMiddleware = rateLimit({
    windowMs: 60_000,
    limit: options.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Rate limit exceeded. Please try again shortly.' },
  });
  app.use(rateLimiterMiddleware);

  if (mode === 'web') {
    // The API is public, read-only and cookie-less, so any origin may call it. This is what lets the
    // packaged Android / iOS app (`https://localhost`) and static web hosts use a deployed backend
    // through `VITE_API_BASE_URL`. The desktop app is same-origin and sends none of this.
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
  }

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
      const tracks = (await searchInnerTubeTracks(requestTransport(), query)).slice(0, 20);
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
      const transport = requestTransport();
      let seedVideoId = isValidYouTubeVideoId(rawVideoId) ? rawVideoId : '';

      // If the track does not yet have a canonical 11-char YouTube videoId, resolve it via search
      if (!seedVideoId && (title || artist)) {
        const parsedSearch = await searchInnerTubeTracks(transport, `${title} ${artist}`.trim()).catch(() => []);
        if (parsedSearch.length > 0) {
          seedVideoId = parsedSearch[0].videoId;
        }
      }

      if (!seedVideoId) {
        seedVideoId = 'a5uQMwRMHcs';
      }

      // Query YouTube Music's official RDAMVM Radio / WatchNext recommendation engine
      const page = await fetchInnerTubeRadioPage(transport, seedVideoId, continuation || undefined);
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

  if (frontend) {
    app.use(frontend);
  } else if (distPath) {
    app.use(express.static(distPath));
    // SPA fallback. A path-less middleware (instead of `app.get('*')`) keeps this working on Express 5,
    // where a bare `*` route pattern throws at startup. The rate limiter is mounted here explicitly too.
    app.use(rateLimiterMiddleware, (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

/** Creates the app and starts listening. Rejects (e.g. `EADDRINUSE`) when the port cannot be bound. */
export function startMetrolistServer(options: MetrolistServerOptions): Promise<RunningMetrolistServer> {
  let host: string;
  try {
    host = resolveHost(options.mode, options.host);
  } catch (err) {
    return Promise.reject(err);
  }
  const app = createMetrolistApp(options);

  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, host);
    const onError = (err: Error) => {
      server.close();
      reject(err);
    };
    server.once('error', onError);
    server.once('listening', () => {
      server.off('error', onError);
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : options.port;
      const urlHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
      resolve({
        server,
        host,
        port,
        url: `http://${urlHost}:${port}/`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
