/**
 * Picks another upload of the same song when a video cannot be played (its owner disabled playback
 * in other apps, it was removed, …). Pure and linear-time (no regular expression runs over a whole
 * title: CLAUDE.md §5.3).
 *
 * A search for "<artist> <title>" returns the song, but also covers, remixes, "slowed + reverb"
 * edits, karaoke tracks, hour-long loops and other songs of the artist. Each candidate is scored:
 * - title similarity (token overlap of the titles without brackets and artist names): up to 55,
 *   and below half the tokens in common the candidate is not the same song at all;
 * - the artist: the uploader, or the "Artist - Title" prefix, names the original's artist: 20;
 * - duration (when both are known): within 15 s 25 points, fading to 0 at 60 s, rejected beyond;
 * - minus 50 for every version marker (cover, remix, live, …) the original title does not have.
 * Anything under `MIN_ALTERNATE_SCORE` is never played: skipping is better than a wrong song.
 */
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';

export const MIN_ALTERNATE_SCORE = 60;
/** How many of the best candidates are checked for embeddability before one is chosen. */
export const ALTERNATE_CANDIDATES_TO_CHECK = 3;

const TITLE_WEIGHT = 55;
const ARTIST_WEIGHT = 20;
const DURATION_WEIGHT = 25;
const MARKER_PENALTY = 50;
const MIN_TITLE_SIMILARITY = 0.5;
const DURATION_EXACT_MS = 15000;
const DURATION_REJECT_MS = 60000;
/** Durations the parsers / player core use when the real one is not known (never compared). */
const PLACEHOLDER_DURATIONS_MS = new Set([210000, 218000]);
const MAX_TEXT_LENGTH = 300;

/** Version markers: a candidate with one the original lacks is a different recording. */
const VERSION_MARKERS: Record<string, string> = {
  cover: 'cover',
  covers: 'cover',
  karaoke: 'karaoke',
  remix: 'remix',
  remixes: 'remix',
  slowed: 'slowed',
  reverb: 'reverb',
  sped: 'sped',
  nightcore: 'nightcore',
  '8d': '8d',
  live: 'live',
  instrumental: 'instrumental',
  piano: 'piano',
  tutorial: 'tutorial',
  lesson: 'tutorial',
  extended: 'extended',
  hour: 'hour',
  hours: 'hour',
  reaction: 'reaction',
  mashup: 'mashup',
};

/** Words that say nothing about which song it is. */
const NOISE_WORDS = new Set(['official', 'video', 'audio', 'lyrics', 'lyric', 'hd', 'hq', 'mv', 'visualizer', 'ft', 'feat', 'featuring']);

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Lower-case words of `text` (letters and digits of any script), in one pass. */
function words(text: string): string[] {
  const capped = text.slice(0, MAX_TEXT_LENGTH).toLowerCase();
  const out: string[] = [];
  let current = '';
  for (const ch of capped) {
    if (LETTER_OR_DIGIT.test(ch)) {
      current += ch;
    } else if (current) {
      out.push(current);
      current = '';
    }
  }
  if (current) out.push(current);
  return out;
}

/** `text` without anything in ( ) or [ ] brackets. */
function withoutBrackets(text: string): string {
  let out = '';
  let depth = 0;
  for (const ch of text.slice(0, MAX_TEXT_LENGTH)) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

/** `Kavinsky - Topic`, `TheWeekndVEVO`, `Oasis Official` → the artist's compact name. */
function compactArtist(name: string): string {
  let compact = words(name).join('');
  for (const suffix of ['topic', 'vevo', 'official']) {
    if (compact.length > suffix.length && compact.endsWith(suffix)) compact = compact.slice(0, -suffix.length);
  }
  return compact;
}

/** The two sides of an "A - B" title (brackets removed), or none. */
function dashSides(title: string): string[] {
  const stripped = withoutBrackets(title);
  const dash = stripped.indexOf(' - ');
  return dash > 0 ? [stripped.slice(0, dash), stripped.slice(dash + 3)] : [];
}

function diceSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const word of a) if (b.has(word)) common++;
  return (2 * common) / (a.size + b.size);
}

/** Title words without brackets, noise words and artist names (unless nothing else is left). */
function titleWords(title: string, artistWords: ReadonlySet<string>): Set<string> {
  const all = words(withoutBrackets(title)).filter((w) => !NOISE_WORDS.has(w));
  const core = all.filter((w) => !artistWords.has(w));
  return new Set(core.length > 0 ? core : all);
}

function markersOf(title: string): Set<string> {
  const found = new Set<string>();
  const list = words(title);
  for (let i = 0; i < list.length; i++) {
    const marker = Object.prototype.hasOwnProperty.call(VERSION_MARKERS, list[i]) ? VERSION_MARKERS[list[i]] : undefined;
    if (marker) found.add(marker);
    if (list[i] === 'speed' && list[i + 1] === 'up') found.add('sped');
  }
  return found;
}

function isKnownDuration(ms: number): boolean {
  return Number.isFinite(ms) && ms > 30000 && !PLACEHOLDER_DURATIONS_MS.has(ms);
}

export interface AlternateOriginal {
  title: string;
  artist: string;
  durationMs: number;
}

/** Score of `candidate` as another upload of `original` (higher is better), or `null` = never. */
export function scoreAlternateUpload(original: AlternateOriginal, candidate: InnerTubeParsedTrack): number | null {
  // Who is named as the artist: the uploaders, plus a side of an "Artist - Title" / "Title - Artist"
  // title that is exactly an uploader's name (`Kavinsky - Nightcall` uploaded by `Kavinsky - Topic`)
  const uploaders = [compactArtist(original.artist), compactArtist(candidate.artist)].filter((n) => n.length >= 2);
  const artistWords = new Set([...words(original.artist), ...words(candidate.artist)]);
  const namesOf = (track: AlternateOriginal) => {
    const names = [compactArtist(track.artist)];
    for (const side of dashSides(track.title)) {
      const compact = compactArtist(side);
      if (compact.length >= 2 && uploaders.includes(compact)) {
        names.push(compact);
        for (const w of words(side)) artistWords.add(w);
      }
    }
    return names.filter((n) => n.length >= 2);
  };
  const originalArtists = namesOf(original);
  const candidateArtists = namesOf(candidate);

  const similarity = diceSimilarity(titleWords(original.title, artistWords), titleWords(candidate.title, artistWords));
  if (similarity < MIN_TITLE_SIMILARITY) return null;
  let score = TITLE_WEIGHT * similarity;

  const originalTitleCompact = words(original.title).join('');
  const candidateTitleCompact = words(candidate.title).join('');
  const artistMatches =
    originalArtists.some((a) => candidateArtists.some((b) => a.includes(b) || b.includes(a))) ||
    originalArtists.some((a) => candidateTitleCompact.includes(a)) ||
    candidateArtists.some((b) => originalTitleCompact.includes(b));
  if (artistMatches) score += ARTIST_WEIGHT;

  if (isKnownDuration(original.durationMs) && isKnownDuration(candidate.durationMs)) {
    const delta = Math.abs(original.durationMs - candidate.durationMs);
    if (delta > DURATION_REJECT_MS) return null;
    score +=
      delta <= DURATION_EXACT_MS
        ? DURATION_WEIGHT
        : (DURATION_WEIGHT * (DURATION_REJECT_MS - delta)) / (DURATION_REJECT_MS - DURATION_EXACT_MS);
  }

  const originalMarkers = markersOf(original.title);
  for (const marker of markersOf(candidate.title)) {
    if (!originalMarkers.has(marker)) score -= MARKER_PENALTY;
  }
  return Math.round(score * 10) / 10;
}

export interface RankedAlternate {
  candidate: InnerTubeParsedTrack;
  score: number;
}

/** Acceptable candidates (not tried yet, at least `MIN_ALTERNATE_SCORE`), best first; ties keep search order. */
export function rankAlternateUploads(
  original: AlternateOriginal,
  candidates: readonly InnerTubeParsedTrack[],
  tried: readonly string[]
): RankedAlternate[] {
  const triedSet = new Set(tried);
  const seen = new Set<string>();
  const ranked: RankedAlternate[] = [];
  for (const candidate of candidates) {
    if (triedSet.has(candidate.videoId) || seen.has(candidate.videoId)) continue;
    seen.add(candidate.videoId);
    const score = scoreAlternateUpload(original, candidate);
    if (score !== null && score >= MIN_ALTERNATE_SCORE) ranked.push({ candidate, score });
  }
  // Array.prototype.sort is stable: equal scores keep the search order
  return ranked.sort((a, b) => b.score - a.score);
}

/**
 * The upload to play: the best candidate known to be embeddable, else the best whose embeddability
 * is unknown (the check failed: it counts as playable). Never one known not to be embeddable.
 */
export function chooseAlternateUpload(
  ranked: readonly RankedAlternate[],
  embeddable: (videoId: string) => boolean | null | undefined
): InnerTubeParsedTrack | null {
  let unknown: InnerTubeParsedTrack | null = null;
  for (const { candidate } of ranked) {
    const known = embeddable(candidate.videoId);
    if (known === true) return candidate;
    if (known !== false && !unknown) unknown = candidate;
  }
  return unknown;
}
