/**
 * Network layer for search and radio recommendations.
 *
 * Three runtimes have to work:
 *  1. Browser + Express (`npm run dev`, Docker, desktop bundles): relative `/api/innertube/*` calls.
 *  2. Any frontend pointed at a deployed backend: `VITE_API_BASE_URL` is prepended to `/api/...`.
 *  3. Packaged Android / iOS app (Capacitor): there is no Node process on the phone, so the app
 *     talks to YouTube Music directly through Capacitor's native HTTP bridge, which is not subject
 *     to browser CORS rules.
 */
import {
  INNERTUBE_ENDPOINT_URLS,
  InnerTubeHttpError,
  fetchInnerTubeRadioPage,
  isValidYouTubeVideoId,
  sanitizeRadioContinuation,
  searchInnerTubeTracks,
  withInnerTubeRetry,
  type InnerTubeParsedTrack,
  type InnerTubeTransport,
} from './metrolistCore';
import {
  MAX_EMBEDDABLE_IDS,
  buildOEmbedUrl,
  embeddabilityFromOEmbedStatus,
  readEmbeddabilityResults,
  type Embeddability,
} from './embeddability';
import { LruTtlCache } from './lruCache';

/** Backend requests (the server retries upstream within 16 s, so this leaves it room to answer). */
const REQUEST_TIMEOUT_MS = 20000;
/** One direct InnerTube attempt (native shell), and the budget of one operation, retries included. */
const DIRECT_ATTEMPT_TIMEOUT_MS = 8000;
const DIRECT_BUDGET_MS = 20000;
const DEFAULT_RADIO_SEED_VIDEO_ID = 'a5uQMwRMHcs';

/**
 * How long a search answer stays fresh. Long enough that coming back to the Search tab after
 * listening for a while shows the same results at once, without a request; song search results do
 * not change within that time.
 */
export const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;

/** Repeated searches (and artist-chip switches, returning to the Search tab) are answered from memory. */
const searchCache = new LruTtlCache<InnerTubeParsedTrack[]>({ maxEntries: 30, ttlMs: SEARCH_CACHE_TTL_MS });

function searchCacheKey(query: string): string {
  return query.trim().toLowerCase();
}

/** The fresh cached answer for `query`, synchronously (`null` = it needs a request). */
export function peekSearchResults(query: string): InnerTubeParsedTrack[] | null {
  const key = searchCacheKey(query);
  return key ? (searchCache.get(key, Date.now()) ?? null) : null;
}

/** Tests only: forget every cached search. */
export function resetSearchCache(): void {
  searchCache.clear();
}

/** Embeddability answers per video id (`true` / `false`), and recently inconclusive checks. */
const embeddabilityCache = new LruTtlCache<boolean>({ maxEntries: 2000, ttlMs: 6 * 60 * 60 * 1000 });
const inconclusiveEmbeddability = new LruTtlCache<true>({ maxEntries: 500, ttlMs: 2 * 60 * 1000 });

/** One page of YouTube Music radio. `continuation` is the token of the next page (`null` = exhausted). */
export interface RadioPage {
  tracks: InnerTubeParsedTrack[];
  continuation: string | null;
}

/** The first radio page for a track, plus the seed video the radio was actually built from. */
export interface RecommendationsPage extends RadioPage {
  seedVideoId: string;
}

interface BackendRadioPayload {
  seedVideoId?: unknown;
  tracks?: unknown;
  continuation?: unknown;
}

function readBackendRadioPage(data: BackendRadioPayload): RadioPage {
  return {
    tracks: Array.isArray(data.tracks) ? (data.tracks as InnerTubeParsedTrack[]) : [],
    continuation: sanitizeRadioContinuation(data.continuation) || null,
  };
}

interface NativeHttpResponse {
  status?: number;
  data?: unknown;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  nativePromise?: (
    pluginName: string,
    methodName: string,
    options: Record<string, unknown>
  ) => Promise<NativeHttpResponse>;
}

function getCapacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
}

/** True inside the packaged Android / iOS app shell. */
export function isNativeShell(): boolean {
  const cap = getCapacitor();
  try {
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let base = raw.trim();
  while (base.endsWith('/')) {
    base = base.slice(0, -1);
  }
  return base;
}

export const API_BASE_URL = normalizeBaseUrl(import.meta.env?.VITE_API_BASE_URL);

/** A backend exists when one is configured explicitly, or when the page is served by Express. */
function hasBackend(): boolean {
  return API_BASE_URL !== '' || !isNativeShell();
}

function withTimeout(signal?: AbortSignal, timeoutMs = REQUEST_TIMEOUT_MS): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

async function fetchBackendJson<T>(pathAndQuery: string, signal?: AbortSignal): Promise<T> {
  const timeout = withTimeout(signal);
  try {
    const res = await fetch(`${API_BASE_URL}${pathAndQuery}`, { signal: timeout.signal });
    const contentType = res.headers.get('content-type') || '';
    // A static host answers `/api/*` with its HTML shell: treat that as "no backend here"
    if (!contentType.includes('application/json')) {
      throw new Error('The music service is not reachable from this app build.');
    }
    const data = await res.json();
    if (!res.ok) {
      const message =
        data && typeof data.error === 'string' ? data.error : `Request failed (${res.status})`;
      throw new Error(message);
    }
    return data as T;
  } finally {
    timeout.dispose();
  }
}

/** Direct InnerTube transport: native HTTP inside the app shell, plain `fetch` otherwise. */
const singleDirectInnerTubeRequest: InnerTubeTransport = async (endpoint, body, options) => {
  const url = INNERTUBE_ENDPOINT_URLS[endpoint];
  const cap = getCapacitor();
  const timeoutMs = options?.timeoutMs ?? DIRECT_ATTEMPT_TIMEOUT_MS;

  if (isNativeShell() && typeof cap?.nativePromise === 'function') {
    const response = await cap.nativePromise('CapacitorHttp', 'request', {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: body,
      responseType: 'json',
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
    const status = typeof response?.status === 'number' ? response.status : 0;
    if (status < 200 || status >= 300) {
      // Status 0 means no answer at all (a network failure, retried); anything else is an answer
      if (status === 0) throw new Error('YouTube Music returned no response');
      throw new InnerTubeHttpError(status, `YouTube Music returned ${status}`);
    }
    const data = response.data;
    return typeof data === 'string' ? JSON.parse(data) : data;
  }

  const timeout = withTimeout(undefined, timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    if (!res.ok) throw new InnerTubeHttpError(res.status, `YouTube Music returned ${res.status}`);
    return await res.json();
  } finally {
    timeout.dispose();
  }
};

/** A fresh retrying transport per operation: one timeout / network failure is retried, within a budget. */
function directInnerTubeTransport(): InnerTubeTransport {
  return withInnerTubeRetry(singleDirectInnerTubeRequest, {
    attemptTimeoutMs: DIRECT_ATTEMPT_TIMEOUT_MS,
    budgetMs: DIRECT_BUDGET_MS,
  });
}

/**
 * Runs `viaBackend` when a backend exists; inside the native shell falls back to (or goes
 * straight to) `direct`. Caller-initiated aborts are always re-thrown untouched.
 */
async function backendThenDirect<T>(
  signal: AbortSignal | undefined,
  viaBackend: () => Promise<T>,
  direct: () => Promise<T>
): Promise<T> {
  if (hasBackend()) {
    try {
      return await viaBackend();
    } catch (err) {
      if (signal?.aborted) throw err;
      if (!isNativeShell()) throw err;
    }
  }
  return direct();
}

/**
 * Live YouTube Music search. Resolves with `[]` when nothing matches; rejects on network failure.
 * Non-empty answers are cached for a few minutes; empty and failed ones never are.
 */
export async function searchTracks(
  query: string,
  signal?: AbortSignal
): Promise<InnerTubeParsedTrack[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const cacheKey = searchCacheKey(trimmed);
  const cached = searchCache.get(cacheKey, Date.now());
  if (cached) return cached;

  const tracks = await backendThenDirect(
    signal,
    async () => {
      const data = await fetchBackendJson<{ tracks?: InnerTubeParsedTrack[] }>(
        `/api/innertube/search?q=${encodeURIComponent(trimmed)}`,
        signal
      );
      return Array.isArray(data.tracks) ? data.tracks : [];
    },
    () => searchInnerTubeTracks(directInnerTubeTransport(), trimmed)
  );
  if (tracks.length > 0) searchCache.set(cacheKey, tracks, Date.now());
  return tracks;
}

/** YouTube Music radio ("Up Next") recommendations for a seed track: the first radio page. */
export async function fetchRecommendations(
  seed: { videoId: string; title: string; artist: string },
  signal?: AbortSignal
): Promise<RecommendationsPage> {
  const validSeed = isValidYouTubeVideoId(seed.videoId) ? seed.videoId : '';
  return backendThenDirect(
    signal,
    async () => {
      const data = await fetchBackendJson<BackendRadioPayload>(
        `/api/innertube/recommendations?videoId=${encodeURIComponent(
          seed.videoId
        )}&title=${encodeURIComponent(seed.title)}&artist=${encodeURIComponent(seed.artist)}`,
        signal
      );
      const seedVideoId = isValidYouTubeVideoId(data.seedVideoId)
        ? String(data.seedVideoId)
        : validSeed;
      return { ...readBackendRadioPage(data), seedVideoId };
    },
    async () => {
      const transport = directInnerTubeTransport();
      let seedVideoId = validSeed;
      if (!seedVideoId) {
        const matches = await searchInnerTubeTracks(
          transport,
          `${seed.title} ${seed.artist}`.trim()
        ).catch(() => []);
        seedVideoId = matches[0]?.videoId || DEFAULT_RADIO_SEED_VIDEO_ID;
      }
      const page = await fetchInnerTubeRadioPage(transport, seedVideoId);
      return { ...page, seedVideoId };
    }
  );
}

/** The next page of a radio started by `fetchRecommendations` (Metrolist-style endless radio). */
export async function fetchRadioContinuation(
  request: { seedVideoId: string; continuation: string },
  signal?: AbortSignal
): Promise<RadioPage> {
  const continuation = sanitizeRadioContinuation(request.continuation);
  if (!isValidYouTubeVideoId(request.seedVideoId) || !continuation) {
    throw new Error('Invalid radio continuation request.');
  }
  return backendThenDirect(
    signal,
    async () =>
      readBackendRadioPage(
        await fetchBackendJson<BackendRadioPayload>(
          `/api/innertube/recommendations?videoId=${encodeURIComponent(
            request.seedVideoId
          )}&continuation=${encodeURIComponent(continuation)}`,
          signal
        )
      ),
    () => fetchInnerTubeRadioPage(directInnerTubeTransport(), request.seedVideoId, continuation)
  );
}

/* ------------------------------------- embeddability ------------------------------------------- */

/**
 * What is known about a video without asking: `true` / `false`, `null` when a recent check was
 * inconclusive (treated as playable), `undefined` when it was never checked.
 */
export function peekEmbeddability(videoId: string): Embeddability | undefined {
  const now = Date.now();
  const known = embeddabilityCache.get(videoId, now);
  if (known !== undefined) return known;
  return inconclusiveEmbeddability.get(videoId, now) ? null : undefined;
}

/** Forgets every embeddability answer (tests). */
export function resetEmbeddabilityCache(): void {
  embeddabilityCache.clear();
  inconclusiveEmbeddability.clear();
}

/** Native shell: one oEmbed GET per video through CapacitorHttp (no CORS there). */
async function directEmbeddability(ids: string[]): Promise<Record<string, Embeddability>> {
  const cap = getCapacitor();
  const out: Record<string, Embeddability> = {};
  const nativePromise = isNativeShell() ? cap?.nativePromise : undefined;
  await Promise.all(
    ids.map(async (id) => {
      out[id] = null;
      if (typeof nativePromise !== 'function') return;
      try {
        const response = await nativePromise('CapacitorHttp', 'request', {
          url: buildOEmbedUrl(id).href,
          method: 'GET',
          responseType: 'json',
          connectTimeout: DIRECT_ATTEMPT_TIMEOUT_MS,
          readTimeout: DIRECT_ATTEMPT_TIMEOUT_MS,
        });
        out[id] = embeddabilityFromOEmbedStatus(typeof response?.status === 'number' ? response.status : 0);
      } catch {
        // unknown
      }
    })
  );
  return out;
}

/**
 * Whether each video can be played in the embedded player (YouTube's oEmbed: 401 = its owner turned
 * that off). Known answers come from memory. Never rejects except on a caller abort: a failed check
 * answers `null` (unknown, treated as playable).
 */
export async function checkEmbeddable(
  videoIds: readonly string[],
  signal?: AbortSignal
): Promise<Record<string, Embeddability>> {
  const out: Record<string, Embeddability> = {};
  const missing: string[] = [];
  for (const id of videoIds) {
    if (!isValidYouTubeVideoId(id) || id.trim() !== id || id in out || missing.includes(id)) continue;
    const known = peekEmbeddability(id);
    if (known === undefined) missing.push(id);
    else out[id] = known;
  }
  for (let start = 0; start < missing.length; start += MAX_EMBEDDABLE_IDS) {
    const chunk = missing.slice(start, start + MAX_EMBEDDABLE_IDS);
    let results: Record<string, Embeddability>;
    try {
      results = await backendThenDirect(
        signal,
        async () =>
          readEmbeddabilityResults(
            await fetchBackendJson<unknown>(`/api/innertube/embeddable?ids=${encodeURIComponent(chunk.join(','))}`, signal),
            chunk
          ),
        () => directEmbeddability(chunk)
      );
    } catch (err) {
      if (signal?.aborted) throw err;
      results = readEmbeddabilityResults(null, chunk);
    }
    const now = Date.now();
    for (const id of chunk) {
      const result = results[id] ?? null;
      out[id] = result;
      if (result === null) inconclusiveEmbeddability.set(id, true, now);
      else embeddabilityCache.set(id, result, now);
    }
  }
  return out;
}
