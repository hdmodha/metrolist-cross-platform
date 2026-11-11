/**
 * Can a YouTube video be played in the embedded player (outside youtube.com)? Shared by the server
 * route `GET /api/innertube/embeddable` and the native shell's direct path (`apiClient.ts`).
 *
 * YouTube's public oEmbed endpoint answers 401 for videos whose owner disabled embedding (and 403 /
 * 404 for private or removed ones), 200 otherwise. It does not catch every restriction (some label
 * videos pass and still raise player error 150), so the player's runtime recovery stays; `null`
 * (unknown) always counts as playable.
 */
import { isValidYouTubeVideoId } from './metrolistCore';

/** `true` embeddable, `false` not, `null` unknown (the check failed or was inconclusive). */
export type Embeddability = boolean | null;

export const OEMBED_ORIGIN = 'https://www.youtube.com';
const OEMBED_ENDPOINT = `${OEMBED_ORIGIN}/oembed`;
/** Most ids one `/api/innertube/embeddable` request may ask about. */
export const MAX_EMBEDDABLE_IDS = 10;
const MAX_IDS_PARAM_LENGTH = MAX_EMBEDDABLE_IDS * 12 + 32;

/** The fixed oEmbed URL for one video (throws for an invalid id; the origin is checked). */
export function buildOEmbedUrl(videoId: string): URL {
  if (!isValidYouTubeVideoId(videoId) || videoId.trim() !== videoId) throw new Error('Invalid video id.');
  const url = new URL(OEMBED_ENDPOINT);
  url.searchParams.set('format', 'json');
  url.searchParams.set('url', `https://www.youtube.com/watch?v=${videoId}`);
  if (url.origin !== OEMBED_ORIGIN) throw new Error('Invalid oEmbed origin.');
  return url;
}

export function embeddabilityFromOEmbedStatus(status: number): Embeddability {
  if (status === 200) return true;
  if (status === 401 || status === 403 || status === 404) return false;
  return null;
}

/** `ids=a,b,c` → the unique valid ids (1 to 10), or `null` when the parameter is invalid. */
export function parseEmbeddableIds(raw: unknown): string[] | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_IDS_PARAM_LENGTH) return null;
  const ids: string[] = [];
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (!isValidYouTubeVideoId(id)) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length > 0 && ids.length <= MAX_EMBEDDABLE_IDS ? ids : null;
}

/** Reads `{ results: { [id]: true | false | null } }` for `ids`; anything missing or odd is `null`. */
export function readEmbeddabilityResults(data: unknown, ids: readonly string[]): Record<string, Embeddability> {
  const results =
    data && typeof data === 'object' && !Array.isArray(data) ? (data as { results?: unknown }).results : undefined;
  const record = results && typeof results === 'object' && !Array.isArray(results) ? (results as Record<string, unknown>) : {};
  const out: Record<string, Embeddability> = {};
  for (const id of ids) {
    const value = Object.prototype.hasOwnProperty.call(record, id) ? record[id] : null;
    out[id] = value === true || value === false ? value : null;
  }
  return out;
}
