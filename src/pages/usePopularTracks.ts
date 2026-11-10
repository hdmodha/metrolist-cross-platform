import React from 'react';
import { POPULAR_QUERY } from '../data/browse';
import { STATIC_YTM_FALLBACK } from '../data/fallbackTracks';
import { searchTracks } from '../utils/apiClient';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';

/** "Popular right now" for a fresh install: a live search, or the offline-safe shelf when it fails. */
export function usePopularTracks(enabled: boolean): { tracks: InnerTubeParsedTrack[]; loading: boolean } {
  const [state, setState] = React.useState<{ tracks: InnerTubeParsedTrack[]; loading: boolean }>({ tracks: [], loading: enabled });
  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState((prev) => (prev.tracks.length > 0 ? prev : { tracks: [], loading: true }));
    searchTracks(POPULAR_QUERY, controller.signal)
      .then((tracks) => {
        if (!controller.signal.aborted) setState({ tracks: tracks.length > 0 ? tracks : STATIC_YTM_FALLBACK, loading: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ tracks: STATIC_YTM_FALLBACK, loading: false });
      });
    return () => controller.abort();
  }, [enabled]);
  return state;
}
