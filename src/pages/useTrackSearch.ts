import React from 'react';
import { peekSearchResults, SEARCH_CACHE_TTL_MS, searchTracks } from '../utils/apiClient';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';

export type SearchStatus =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; tracks: InnerTubeParsedTrack[] }
  | { status: 'error'; query: string };

/**
 * The Search page's last answer, empty ones included (the search cache keeps only non-empty ones):
 * the page unmounts on a tab switch, and coming back must show the same state at once.
 */
let lastAnswer: { query: string; tracks: InnerTubeParsedTrack[]; at: number } | null = null;

/** An answer for `query` already in memory: the page's last one, or the search cache. */
function answerInMemory(query: string): InnerTubeParsedTrack[] | null {
  if (!query) return null;
  if (lastAnswer && lastAnswer.query === query && Date.now() - lastAnswer.at < SEARCH_CACHE_TTL_MS) return lastAnswer.tracks;
  return peekSearchResults(query);
}

/**
 * Live search for `query` (empty = idle). Only the newest request may update the results, so a slow
 * earlier answer never overwrites newer ones. `rerun` forces a new request (Enter, Retry). A fresh
 * answer already in memory is shown from the first render: no spinner, no request.
 */
export function useTrackSearch(query: string) {
  const [initial] = React.useState(() => {
    const tracks = answerInMemory(query);
    return tracks ? { search: { status: 'done', query, tracks } as SearchStatus, settled: query } : { search: { status: 'idle' } as SearchStatus, settled: '' };
  });
  const [search, setSearch] = React.useState<SearchStatus>(initial.search);
  const controllerRef = React.useRef<AbortController | null>(null);
  /** Query of the request that is running or already answered (no duplicate requests). */
  const settledRef = React.useRef(initial.settled);

  const run = React.useCallback(async (q: string, force: boolean) => {
    if (!q || (!force && settledRef.current === q)) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    settledRef.current = q;
    setSearch({ status: 'loading', query: q });
    try {
      const tracks = await searchTracks(q, controller.signal);
      if (controller.signal.aborted) return;
      lastAnswer = { query: q, tracks, at: Date.now() };
      setSearch({ status: 'done', query: q, tracks });
    } catch {
      if (controller.signal.aborted) return;
      settledRef.current = '';
      setSearch({ status: 'error', query: q });
    }
  }, []);

  React.useEffect(() => {
    if (!query) {
      controllerRef.current?.abort();
      settledRef.current = '';
      setSearch({ status: 'idle' });
      return;
    }
    void run(query, false);
  }, [query, run]);

  React.useEffect(() => () => controllerRef.current?.abort(), []);

  const rerun = React.useCallback((q: string) => void run(q, true), [run]);
  return { search, rerun };
}
