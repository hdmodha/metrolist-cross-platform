import React from 'react';
import { CircleAlert, History, Search, SearchX, X } from 'lucide-react';
import { registerSearchInput } from '../app/navigationMemory';
import { historyFlags, navigate } from '../app/router';
import { BROWSE_TILES } from '../data/browse';
import { toMetrolistTrack } from '../player/playerCore';
import { EmptyState } from '../components/EmptyState';
import { SkeletonRows, SongList, type ListStatus } from '../components/SongList';
import { addRecentSearch, loadRecentSearches, removeRecentSearch, saveRecentSearches } from '../utils/recentSearches';
import { countRender } from '../utils/renderProbe';
import { usePlayOne } from './usePlayList';
import { useTrackSearch } from './useTrackSearch';

const SEARCH_DEBOUNCE_MS = 320;
const MIN_SEARCH_LENGTH = 2;
const MAX_RESULTS = 20;

interface SearchPageProps extends ListStatus {
  /** The query in the URL (`#/search?q=…`). */
  query: string;
}

/** What a typed value means for the URL: a query of 2+ characters, or nothing. */
function toQuery(value: string): string {
  const trimmed = value.trim();
  return trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : '';
}

function useRecentSearches() {
  const [recent, setRecent] = React.useState<string[]>(() => loadRecentSearches());
  const update = React.useCallback((change: (list: string[]) => string[]) => {
    setRecent((list) => {
      const next = change(list);
      if (next !== list) saveRecentSearches(next);
      return next;
    });
  }, []);
  return {
    recent,
    add: React.useCallback((q: string) => update((list) => addRecentSearch(list, q)), [update]),
    remove: React.useCallback((q: string) => update((list) => removeRecentSearch(list, q)), [update]),
    clear: React.useCallback(() => update((list) => (list.length === 0 ? list : [])), [update]),
  };
}

/**
 * Search: the box, then either Recent searches + Browse (no query) or the results. The query lives
 * in the URL: the first query typed on the empty page pushes one history entry (so Back returns to
 * the empty page), later keystrokes only replace it.
 */
export const SearchPage = React.memo(function SearchPage({ query, ...status }: SearchPageProps) {
  countRender('SearchPage');
  const [text, setText] = React.useState(query);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const debounceRef = React.useRef<number | null>(null);
  /** The query this page last put in the URL. */
  const committedRef = React.useRef(query);
  const { search, rerun } = useTrackSearch(query);
  const recent = useRecentSearches();

  const cancelDebounce = () => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };
  React.useEffect(() => cancelDebounce, []);

  // A query that arrives from outside (Back / Forward, a browse tile, "Go to artist", re-tapping the
  // tab) fills the box and wins over a half-typed one
  React.useEffect(() => {
    if (query === committedRef.current) return;
    committedRef.current = query;
    cancelDebounce();
    setText(query);
  }, [query]);

  // Re-tapping the Search tab focuses this box (synchronously, inside the tap)
  React.useEffect(() => {
    registerSearchInput(inputRef.current);
    return () => registerSearchInput(null);
  }, []);

  /** Puts `value` in the URL (push from the empty page, replace while refining). */
  const commit = (value: string) => {
    const next = toQuery(value);
    if (next === committedRef.current) return;
    const previous = committedRef.current;
    committedRef.current = next;
    if (!next) {
      // Back to the empty page: drop our results entry when we pushed it
      if (historyFlags().searchFromEmpty) window.history.back();
      else navigate({ name: 'search', query: '' }, { replace: true });
    } else if (!previous) {
      navigate({ name: 'search', query: next }, { flags: { searchFromEmpty: true } });
    } else {
      navigate({ name: 'search', query: next }, { replace: true, flags: historyFlags() });
    }
  };

  const onChange = (value: string) => {
    setText(value);
    cancelDebounce();
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      commit(value);
    }, SEARCH_DEBOUNCE_MS);
  };

  const runNow = (value: string) => {
    cancelDebounce();
    setText(value);
    const next = toQuery(value);
    if (next && next === committedRef.current) rerun(next);
    commit(value);
    if (next) recent.add(next);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Read the live DOM value: on Android keyboards the last composed word may not have reached
    // React state yet when the Search / Enter key is pressed.
    runNow(inputRef.current?.value ?? text);
    // Dismiss the on-screen keyboard so the results are visible
    inputRef.current?.blur();
  };

  const clear = () => {
    cancelDebounce();
    setText('');
    commit('');
    inputRef.current?.focus();
  };

  const results = React.useMemo(
    () => (search.status === 'done' ? search.tracks.slice(0, MAX_RESULTS).map(toMetrolistTrack) : []),
    [search]
  );
  const shownQuery = search.status === 'idle' ? query : search.query;
  const addCurrentToRecent = React.useCallback(() => {
    if (committedRef.current) recent.add(committedRef.current);
  }, [recent]);
  const playResult = usePlayOne('search', addCurrentToRecent);
  const isSearching = search.status === 'loading';

  return (
    <div>
      <h1 className="text-[28px] short:text-2xl lg:text-[32px] font-bold tracking-tight text-white mb-4 short:mb-3">Search</h1>

      <div className="sticky top-0 z-20 -mx-[var(--page-px)] px-[var(--page-px)] pt-[env(safe-area-inset-top)] pb-2 bg-[#09090B]">
        <form role="search" action="#" onSubmit={onSubmit} className="relative w-full lg:max-w-xl">
          <Search className="w-5 h-5 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            name="q"
            enterKeyHint="search"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Search songs, artists, or albums on YouTube Music"
            placeholder="What do you want to listen to?"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            className="search-input w-full h-12 short:h-10 pl-11 pr-20 rounded-xl bg-white/8 text-white text-base placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
            {text && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={clear}
                className="tap-target inline-flex items-center justify-center w-10 h-10 rounded-full text-zinc-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </form>
      </div>

      {query ? (
        <section aria-label="Search results" aria-busy={isSearching} className="mt-2">
          <h2 className="sr-only">Results for “{shownQuery}”</h2>
          {search.status !== 'done' && search.status !== 'error' && (
            <div role="status">
              <span className="sr-only">Searching YouTube Music…</span>
              <SkeletonRows />
            </div>
          )}
          {search.status === 'error' && (
            <EmptyState
              role="alert"
              icon={<CircleAlert className="w-7 h-7" aria-hidden="true" />}
              title="Search couldn’t reach YouTube Music"
              action={{ label: 'Retry', onClick: () => rerun(search.query) }}
            >
              Check your connection and try again.
            </EmptyState>
          )}
          {search.status === 'done' && results.length === 0 && (
            <EmptyState role="status" icon={<SearchX className="w-7 h-7" aria-hidden="true" />} title={`No songs found for “${search.query}”`}>
              Check the spelling, or try fewer or different words.
            </EmptyState>
          )}
          {results.length > 0 && <SongList label="Songs" className="fade-in" tracks={results} onPlay={playResult} {...status} />}
        </section>
      ) : (
        <div className="space-y-8 short:space-y-6 mt-2">
          {recent.recent.length > 0 && (
            <section aria-labelledby="recent-searches" className="lg:max-w-xl">
              <div className="flex items-center justify-between gap-3 mb-1">
                <h2 id="recent-searches" className="text-xl font-bold text-white">
                  Recent searches
                </h2>
                <button
                  type="button"
                  onClick={recent.clear}
                  className="tap-target px-2 text-sm font-semibold text-zinc-400 hover:text-white cursor-pointer"
                >
                  Clear all
                </button>
              </div>
              <ul className="-mx-2">
                {recent.recent.map((q) => (
                  <li key={q} className="flex items-center rounded-xl hover:bg-white/5">
                    <button
                      type="button"
                      onClick={() => runNow(q)}
                      className="flex flex-1 min-w-0 items-center gap-3 py-2 pl-2 text-left cursor-pointer rounded-md"
                    >
                      <span aria-hidden="true" className="w-10 h-10 rounded-full bg-white/8 flex items-center justify-center shrink-0 text-zinc-400">
                        <History className="w-5 h-5" />
                      </span>
                      <span className="truncate text-[15px] text-white">{q}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove “${q}” from recent searches`}
                      onClick={() => recent.remove(q)}
                      className="tap-target inline-flex items-center justify-center w-10 h-10 mr-1 rounded-full text-zinc-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="browse-all">
            <h2 id="browse-all" className="text-xl font-bold text-white mb-3">
              Browse all
            </h2>
            <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3 lg:gap-4">
              {BROWSE_TILES.map((tile) => (
                <li key={tile.label}>
                  <button
                    type="button"
                    onClick={() => runNow(tile.query)}
                    className={`relative w-full h-24 short:h-16 lg:h-28 overflow-hidden rounded-xl ${tile.className} p-3 text-left cursor-pointer`}
                  >
                    <span className="relative z-10 text-base lg:text-lg font-bold text-white">{tile.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
});
