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
  fetchInnerTubeRadioTracks,
  isValidYouTubeVideoId,
  searchInnerTubeTracks,
  type InnerTubeParsedTrack,
  type InnerTubeTransport,
} from './metrolistCore';

const REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_RADIO_SEED_VIDEO_ID = 'a5uQMwRMHcs';

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

function withTimeout(signal?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
const directInnerTubeTransport: InnerTubeTransport = async (endpoint, body) => {
  const url = INNERTUBE_ENDPOINT_URLS[endpoint];
  const cap = getCapacitor();

  if (isNativeShell() && typeof cap?.nativePromise === 'function') {
    const response = await cap.nativePromise('CapacitorHttp', 'request', {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: body,
      responseType: 'json',
      connectTimeout: REQUEST_TIMEOUT_MS,
      readTimeout: REQUEST_TIMEOUT_MS,
    });
    const status = typeof response?.status === 'number' ? response.status : 0;
    if (status < 200 || status >= 300) {
      throw new Error(`YouTube Music returned ${status || 'no response'}`);
    }
    const data = response.data;
    return typeof data === 'string' ? JSON.parse(data) : data;
  }

  const timeout = withTimeout();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeout.signal,
    });
    if (!res.ok) throw new Error(`YouTube Music returned ${res.status}`);
    return await res.json();
  } finally {
    timeout.dispose();
  }
};

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

/** Live YouTube Music search. Resolves with `[]` when nothing matches; rejects on network failure. */
export async function searchTracks(
  query: string,
  signal?: AbortSignal
): Promise<InnerTubeParsedTrack[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  return backendThenDirect(
    signal,
    async () => {
      const data = await fetchBackendJson<{ tracks?: InnerTubeParsedTrack[] }>(
        `/api/innertube/search?q=${encodeURIComponent(trimmed)}`,
        signal
      );
      return Array.isArray(data.tracks) ? data.tracks : [];
    },
    () => searchInnerTubeTracks(directInnerTubeTransport, trimmed)
  );
}

/** YouTube Music radio ("Up Next") recommendations for a seed track. */
export async function fetchRecommendations(
  seed: { videoId: string; title: string; artist: string },
  signal?: AbortSignal
): Promise<InnerTubeParsedTrack[]> {
  return backendThenDirect(
    signal,
    async () => {
      const data = await fetchBackendJson<{ tracks?: InnerTubeParsedTrack[] }>(
        `/api/innertube/recommendations?videoId=${encodeURIComponent(
          seed.videoId
        )}&title=${encodeURIComponent(seed.title)}&artist=${encodeURIComponent(seed.artist)}`,
        signal
      );
      return Array.isArray(data.tracks) ? data.tracks : [];
    },
    async () => {
      let seedVideoId = isValidYouTubeVideoId(seed.videoId) ? seed.videoId : '';
      if (!seedVideoId) {
        const matches = await searchInnerTubeTracks(
          directInnerTubeTransport,
          `${seed.title} ${seed.artist}`.trim()
        ).catch(() => []);
        seedVideoId = matches[0]?.videoId || DEFAULT_RADIO_SEED_VIDEO_ID;
      }
      return fetchInnerTubeRadioTracks(directInnerTubeTransport, seedVideoId);
    }
  );
}
