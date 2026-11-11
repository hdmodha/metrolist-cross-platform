import React from 'react';
import { POPULAR_QUERY } from '../data/browse';
import { STATIC_YTM_FALLBACK } from '../data/fallbackTracks';
import { peekSearchResults, searchTracks } from '../utils/apiClient';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';

/** "Popular right now" for a fresh install: a live search, or the offline-safe shelf when it fails. */
export function usePopularTracks(enabled: boolean): { tracks: InnerTubeParsedTrack[]; loading: boolean } {
  // Coming back to Home: the cached answer from the first render (no skeleton; the request below is
  // then answered from the same cache)
  const [state, setState] = React.useState<{ tracks: InnerTubeParsedTrack[]; loading: boolean }>(() => {
    const cached = enabled ? peekSearchResults(POPULAR_QUERY) : null;
    return cached ? { tracks: cached, loading: false } : { tracks: [], loading: enabled };
  });
  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((prev) => (prev.tracks.length > 0 ? prev : { tracks: [], loading: true }));
    searchTracks(POPULAR_QUERY, controller.signal)
      .then((tracks) => {
        if (controller.signal.aborted) return;
        const next = tracks.length > 0 ? tracks : STATIC_YTM_FALLBACK;
        setState((prev) => (prev.tracks === next && !prev.loading ? prev : { tracks: next, loading: false }));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ tracks: STATIC_YTM_FALLBACK, loading: false });
      });
    return () => controller.abort();
  }, [enabled]);
  return state;
}
