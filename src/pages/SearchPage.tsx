import React from 'react';
import { History, LoaderCircle, RotateCw, Search, X } from 'lucide-react';
import { historyFlags, navigate } from '../app/router';
import { BROWSE_TILES } from '../data/browse';
import { toMetrolistTrack } from '../player/playerCore';
import { SongList, type ListStatus } from '../components/SongList';
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

  // A query that arrives from outside (Back / Forward, a browse tile, "Go to artist") fills the box
  React.useEffect(() => {
    if (query === committedRef.current) return;
    committedRef.current = query;
    setText(query);
  }, [query]);

  const cancelDebounce = () => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  };
  React.useEffect(() => cancelDebounce, []);

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
      <h1 className="text-[28px] short:text-2xl lg:text-4xl font-extrabold tracking-tight text-white mb-4 short:mb-3">Search</h1>

      <div className="sticky top-0 z-20 -mx-[var(--page-px)] px-[var(--page-px)] pt-[env(safe-area-inset-top)] pb-3 bg-[#09090B]">
        <form role="search" action="#" onSubmit={onSubmit} className="relative w-full lg:max-w-xl">
          <Search className="w-5 h-5 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
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
            className="search-input w-full h-12 short:h-10 pl-11 pr-20 rounded-lg bg-white text-zinc-950 text-base font-medium placeholder:text-zinc-500 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-emerald-400"
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
            {isSearching && <LoaderCircle className="w-4 h-4 mr-1 text-zinc-500 animate-spin" aria-hidden="true" />}
            {text && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={clear}
                className="tap-target inline-flex items-center justify-center w-10 h-10 rounded-full text-zinc-600 hover:text-zinc-950 cursor-pointer"
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
            <div role="status" className="flex items-center gap-2 py-8 justify-center text-sm text-zinc-400">
              <LoaderCircle className="w-4 h-4 animate-spin" aria-hidden="true" />
              <span>Searching YouTube Music…</span>
            </div>
          )}
          {search.status === 'error' && (
            <div role="alert" className="flex flex-col items-center text-center gap-3 py-10 px-4">
              <p className="text-sm text-zinc-300 max-w-sm">Search couldn’t reach YouTube Music. Check your connection and try again.</p>
              <button
                type="button"
                onClick={() => rerun(search.query)}
                className="tap-target inline-flex items-center gap-2 px-5 py-2 rounded-full bg-white text-zinc-950 text-sm font-bold cursor-pointer"
              >
                <RotateCw className="w-4 h-4" aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          )}
          {search.status === 'done' && results.length === 0 && (
            <div role="status" className="py-10 px-4 text-center">
              <p className="text-base font-semibold text-white">No songs found for “{search.query}”</p>
              <p className="mt-1 text-sm text-zinc-400">Check the spelling, or try fewer or different words.</p>
            </div>
          )}
          {results.length > 0 && <SongList label="Songs" tracks={results} onPlay={playResult} {...status} />}
        </section>
      ) : (
        <div className="space-y-8 short:space-y-6 mt-2">
          {recent.recent.length > 0 && (
            <section aria-labelledby="recent-searches" className="lg:max-w-xl">
              <div className="flex items-center justify-between gap-3 mb-1">
                <h2 id="recent-searches" className="text-lg font-bold text-white">
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
                  <li key={q} className="flex items-center rounded-md hover:bg-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => runNow(q)}
                      className="flex flex-1 min-w-0 items-center gap-3 py-2 pl-2 text-left cursor-pointer rounded-md"
                    >
                      <span aria-hidden="true" className="w-10 h-10 rounded-full bg-white/[0.07] flex items-center justify-center shrink-0 text-zinc-400">
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
            <h2 id="browse-all" className="text-lg font-bold text-white mb-3">
              Browse all
            </h2>
            <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3 lg:gap-4">
              {BROWSE_TILES.map((tile) => (
                <li key={tile.label}>
                  <button
                    type="button"
                    onClick={() => runNow(tile.query)}
                    className={`relative w-full h-24 short:h-16 lg:h-28 overflow-hidden rounded-lg ${tile.className} p-3 text-left cursor-pointer hover:brightness-110 transition`}
                  >
                    <span className="relative z-10 text-base lg:text-lg font-bold text-white">{tile.label}</span>
                    <span aria-hidden="true" className="absolute -right-3 -bottom-3 w-16 h-16 lg:w-20 lg:h-20 rounded-md bg-black/20 rotate-[25deg]" />
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
