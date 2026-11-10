/**
 * Pure, framework-free core logic shared by the React app, the Express proxy (`server.ts`) and the
 * unit tests: InnerTube search / radio parsers and request layer, song search terms, playback
 * queue rules, and API input sanitizers.
 */

/**
 * Format duration milliseconds into tabular `MM:SS` string.
 */
export function formatDurationMs(ms: number): string {
  const safeSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export interface InnerTubeParsedTrack {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  thumbnailUrl: string;
  playsText?: string;
}

type TextRuns = { runs?: Array<{ text?: string }> } | undefined;

function joinRuns(text: TextRuns): string {
  return (text?.runs || [])
    .map((r) => r.text || '')
    .join('')
    .trim();
}

/**
 * Parses a clock string (`M:SS` or `H:MM:SS`) into milliseconds in linear time.
 * Returns 0 for anything else (e.g. live streams reported as `20,843:43:51`).
 */
export function parseClockDurationMs(raw: string): number {
  const text = raw.trim();
  if (!text || text.length > 10) return 0;
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 3) return 0;

  let totalSec = 0;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    if (!part || part.length > 3) return 0;
    for (let i = 0; i < part.length; i++) {
      const code = part.charCodeAt(i);
      if (code < 48 || code > 57) return 0;
    }
    // Minutes / seconds after the leading unit must be exactly two digits
    if (p > 0 && part.length !== 2) return 0;
    totalSec = totalSec * 60 + Number(part);
  }
  return totalSec * 1000;
}

function looksLikePlayCount(part: string): boolean {
  const lower = part.toLowerCase();
  return (
    lower.endsWith(' views') ||
    lower.endsWith(' view') ||
    lower.endsWith(' plays') ||
    lower.endsWith(' play') ||
    lower.endsWith(' likes')
  );
}

/** Longest thumbnail in the list, upscaled to 400px when it is a resizable Google image URL. */
function pickThumbnailUrl(thumbs: Array<{ url?: string }>, videoId: string): string {
  const lastThumb = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return lastThumb.replace(/=w\d+-h\d+/, '=w400-h400');
}

function readMusicVideoType(node: unknown): string {
  // Depth-bounded lookup of `watchEndpointMusicConfig.musicVideoType` inside a renderer
  const stack: Array<{ value: unknown; depth: number }> = [{ value: node, depth: 0 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (!value || typeof value !== 'object' || depth > 12) continue;
    const rec = value as Record<string, unknown>;
    if (typeof rec.musicVideoType === 'string') return rec.musicVideoType;
    for (const child of Object.values(rec)) {
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  return '';
}

/** Longest playable item kept in search / radio results (filters out DJ mixes, podcasts and live streams). */
export const MAX_PLAYABLE_TRACK_DURATION_MS = 20 * 60 * 1000;

/**
 * Pure parser for YouTube Music InnerTube `WEB_REMIX` search responses (`musicResponsiveListItemRenderer`).
 * Handles both the "Songs" shelf (`Artist • Album • 3:22`) and the "Videos" shelf
 * (`Channel • 1.3B views • 4:33`), which is the only catalog YouTube Music returns in regions
 * where the premium song catalog is unavailable.
 */
export function parseInnerTubeSearchResponse(rawJson: unknown): InnerTubeParsedTrack[] {
  const renderers: Array<Record<string, unknown>> = [];

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    if (rec.musicResponsiveListItemRenderer && typeof rec.musicResponsiveListItemRenderer === 'object') {
      renderers.push(rec.musicResponsiveListItemRenderer as Record<string, unknown>);
      return;
    }
    for (const val of Object.values(rec)) {
      walk(val);
    }
  }

  walk(rawJson);

  const seenVideoIds = new Set<string>();
  const results: InnerTubeParsedTrack[] = [];
  for (const item of renderers) {
    const playlistItemData = item.playlistItemData as { videoId?: string } | undefined;
    const videoId = playlistItemData?.videoId;
    if (!videoId || !isValidYouTubeVideoId(videoId) || seenVideoIds.has(videoId)) continue;

    // Podcast episodes share the same renderer but are not music
    if (readMusicVideoType(item.overlay).includes('PODCAST')) continue;

    // Extract thumbnail
    const thumbObj = item.thumbnail as {
      musicThumbnailRenderer?: {
        thumbnail?: { thumbnails?: Array<{ url?: string }> };
      };
    } | undefined;
    const thumbs = thumbObj?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];

    // Extract flexColumns text runs
    const flexCols = (item.flexColumns as Array<{
      musicResponsiveListItemFlexColumnRenderer?: { text?: TextRuns };
    }>) || [];

    const colStrings = flexCols.map((col) =>
      joinRuns(col.musicResponsiveListItemFlexColumnRenderer?.text)
    );

    const title = colStrings[0] || 'Unknown Title';
    const metaParts = (colStrings[1] || '').split('•').map((s) => s.trim()).filter(Boolean);

    // Classify each "•"-separated part: clock duration, play count, or a name (artist, then album)
    let durationMs = 0;
    let playsText = colStrings[2] || '';
    let isVideoResult = false;
    const nameParts: string[] = [];
    for (const part of metaParts) {
      const clockMs = parseClockDurationMs(part);
      if (clockMs > 0) {
        durationMs = clockMs;
      } else if (looksLikePlayCount(part)) {
        isVideoResult = true;
        if (!playsText) playsText = part;
      } else {
        nameParts.push(part);
      }
    }

    if (durationMs > MAX_PLAYABLE_TRACK_DURATION_MS) continue;

    seenVideoIds.add(videoId);
    results.push({
      videoId,
      title,
      artist: nameParts[0] || 'YouTube Music Artist',
      album: nameParts[1] || (isVideoResult ? 'YouTube Music' : `${title} (Single)`),
      durationMs: durationMs || 210000,
      thumbnailUrl: pickThumbnailUrl(thumbs, videoId),
      playsText: playsText || undefined,
    });
  }

  return results;
}

/** One page of an `RDAMVM` radio: its tracks and the token of the next page (`null` = exhausted). */
export interface InnerTubeRadioPage {
  tracks: InnerTubeParsedTrack[];
  continuation: string | null;
}

/** Longest radio continuation token accepted from YouTube Music or from API callers. */
export const MAX_RADIO_CONTINUATION_LENGTH = 1024;

/**
 * Validates a radio continuation token in linear time (no regular expression): a string of at most
 * 1024 characters drawn only from `[A-Za-z0-9_\-%=.]`. Returns `''` for anything else.
 */
export function sanitizeRadioContinuation(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RADIO_CONTINUATION_LENGTH) {
    return '';
  }
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const isAlphaNum =
      (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    const isAllowedSymbol =
      code === 95 /* _ */ || code === 45 /* - */ || code === 37 /* % */ || code === 61 /* = */ || code === 46; /* . */
    if (!isAlphaNum && !isAllowedSymbol) return '';
  }
  return raw;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectPanelVideoRenderers(root: unknown): Array<Record<string, unknown>> {
  const renderers: Array<Record<string, unknown>> = [];
  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    if (rec.playlistPanelVideoRenderer && typeof rec.playlistPanelVideoRenderer === 'object') {
      renderers.push(rec.playlistPanelVideoRenderer as Record<string, unknown>);
      return;
    }
    for (const val of Object.values(rec)) {
      walk(val);
    }
  }
  walk(root);
  return renderers;
}

/** Depth-bounded search for the first `playlistPanelRenderer` of a first WatchNext page. */
function findPlaylistPanelRenderer(root: unknown): Record<string, unknown> | null {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    const rec = asRecord(value);
    if (!rec && !Array.isArray(value)) continue;
    if (depth > 16) continue;
    if (rec) {
      const panel = asRecord(rec.playlistPanelRenderer);
      if (panel) return panel;
    }
    const children = Array.isArray(value) ? value : Object.values(rec!);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ value: children[i], depth: depth + 1 });
    }
  }
  return null;
}

/** `continuations[0].nextRadioContinuationData.continuation` of a playlist panel, validated. */
function readNextRadioContinuation(panel: Record<string, unknown> | null): string | null {
  const continuations = panel?.continuations;
  if (!Array.isArray(continuations)) return null;
  const data = asRecord(asRecord(continuations[0])?.nextRadioContinuationData);
  return sanitizeRadioContinuation(data?.continuation) || null;
}

function parsePanelVideoRenderers(
  renderers: Array<Record<string, unknown>>,
  excludeVideoId?: string
): InnerTubeParsedTrack[] {
  const seenVideoIds = new Set<string>();
  if (excludeVideoId) {
    seenVideoIds.add(excludeVideoId);
  }

  const results: InnerTubeParsedTrack[] = [];
  for (const item of renderers) {
    const videoId = typeof item.videoId === 'string' ? item.videoId.trim() : '';
    if (!videoId || !isValidYouTubeVideoId(videoId) || seenVideoIds.has(videoId)) continue;
    seenVideoIds.add(videoId);

    const title = joinRuns(item.title as TextRuns) || 'Unknown Title';
    const shortArtist = joinRuns(item.shortBylineText as TextRuns);
    const longParts = joinRuns(item.longBylineText as TextRuns)
      .split('•')
      .map((s) => s.trim())
      .filter(Boolean);

    const artist = shortArtist || longParts[0] || 'YouTube Music Artist';
    const album =
      longParts.length >= 2 && !looksLikePlayCount(longParts[1])
        ? longParts[1]
        : 'YouTube Music Radio';

    // Skip live streams and hour-long mixes: a radio queue should only contain songs
    const timeStr = joinRuns(item.lengthText as TextRuns);
    let durationMs = 210000;
    if (timeStr) {
      durationMs = parseClockDurationMs(timeStr);
      if (durationMs <= 0 || durationMs > MAX_PLAYABLE_TRACK_DURATION_MS) continue;
    }

    const thumbs =
      (item.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined)?.thumbnails || [];

    results.push({
      videoId,
      title,
      artist,
      album,
      durationMs,
      thumbnailUrl: pickThumbnailUrl(thumbs, videoId),
    });
  }

  return results;
}

/**
 * Pure parser for one YouTube Music `youtubei/v1/next` (`playlistId: "RDAMVM" + videoId`) radio
 * page (`playlistPanelVideoRenderer` items). A continuation answer repeats the first page under
 * `contents`, so when `continuationContents.playlistPanelContinuation` is present ONLY that part is
 * read, for both the tracks and the next token.
 */
export function parseInnerTubeWatchNextPage(
  rawJson: unknown,
  excludeVideoId?: string
): InnerTubeRadioPage {
  const continuationPanel = asRecord(
    asRecord(asRecord(rawJson)?.continuationContents)?.playlistPanelContinuation
  );
  if (continuationPanel) {
    return {
      tracks: parsePanelVideoRenderers(
        collectPanelVideoRenderers(continuationPanel.contents),
        excludeVideoId
      ),
      continuation: readNextRadioContinuation(continuationPanel),
    };
  }
  return {
    tracks: parsePanelVideoRenderers(collectPanelVideoRenderers(rawJson), excludeVideoId),
    continuation: readNextRadioContinuation(findPlaylistPanelRenderer(rawJson)),
  };
}

/* -------------------------------------------------------------------------------------------- *
 * Shared InnerTube request layer (used by the Express proxy AND by the native app shell, which
 * talks to YouTube Music directly because no Node backend runs inside an Android / iOS package).
 * -------------------------------------------------------------------------------------------- */

export const INNERTUBE_API_ORIGIN = 'https://music.youtube.com';

export const INNERTUBE_ENDPOINT_URLS = {
  search: `${INNERTUBE_API_ORIGIN}/youtubei/v1/search?prettyPrint=false`,
  next: `${INNERTUBE_API_ORIGIN}/youtubei/v1/next?prettyPrint=false`,
} as const;

export type InnerTubeEndpoint = keyof typeof INNERTUBE_ENDPOINT_URLS;

export const INNERTUBE_CLIENT_CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240717.01.00',
    hl: 'en',
    gl: 'US',
  },
} as const;

/**
 * Search filters tried in order. The "Songs" filter returns nothing in regions (and on networks)
 * where YouTube Music has no song catalog, so the "Videos" filter is the mandatory fallback.
 */
export const INNERTUBE_SEARCH_FILTERS = [
  { name: 'songs', params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D' },
  { name: 'videos', params: 'EgWKAQIQAWoKEAQQBRAVEBAQEQ%3D%3D' },
] as const;

export function buildInnerTubeSearchBody(query: string, params: string): Record<string, unknown> {
  return { context: INNERTUBE_CLIENT_CONTEXT, query, params };
}

function decodeContinuationToken(token: string): string {
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

/**
 * WatchNext body for the `RDAMVM` radio of `seedVideoId`. The next page is requested by re-sending
 * the same body plus the URL-decoded `continuation` token of the previous page.
 */
export function buildInnerTubeNextBody(
  seedVideoId: string,
  continuation?: string
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    context: INNERTUBE_CLIENT_CONTEXT,
    videoId: seedVideoId,
    playlistId: `RDAMVM${seedVideoId}`,
    isAudioOnly: true,
    enablePersistentPlaylistPanel: true,
  };
  if (continuation) body.continuation = decodeContinuationToken(continuation);
  return body;
}

/** Performs one InnerTube POST and resolves with the decoded JSON body (rejects on HTTP errors). */
export type InnerTubeTransport = (
  endpoint: InnerTubeEndpoint,
  body: Record<string, unknown>
) => Promise<unknown>;

/**
 * Searches YouTube Music, falling back from the "Songs" filter to the "Videos" filter when the
 * first one comes back empty. Throws only when every attempt failed at the transport level.
 */
export async function searchInnerTubeTracks(
  transport: InnerTubeTransport,
  query: string
): Promise<InnerTubeParsedTrack[]> {
  let lastError: unknown = null;
  let anySucceeded = false;

  for (const filter of INNERTUBE_SEARCH_FILTERS) {
    try {
      const raw = await transport('search', buildInnerTubeSearchBody(query, filter.params));
      anySucceeded = true;
      const tracks = parseInnerTubeSearchResponse(raw);
      if (tracks.length > 0) return tracks;
    } catch (err) {
      lastError = err;
    }
  }

  if (!anySucceeded && lastError) throw lastError;
  return [];
}

/**
 * Fetches one page of the `RDAMVM` radio (Up Next recommendations) for a seed video: the first page
 * without `continuation`, the following ones with the token of the previous page.
 */
export async function fetchInnerTubeRadioPage(
  transport: InnerTubeTransport,
  seedVideoId: string,
  continuation?: string
): Promise<InnerTubeRadioPage> {
  const raw = await transport('next', buildInnerTubeNextBody(seedVideoId, continuation));
  return parseInnerTubeWatchNextPage(raw, seedVideoId);
}

/* -------------------------------------------------------------------------------------------- *
 * Song search terms (used to find an alternate upload when a video fails to play)
 * -------------------------------------------------------------------------------------------- */

function stripAllBracketedSegmentsLinear(input: string): string {
  const capped = input.slice(0, 256);
  let out = '';
  let roundDepth = 0;
  let squareDepth = 0;
  for (let i = 0; i < capped.length; i++) {
    const ch = capped[i];
    if (ch === '(') roundDepth++;
    else if (ch === ')') roundDepth = Math.max(0, roundDepth - 1);
    else if (ch === '[') squareDepth++;
    else if (ch === ']') squareDepth = Math.max(0, squareDepth - 1);
    else if (roundDepth === 0 && squareDepth === 0) out += ch;
  }
  return out.split(' ').filter(Boolean).join(' ');
}

function normalizeForComparison(input: string): string {
  let out = '';
  const lower = input.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i);
    const isAlphaNum = (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code > 127;
    if (isAlphaNum) out += lower[i];
  }
  return out;
}

/**
 * Turns a YouTube-style title (`Kavinsky - Nightcall (Official Audio)` uploaded by `Record Makers`)
 * into clean song search terms (`Nightcall` / `Kavinsky`). Linear time, no regular expressions.
 */
export function deriveSongSearchTerms(
  rawTitle: string,
  rawArtist: string
): { trackName: string; artistName: string } {
  const title = stripAllBracketedSegmentsLinear(rawTitle);
  let artistName = rawArtist.trim().slice(0, 120);
  if (artistName.toLowerCase().endsWith(' - topic')) {
    artistName = artistName.slice(0, -' - topic'.length).trim();
  }
  let trackName = title || rawTitle.trim().slice(0, 120);

  const dashIdx = title.indexOf(' - ');
  if (dashIdx > 0) {
    const left = title.slice(0, dashIdx).trim();
    const right = title.slice(dashIdx + 3).trim();
    const leftNorm = normalizeForComparison(left);
    let artistNorm = normalizeForComparison(artistName);
    if (artistNorm.endsWith('vevo')) artistNorm = artistNorm.slice(0, -4);
    if (artistNorm.endsWith('official')) artistNorm = artistNorm.slice(0, -8);

    // "Artist - Song" uploads: the uploader is the artist (or their VEVO / official channel)
    const leftIsArtist =
      leftNorm.length > 0 &&
      artistNorm.length > 0 &&
      (leftNorm.includes(artistNorm) || artistNorm.includes(leftNorm));
    if (leftIsArtist && right) {
      artistName = left;
      trackName = right;
    }
  }

  return { trackName, artistName };
}

/**
 * Production API Input Sanitizer & YouTube VideoID Validator
 * Strips control characters, HTML angle brackets, and enforces strict length bounds
 * in O(N) linear time without regular expressions.
 */
export function sanitizeApiQueryText(raw: unknown, maxLength: number = 120): string {
  if (typeof raw !== 'string') return '';
  const limit = Math.min(raw.length, 512);
  let out = '';
  let prevSpace = true;

  for (let i = 0; i < limit; i++) {
    const code = raw.charCodeAt(i);
    const ch = raw[i];
    const isControlOrBracket =
      code <= 0x1f || code === 0x7f || ch === '<' || ch === '>';
    const isWhitespace =
      isControlOrBracket || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

    if (isWhitespace) {
      if (!prevSpace && out.length < maxLength) {
        out += ' ';
        prevSpace = true;
      }
    } else {
      if (out.length < maxLength) {
        out += ch;
        prevSpace = false;
      }
    }
  }

  return out.trim();
}

export function isValidYouTubeVideoId(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return /^[A-Za-z0-9_-]{11}$/.test(raw.trim());
}
