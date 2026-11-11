/**
 * Picks another upload of the same song when a video cannot be played (its owner disabled playback
 * in other apps, it was removed, …). Pure and linear-time (no regular expression runs over a whole
 * title: CLAUDE.md §5.3).
 *
 * A search for "<artist> <title>" returns the song, but also covers, remixes, "slowed + reverb"
 * edits, karaoke tracks, hour-long loops and other songs of the artist. Each candidate is scored:
 * - title similarity (token overlap of the titles without brackets and artist names): up to 45,
 *   and below half the tokens in common the candidate is not the same song at all;
 * - the artist: 30 when the uploader, a side of an "Artist - Title" title, or the title itself names
 *   the original's artist (or both titles are the same "A - B" pair). Without it a candidate cannot
 *   reach the minimum score: the same title from an unrelated channel is often an unlabelled cover;
 * - duration (when both are known): within 15 s 25 points, fading to 0 at 60 s, rejected beyond;
 * - minus 50 for every kind of version marker (cover, remix, live / TV performance, dance
 *   practice, chipmunk, lo-fi, acoustic, reprise, bass boosted, …) only one of the two titles has.
 *
 * Credit lists: an artist credit can name several people ("A, B & C", "A feat. B", "A x B"); the full
 * compact credit and each individual name (4+ letters) all count as the artist's names.
 * Segments: Bollywood-style titles are "Song | Movie | Cast | Singers" or "Song - Movie - Singers -
 * 320Kbps"; a segmented title is compared by its first `|` / dash / bullet segment that is not
 * only artist names or noise words (later segments are the movie, cast or singers, so another song
 * of the same movie never matches on them). Noise words (official, lyrical, full, song, kbps, …) are ignored.
 * Anything under `MIN_ALTERNATE_SCORE` is never played: skipping is better than a wrong song.
 */
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';

export const MIN_ALTERNATE_SCORE = 75;
/** How many of the best candidates are checked for embeddability before one is chosen. */
export const ALTERNATE_CANDIDATES_TO_CHECK = 3;

const TITLE_WEIGHT = 45;
const ARTIST_WEIGHT = 30;
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
  remake: 'cover',
  rendition: 'cover',
  reaction: 'reaction',
  mashup: 'mashup',
  performance: 'live',
  festival: 'live',
  concert: 'live',
  tour: 'live',
  fancam: 'live',
  stage: 'live',
  dance: 'dance',
  practice: 'dance',
  choreography: 'dance',
  mirrored: 'dance',
  chipmunk: 'chipmunk',
  chipmunks: 'chipmunk',
  chipmunked: 'chipmunk',
  lofi: 'lofi',
  acoustic: 'acoustic',
  unplugged: 'live',
  reprise: 'reprise',
  female: 'female',
  male: 'male',
  ringtone: 'ringtone',
  teaser: 'teaser',
  trailer: 'teaser',
  reverbed: 'reverb',
};

/** Words that say nothing about which song it is. */
const NOISE_WORDS = new Set(['official', 'video', 'audio', 'lyrics', 'lyric', 'hd', 'hq', 'mv', 'visualizer', 'ft', 'feat', 'featuring',
  'full', 'song', 'songs', 'lyrical', 'kbps', '320kbps', '128kbps', '256kbps',
]);

/** Separators of an artist credit list; the word-like ones need spaces around them. */
const CREDIT_SEPARATORS = [',', '&', '/', '+', ' x ', ' and ', ' feat. ', ' feat ', ' ft. ', ' ft ', ' featuring ', ' with '];
const MIN_INDIVIDUAL_NAME_LENGTH = 4;
/** Separators of the parts of a title ("Song | Movie", "Song - Singers"). */
const SEGMENT_SEPARATORS = ['|', ' - ', ' \u2013 ', ' \u2014 ', ' \u2022 '];

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

/** Splits `text` at every separator (case-insensitive, one pass). */
function splitOn(text: string, separators: readonly string[]): string[] {
  const capped = text.slice(0, MAX_TEXT_LENGTH);
  const lower = capped.toLowerCase();
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  while (i < lower.length) {
    let matched = 0;
    for (const sep of separators) {
      if (lower.startsWith(sep, i)) {
        matched = sep.length;
        break;
      }
    }
    if (matched > 0 && lower.length === capped.length) {
      parts.push(capped.slice(start, i));
      i += matched;
      start = i;
    } else {
      i++;
    }
  }
  parts.push(capped.slice(start));
  return parts;
}

/** Compact names of an artist credit: the whole credit, then each listed person (4+ letters). */
function creditNames(credit: string): string[] {
  const names = [compactArtist(credit)];
  const parts = splitOn(credit, CREDIT_SEPARATORS);
  if (parts.length > 1) {
    for (const part of parts) {
      const compact = compactArtist(part);
      if (compact.length >= MIN_INDIVIDUAL_NAME_LENGTH && !names.includes(compact)) names.push(compact);
    }
  }
  return names;
}

/** The two sides of an "A - B" title (first " - ", " \u2013 " or " \u2014 "; brackets removed), or none. */
function dashSides(title: string): string[] {
  const stripped = withoutBrackets(title);
  let dash = -1;
  for (const sep of [' - ', ' \u2013 ', ' \u2014 ']) {
    const at = stripped.indexOf(sep);
    if (at > 0 && (dash < 0 || at < dash)) dash = at;
  }
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
  const raw = words(withoutBrackets(title));
  const meaningful = raw.filter((w) => !NOISE_WORDS.has(w));
  // A title made only of noise words ("Song") keeps them
  const all = meaningful.length > 0 ? meaningful : raw;
  const core = all.filter((w) => !artistWords.has(w));
  return new Set(core.length > 0 ? core : all);
}

/**
 * The words that name the song: a segmented title's first segment that says something besides
 * artist names and noise ("Lyrical | Humsafar Song | Saiyaara | Cast | Singers" → humsafar), else
 * the whole title. Later segments are the movie, cast or singers: another song of the same movie
 * by the same singers must not match on them.
 */
function songNameWords(title: string, artistWords: ReadonlySet<string>): Set<string> {
  const stripped = withoutBrackets(title);
  const segments = splitOn(stripped, SEGMENT_SEPARATORS);
  if (segments.length > 1) {
    for (const segment of segments) {
      const core = words(segment).filter((w) => !NOISE_WORDS.has(w) && !artistWords.has(w));
      if (core.length > 0) return new Set(core);
    }
  }
  return titleWords(stripped, artistWords);
}

function markersOf(title: string): Set<string> {
  const found = new Set<string>();
  const list = words(title);
  for (let i = 0; i < list.length; i++) {
    const marker = Object.prototype.hasOwnProperty.call(VERSION_MARKERS, list[i]) ? VERSION_MARKERS[list[i]] : undefined;
    if (marker) found.add(marker);
    if (list[i] === 'speed' && list[i + 1] === 'up') found.add('sped');
    if (list[i] === 'lo' && list[i + 1] === 'fi') found.add('lofi');
    if (list[i] === 'bass' && list[i + 1] === 'boosted') found.add('bassboost');
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
  // title that is exactly an uploader's name (`Kavinsky - Nightcall` uploaded by `Kavinsky - Topic`),
  // or both sides when the two titles are the same "A - B" pair (two re-uploads, in either order)
  const originalCredit = creditNames(original.artist);
  const candidateCredit = creditNames(candidate.artist);
  const uploaders = [...originalCredit, ...candidateCredit].filter((n) => n.length >= 2);
  const originalSides = dashSides(original.title);
  const candidateSides = dashSides(candidate.title);
  const sideKey = (sides: string[]) => sides.map(compactArtist).sort().join(' ');
  const samePair = originalSides.length === 2 && sideKey(originalSides) === sideKey(candidateSides);
  const artistWords = new Set([...words(original.artist), ...words(candidate.artist)]);
  const namesOf = (credit: string[], sides: string[]) => {
    const names = [...credit];
    for (const side of sides) {
      const compact = compactArtist(side);
      if (compact.length >= 2 && (samePair || uploaders.includes(compact))) {
        names.push(compact);
        for (const w of words(side)) artistWords.add(w);
      }
    }
    return names.filter((n) => n.length >= 2);
  };
  const originalArtists = namesOf(originalCredit, originalSides);
  const candidateArtists = namesOf(candidateCredit, candidateSides);

  const similarity = diceSimilarity(songNameWords(original.title, artistWords), songNameWords(candidate.title, artistWords));
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

  // A marker on one side only means another recording, in both directions (a karaoke track is not
  // replaced by the vocal original either)
  const originalMarkers = markersOf(original.title);
  const candidateMarkers = markersOf(candidate.title);
  for (const marker of candidateMarkers) if (!originalMarkers.has(marker)) score -= MARKER_PENALTY;
  for (const marker of originalMarkers) if (!candidateMarkers.has(marker)) score -= MARKER_PENALTY;
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
