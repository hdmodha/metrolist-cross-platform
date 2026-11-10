import React from 'react';
import {
  Play,
  Pause,
  Heart,
  Download,
  Check,
  Search,
  Clock,
  Loader2,
  Radio,
  Sparkles,
  X,
  RotateCw,
  ListStart,
  ListEnd,
} from 'lucide-react';
import type { MetrolistTrack } from '../data/metrolistData';
import { STATIC_YTM_FALLBACK } from '../data/fallbackTracks';
import { liveTrackId, type TrackInput } from '../player/playerCore';
import { searchTracks } from '../utils/apiClient';
import { formatDurationMs, type InnerTubeParsedTrack } from '../utils/metrolistCore';
import { countRender } from '../utils/renderProbe';
import type { LibraryFilter } from './AppHeader';
import { TrackMenu, type TrackMenuItem } from './TrackMenu';

const QUICK_YTM_PICKS = [
  { label: 'Daft Punk', query: 'Daft Punk' },
  { label: 'The Weeknd', query: 'The Weeknd' },
  { label: 'Radiohead', query: 'Radiohead' },
  { label: 'Kavinsky', query: 'Kavinsky' },
  { label: 'Tame Impala', query: 'Tame Impala' },
  { label: 'Fred again..', query: 'Fred again..' },
];

const SEARCH_DEBOUNCE_MS = 320;
const MIN_SEARCH_LENGTH = 2;
const MAX_SEARCH_RESULTS = 12;
const MAX_SHELF_ITEMS = 6;

/** A query long enough to switch the view into search mode. */
export function isSearchQuery(query: string): boolean {
  return query.trim().length >= MIN_SEARCH_LENGTH;
}

type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; tracks: InnerTubeParsedTrack[] }
  | { status: 'error'; query: string };

/** Queue / like / download handlers shared by cards, rows and the hero. */
export interface TrackActionHandlers {
  onPlayNext: (track: TrackInput) => void;
  onAddToQueue: (track: TrackInput) => void;
  onToggleLike: (trackId: string, track?: TrackInput) => void;
  onToggleDownloaded: (trackId: string, track?: TrackInput) => void;
}

function buildMenuItems(
  id: string,
  track: TrackInput,
  flags: { liked: boolean; downloaded: boolean },
  handlers: TrackActionHandlers
): TrackMenuItem[] {
  return [
    { label: 'Play next', icon: <ListStart className="w-4 h-4" />, onSelect: () => handlers.onPlayNext(track) },
    { label: 'Add to queue', icon: <ListEnd className="w-4 h-4" />, onSelect: () => handlers.onAddToQueue(track) },
    {
      label: flags.liked ? 'Unlike' : 'Like',
      icon: <Heart className={`w-4 h-4 ${flags.liked ? 'fill-emerald-400 text-emerald-400' : ''}`} />,
      onSelect: () => handlers.onToggleLike(id, track),
    },
    {
      label: flags.downloaded ? 'Remove download' : 'Download',
      icon: flags.downloaded ? <Check className="w-4 h-4 text-indigo-400" /> : <Download className="w-4 h-4" />,
      onSelect: () => handlers.onToggleDownloaded(id, track),
    },
  ];
}

interface YtTrackCardProps extends TrackActionHandlers {
  track: InnerTubeParsedTrack;
  isCurrent: boolean;
  /** Only meaningful for the current card. */
  isPlaying: boolean;
  isLoading: boolean;
  liked: boolean;
  downloaded: boolean;
  onPlay: (track: InnerTubeParsedTrack) => void;
}

/** One-tap play card shared by the search results, artist shelf and recommendations shelf. */
const YtTrackCard = React.memo(function YtTrackCard({
  track,
  isCurrent,
  isPlaying,
  isLoading,
  liked,
  downloaded,
  onPlay,
  ...handlers
}: YtTrackCardProps) {
  const items = buildMenuItems(liveTrackId(track.videoId), track, { liked, downloaded }, handlers);
  return (
    <div
      className={`group flex items-center gap-1 rounded-xl border transition-colors min-w-0 ${
        isCurrent ? 'bg-zinc-800/95 border-emerald-500/50' : 'bg-zinc-900/70 hover:bg-zinc-800/80 border-white/5'
      }`}
    >
      <button
        type="button"
        onClick={() => onPlay(track)}
        aria-label={`${isCurrent && isPlaying ? 'Pause' : 'Play'} ${track.title} by ${track.artist}`}
        className="flex items-center gap-3 p-2.5 min-w-0 flex-1 text-left cursor-pointer rounded-xl"
      >
        <div className="relative w-12 h-12 rounded-lg overflow-hidden shrink-0 bg-zinc-950">
          <img src={track.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
          <div
            className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity ${
              isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
            }`}
          >
            {isCurrent && isLoading ? (
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
            ) : isCurrent && isPlaying ? (
              <Pause className="w-4 h-4 text-emerald-400 fill-current" />
            ) : (
              <Play className="w-4 h-4 text-white fill-current ml-0.5" />
            )}
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold truncate ${isCurrent ? 'text-emerald-400' : 'text-white'}`}>{track.title}</div>
          <div className="text-xs text-zinc-400 truncate mt-0.5">{track.artist}</div>
        </div>
        <span className="text-xs font-mono text-zinc-400 tabular-nums shrink-0">{formatDurationMs(track.durationMs)}</span>
      </button>
      <TrackMenu trackTitle={track.title} items={items} className="w-10 h-10 mr-1" />
    </div>
  );
});

interface LibraryRowProps extends TrackActionHandlers {
  track: MetrolistTrack;
  position: number;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: (track: MetrolistTrack) => void;
}

const LibraryRow = React.memo(function LibraryRow({
  track,
  position,
  isCurrent,
  isPlaying,
  onPlay,
  ...handlers
}: LibraryRowProps) {
  const items = buildMenuItems(track.id, track, { liked: track.liked, downloaded: track.cachedOffline }, handlers);
  return (
    <div
      onClick={() => onPlay(track)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        // Ignore keys that bubble up from the row's own buttons and menu
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPlay(track);
        }
      }}
      aria-label={`Play ${track.title} by ${track.artist}`}
      className={`library-row group grid grid-cols-12 items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2 transition-colors cursor-pointer ${
        isCurrent ? 'bg-white/10' : 'hover:bg-white/5'
      }`}
    >
      <div className="col-span-8 sm:col-span-6 flex items-center gap-3 min-w-0">
        <div className="w-6 text-center text-xs font-mono text-zinc-400 tabular-nums shrink-0 flex items-center justify-center">
          {isCurrent && isPlaying ? <Pause className="w-3.5 h-3.5 text-emerald-400 fill-current" /> : <span>{position}</span>}
        </div>
        <img
          src={track.coverUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-10 h-10 rounded-md object-cover shrink-0 bg-zinc-800"
        />
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold truncate ${isCurrent ? 'text-emerald-400' : 'text-white'}`}>{track.title}</div>
          <div className="text-xs text-zinc-400 truncate">{track.artist}</div>
        </div>
      </div>

      <div className="hidden sm:block sm:col-span-3 text-xs text-zinc-400 truncate">{track.album}</div>

      <div className="col-span-4 sm:col-span-3 flex items-center justify-end gap-0.5 sm:gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label={`${track.liked ? 'Unlike' : 'Like'} ${track.title}`}
          aria-pressed={track.liked}
          onClick={() => handlers.onToggleLike(track.id)}
          className={`tap-target inline-flex items-center justify-center p-1.5 rounded-full transition-colors cursor-pointer ${
            track.liked ? 'text-emerald-400' : 'text-zinc-500 hover:text-white'
          }`}
        >
          <Heart className={`w-4 h-4 ${track.liked ? 'fill-current' : ''}`} />
        </button>
        <span className="hidden min-[400px]:inline text-xs font-mono text-zinc-400 tabular-nums w-10 text-right">
          {formatDurationMs(track.durationMs)}
        </span>
        <TrackMenu trackTitle={track.title} items={items} className="w-9 h-9" />
      </div>
    </div>
  );
});

interface HeroCardProps {
  track: MetrolistTrack | null;
  isPlaying: boolean;
  onTogglePlay: () => void;
  onToggleLike: (trackId: string) => void;
  onToggleDownloaded: (trackId: string) => void;
}

const HeroCard = React.memo(function HeroCard({ track, isPlaying, onTogglePlay, onToggleLike, onToggleDownloaded }: HeroCardProps) {
  if (!track) return null;
  return (
    <section className="relative overflow-hidden rounded-2xl bg-gradient-to-b from-indigo-950/50 via-zinc-900/90 to-zinc-900/95 border border-white/10 p-4 sm:p-7">
      <div className="flex flex-col md:flex-row items-center md:items-end gap-4 sm:gap-6 short:flex-row short:items-center">
        <div className="relative w-28 h-28 sm:w-44 sm:h-44 short:w-20 short:h-20 rounded-xl overflow-hidden shadow-2xl border border-white/10 shrink-0 bg-zinc-950">
          <img src={track.coverUrl} alt={`${track.title} album cover`} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
        </div>

        <div className="w-full flex-1 min-w-0 text-center md:text-left short:text-left space-y-2.5 short:space-y-1.5">
          <div className="flex flex-wrap items-center justify-center md:justify-start short:justify-start gap-2 text-xs font-medium text-emerald-400">
            <span>Ad-Free Stream</span>
            <span aria-hidden="true">·</span>
            <span className="text-zinc-400">YouTube Music Radio Active</span>
          </div>

          <h1 className="text-xl sm:text-3xl lg:text-4xl short:text-xl font-extrabold tracking-tight text-white font-display truncate">
            {track.title}
          </h1>

          <p className="text-xs sm:text-sm text-zinc-300 truncate">
            <span className="font-semibold text-white">{track.artist}</span> <span aria-hidden="true">·</span>{' '}
            <span className="text-zinc-400">{track.album}</span> <span aria-hidden="true">·</span>{' '}
            <span className="text-zinc-400 font-mono tabular-nums">{formatDurationMs(track.durationMs)}</span>
          </p>

          <div className="flex flex-wrap items-center justify-center md:justify-start short:justify-start gap-2 sm:gap-3 pt-2 short:pt-1">
            <button
              type="button"
              onClick={onTogglePlay}
              className="tap-target inline-flex items-center justify-center gap-2.5 px-6 py-2.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-sm transition-transform active:scale-95 cursor-pointer shadow-lg shadow-emerald-500/20 whitespace-nowrap shrink-0"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
              <span>{isPlaying ? 'Pause' : 'Play'}</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleLike(track.id)}
              aria-label={track.liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
              className={`tap-target inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                track.liked ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/15 text-zinc-300 hover:border-white/30 hover:text-white'
              }`}
            >
              <Heart className={`w-4 h-4 ${track.liked ? 'fill-emerald-400 text-emerald-400' : ''}`} />
              <span>{track.liked ? 'Liked' : 'Like'}</span>
            </button>
            <button
              type="button"
              onClick={() => onToggleDownloaded(track.id)}
              aria-pressed={track.cachedOffline}
              className={`tap-target inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                track.cachedOffline ? 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300' : 'border-white/15 text-zinc-300 hover:border-white/30 hover:text-white'
              }`}
            >
              {track.cachedOffline ? <Check className="w-4 h-4 text-indigo-400" /> : <Download className="w-4 h-4" />}
              <span>{track.cachedOffline ? 'Downloaded' : 'Download'}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});

interface PlayerLibraryViewProps extends TrackActionHandlers {
  libraryTracks: MetrolistTrack[];
  /** Every track the player knows (for the like / download state of search cards). */
  tracksById: Record<string, MetrolistTrack>;
  activeTrack: MetrolistTrack | null;
  isPlaying: boolean;
  /** The active YouTube stream is still loading / buffering / waiting for the network. */
  isStreamLoading: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  libraryFilter: LibraryFilter;
  recommendations: InnerTubeParsedTrack[];
  isLoadingRecommendations: boolean;
  onTogglePlay: () => void;
  onPlaySearchResult: (track: InnerTubeParsedTrack) => void;
  /** `context` is the list the track was picked from; playback continues through it. */
  onPlayFromList: (track: MetrolistTrack, context: MetrolistTrack[]) => void;
}

export const PlayerLibraryView = React.memo(function PlayerLibraryView({
  libraryTracks,
  tracksById,
  activeTrack,
  isPlaying,
  isStreamLoading,
  searchQuery,
  onSearchChange,
  libraryFilter,
  recommendations,
  isLoadingRecommendations,
  onTogglePlay,
  onPlaySearchResult,
  onPlayFromList,
  onPlayNext,
  onAddToQueue,
  onToggleLike,
  onToggleDownloaded,
}: PlayerLibraryViewProps) {
  countRender('PlayerLibraryView');
  // Artist shelf ("Instant Mixes") shown while the search box is empty
  const [shelf, setShelf] = React.useState<{ label: string; tracks: InnerTubeParsedTrack[] }>({
    label: 'Popular Picks',
    tracks: STATIC_YTM_FALLBACK,
  });
  const [activeArtistChip, setActiveArtistChip] = React.useState(QUICK_YTM_PICKS[0].label);
  const [isLoadingShelf, setIsLoadingShelf] = React.useState(false);
  const [search, setSearch] = React.useState<SearchState>({ status: 'idle' });

  const searchInputRef = React.useRef<HTMLInputElement | null>(null);
  const searchAbortRef = React.useRef<AbortController | null>(null);
  const shelfAbortRef = React.useRef<AbortController | null>(null);
  // Query of the search that is running or already answered, to avoid duplicate requests
  const settledQueryRef = React.useRef('');
  const debounceTimerRef = React.useRef<number | null>(null);

  const trimmedQuery = searchQuery.trim();
  const isSearchMode = isSearchQuery(searchQuery);

  const loadArtistShelf = React.useCallback(async (label: string, query: string) => {
    shelfAbortRef.current?.abort();
    const controller = new AbortController();
    shelfAbortRef.current = controller;
    setIsLoadingShelf(true);
    try {
      const results = await searchTracks(query, controller.signal);
      if (controller.signal.aborted) return;
      setShelf(results.length > 0 ? { label: `${label} Essentials`, tracks: results } : { label: 'Popular Picks', tracks: STATIC_YTM_FALLBACK });
    } catch {
      if (!controller.signal.aborted) setShelf({ label: 'Popular Picks', tracks: STATIC_YTM_FALLBACK });
    } finally {
      if (!controller.signal.aborted) setIsLoadingShelf(false);
    }
  }, []);

  /** Runs a live search. Only the most recent request may update the results (no stale overwrites). */
  const runSearch = React.useCallback(async (rawQuery: string, force = false) => {
    const query = rawQuery.trim();
    if (query.length < MIN_SEARCH_LENGTH) return;
    if (!force && settledQueryRef.current === query) return;

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    settledQueryRef.current = query;
    setSearch({ status: 'loading', query });

    try {
      const results = await searchTracks(query, controller.signal);
      if (controller.signal.aborted) return;
      setSearch({ status: 'done', query, tracks: results });
    } catch {
      if (controller.signal.aborted) return;
      settledQueryRef.current = '';
      setSearch({ status: 'error', query });
    }
  }, []);

  React.useEffect(() => {
    void loadArtistShelf(QUICK_YTM_PICKS[0].label, QUICK_YTM_PICKS[0].query);
    return () => {
      shelfAbortRef.current?.abort();
      searchAbortRef.current?.abort();
    };
  }, [loadArtistShelf]);

  // Search-as-you-type (debounced). Pressing Enter / the keyboard's Search key runs it immediately.
  React.useEffect(() => {
    if (!isSearchMode) {
      searchAbortRef.current?.abort();
      settledQueryRef.current = '';
      setSearch({ status: 'idle' });
      return;
    }
    const timer = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void runSearch(trimmedQuery);
    }, SEARCH_DEBOUNCE_MS);
    debounceTimerRef.current = timer;
    return () => window.clearTimeout(timer);
  }, [trimmedQuery, isSearchMode, runSearch]);

  const handleSearchSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Read the live DOM value: on Android keyboards the last composed word may not have reached
    // React state yet when the Search / Enter key is pressed.
    const liveValue = searchInputRef.current?.value ?? searchQuery;
    if (liveValue !== searchQuery) onSearchChange(liveValue);
    // The explicit search supersedes the pending search-as-you-type request
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    void runSearch(liveValue, true);
    // Dismiss the on-screen keyboard so the results are visible
    searchInputRef.current?.blur();
  };

  const filteredLocalTracks = React.useMemo(() => {
    // Every typed word must appear somewhere in the title, artist or album ("kavinsky nightcall")
    const words = trimmedQuery.toLowerCase().split(' ').filter(Boolean);
    return libraryTracks.filter((t) => {
      const haystack = `${t.title} ${t.artist} ${t.album}`.toLowerCase();
      const matchesLib =
        libraryFilter === 'ALL' || (libraryFilter === 'LIKED' && t.liked) || (libraryFilter === 'CACHED' && t.cachedOffline);
      return matchesLib && words.every((word) => haystack.includes(word));
    });
  }, [libraryTracks, trimmedQuery, libraryFilter]);

  // Rows keep a stable click handler; the list they continue through is read when clicked
  const listRef = React.useRef(filteredLocalTracks);
  listRef.current = filteredLocalTracks;
  const playRow = React.useCallback((track: MetrolistTrack) => onPlayFromList(track, listRef.current), [onPlayFromList]);

  const isSearching = search.status === 'loading';
  const searchResults = search.status === 'done' ? search.tracks.slice(0, MAX_SEARCH_RESULTS) : [];
  const activeId = activeTrack?.id ?? '';

  const renderCard = (yt: InnerTubeParsedTrack, keyPrefix: string) => {
    const id = liveTrackId(yt.videoId);
    const known = Object.prototype.hasOwnProperty.call(tracksById, id) ? tracksById[id] : undefined;
    const isCurrent = activeId === id;
    return (
      <YtTrackCard
        key={`${keyPrefix}-${yt.videoId}`}
        track={yt}
        isCurrent={isCurrent}
        isPlaying={isCurrent && isPlaying}
        isLoading={isCurrent && isStreamLoading}
        liked={!!known?.liked}
        downloaded={!!known?.cachedOffline}
        onPlay={onPlaySearchResult}
        onPlayNext={onPlayNext}
        onAddToQueue={onAddToQueue}
        onToggleLike={onToggleLike}
        onToggleDownloaded={onToggleDownloaded}
      />
    );
  };

  return (
    <div className="space-y-7 short:space-y-5">
      {/* Search & quick artist mixes */}
      <section className="space-y-3.5">
        <form role="search" action="#" onSubmit={handleSearchSubmit} className="relative w-full">
          <Search className="w-4 h-4 text-zinc-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="search"
            name="q"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Search songs, artists, or albums on YouTube Music"
            placeholder="What do you want to play?"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="search-input w-full pl-11 pr-24 py-2.5 rounded-full border border-white/10 bg-zinc-900/90 hover:bg-zinc-800/90 focus:bg-zinc-900 text-base sm:text-sm text-white placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-colors"
          />
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center">
            {isSearching && <Loader2 className="w-4 h-4 mr-1 text-emerald-400 animate-spin" aria-hidden="true" />}
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => {
                  onSearchChange('');
                  searchInputRef.current?.focus();
                }}
                className="tap-target inline-flex items-center justify-center p-1.5 rounded-full text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button type="submit" aria-label="Search" className="tap-target inline-flex items-center justify-center p-1.5 rounded-full text-zinc-400 hover:text-white cursor-pointer">
              <Search className="w-4 h-4" />
            </button>
          </div>
        </form>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
          <span className="text-xs font-medium text-zinc-400 shrink-0 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Instant Mixes:</span>
          </span>
          {QUICK_YTM_PICKS.map((pick) => {
            const active = activeArtistChip === pick.label && !isSearchMode;
            return (
              <button
                key={pick.label}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setActiveArtistChip(pick.label);
                  onSearchChange('');
                  void loadArtistShelf(pick.label, pick.query);
                }}
                className={`tap-target px-3 py-1.5 rounded-full text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-zinc-900 text-zinc-400 border border-white/5 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
              >
                {pick.label}
              </button>
            );
          })}
        </div>
      </section>

      {isSearchMode && (
        <section className="space-y-3" aria-label="Search results" aria-busy={isSearching}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-white font-display tracking-tight min-w-0 truncate">
              Results for &ldquo;{search.status === 'idle' ? trimmedQuery : search.query}&rdquo;
            </h2>
            {search.status === 'done' && search.tracks.length > 0 && <span className="text-xs text-zinc-400">Tap a song to play it ad-free</span>}
          </div>

          {(search.status === 'loading' || search.status === 'idle') && (
            <div role="status" className="flex items-center gap-2 px-4 py-6 rounded-xl border border-white/5 bg-zinc-900/50 text-sm text-zinc-400">
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
              <span>Searching YouTube Music…</span>
            </div>
          )}

          {search.status === 'error' && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-sm text-rose-100">
              <span>Search couldn&rsquo;t reach YouTube Music. Check your connection and try again.</span>
              <button
                type="button"
                onClick={() => void runSearch(search.query, true)}
                className="tap-target inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-100 text-rose-950 text-xs font-bold cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {search.status === 'done' && search.tracks.length === 0 && (
            <div role="status" className="px-4 py-6 rounded-xl border border-white/5 bg-zinc-900/50 text-sm text-zinc-300">
              No songs found for &ldquo;{search.query}&rdquo;. Check the spelling or try different words.
            </div>
          )}

          {searchResults.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2.5">{searchResults.map((yt) => renderCard(yt, 'search'))}</div>
          )}
        </section>
      )}

      <HeroCard
        track={activeTrack}
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        onToggleLike={onToggleLike}
        onToggleDownloaded={onToggleDownloaded}
      />

      {!isSearchMode && shelf.tracks.length > 0 && (
        <section className="space-y-3" aria-label="Featured songs" aria-busy={isLoadingShelf}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-white font-display tracking-tight">{shelf.label}</h2>
            {isLoadingShelf ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Loading…</span>
              </span>
            ) : (
              <span className="text-xs text-zinc-400">Tap a song to play it ad-free</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2.5">
            {shelf.tracks.slice(0, MAX_SHELF_ITEMS).map((yt) => renderCard(yt, 'shelf'))}
          </div>
        </section>
      )}

      <section className="space-y-3" aria-label="YouTube Music Recommendations">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Radio className="w-4 h-4 text-emerald-400 shrink-0" />
            <h2 className="text-base font-bold text-white font-display tracking-tight truncate">
              Recommended for You{activeTrack ? <> · Similar to &ldquo;{activeTrack.title}&rdquo;</> : null}
            </h2>
          </div>
          {isLoadingRecommendations ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Updating YouTube Radio...</span>
            </span>
          ) : (
            <span className="text-xs text-zinc-400">YouTube Music Radio Algorithm</span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-2.5">
          {recommendations.slice(0, MAX_SHELF_ITEMS).map((rec) => renderCard(rec, 'rec'))}
        </div>
      </section>

      <section className="space-y-3" aria-label="Your Library">
        <h2 className="text-base font-bold text-white font-display tracking-tight">
          Your Library & Saved Tracks ({filteredLocalTracks.length})
        </h2>
        <div className="rounded-xl border border-white/5 bg-zinc-900/50 overflow-hidden">
          <div className="grid grid-cols-12 items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 border-b border-white/5 text-xs font-medium text-zinc-400">
            <div className="col-span-8 sm:col-span-6 flex items-center gap-3">
              <span className="w-6 text-center">#</span>
              <span>Title</span>
            </div>
            <div className="hidden sm:block sm:col-span-3">Album</div>
            <div className="col-span-4 sm:col-span-3 flex items-center justify-end gap-2 pr-11">
              <Clock className="w-3.5 h-3.5" aria-label="Duration" />
            </div>
          </div>
          <div className="divide-y divide-white/5">
            {filteredLocalTracks.length === 0 && (
              <div className="px-4 py-6 text-sm text-zinc-400">
                {libraryFilter === 'LIKED'
                  ? 'No liked songs yet. Tap the heart on any song to save it here.'
                  : libraryFilter === 'CACHED'
                    ? 'No downloaded songs yet.'
                    : 'No songs in your library match this search.'}
              </div>
            )}
            {filteredLocalTracks.map((track, idx) => {
              const isCurrent = track.id === activeId;
              return (
                <LibraryRow
                  key={track.id}
                  track={track}
                  position={idx + 1}
                  isCurrent={isCurrent}
                  isPlaying={isCurrent && isPlaying}
                  onPlay={playRow}
                  onPlayNext={onPlayNext}
                  onAddToQueue={onAddToQueue}
                  onToggleLike={onToggleLike}
                  onToggleDownloaded={onToggleDownloaded}
                />
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
});
