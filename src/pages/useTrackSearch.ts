import React from 'react';
import { searchTracks } from '../utils/apiClient';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';

export type SearchStatus =
  | { status: 'idle' }
  | { status: 'loading'; query: string }
  | { status: 'done'; query: string; tracks: InnerTubeParsedTrack[] }
  | { status: 'error'; query: string };

/**
 * Live search for `query` (empty = idle). Only the newest request may update the results, so a slow
 * earlier answer never overwrites newer ones. `rerun` forces a new request (Enter, Retry).
 */
export function useTrackSearch(query: string) {
  const [search, setSearch] = React.useState<SearchStatus>({ status: 'idle' });
  const controllerRef = React.useRef<AbortController | null>(null);
  /** Query of the request that is running or already answered (no duplicate requests). */
  const settledRef = React.useRef('');

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
