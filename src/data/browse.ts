/** Static content of the Search "Browse" grid and the Home page (no network needed to show it). */

export interface BrowseTile {
  label: string;
  /** What the tile searches for. */
  query: string;
  /** Tile background (Tailwind classes, kept literal so the build sees them). */
  className: string;
}

export const BROWSE_TILES: readonly BrowseTile[] = [
  { label: 'Pop', query: 'pop hits', className: 'bg-rose-600' },
  { label: 'Hip-Hop', query: 'hip hop', className: 'bg-amber-600' },
  { label: 'Bollywood', query: 'bollywood hits', className: 'bg-orange-600' },
  { label: 'Lo-fi', query: 'lofi beats', className: 'bg-indigo-600' },
  { label: 'Chill', query: 'chill vibes', className: 'bg-teal-600' },
  { label: 'Workout', query: 'workout music', className: 'bg-red-700' },
  { label: 'Rock', query: 'rock classics', className: 'bg-slate-600' },
  { label: 'Indie', query: 'indie', className: 'bg-lime-700' },
  { label: 'Electronic', query: 'electronic music', className: 'bg-violet-600' },
  { label: 'Jazz', query: 'jazz', className: 'bg-sky-700' },
  { label: 'K-Pop', query: 'k-pop', className: 'bg-pink-600' },
  { label: 'Party', query: 'party songs', className: 'bg-fuchsia-700' },
];

/** Live search behind "Popular right now" on a fresh install. */
export const POPULAR_QUERY = 'top hits';

/** Artists offered on Home until the listener's own history suggests some. */
export const FEATURED_ARTISTS: readonly string[] = [
  'Taylor Swift',
  'Arijit Singh',
  'The Weeknd',
  'BTS',
  'Daft Punk',
  'Billie Eilish',
];
