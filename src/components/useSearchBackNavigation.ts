import React from 'react';
import { searchHistoryStep, type SearchHistoryEvent, type SearchHistoryState } from '../player/effectPolicies';

/**
 * Android hardware Back / browser Back while searching clears the search instead of leaving the app
 * (Capacitor's default Back handler calls `history.back()` when it can). Entering search pushes one
 * history entry; Back without a search is never intercepted.
 */
export function useSearchBackNavigation(inSearch: boolean, clearSearch: () => void): void {
  const stateRef = React.useRef<SearchHistoryState>({ entryPushed: false });
  const clearRef = React.useRef(clearSearch);
  clearRef.current = clearSearch;

  const apply = React.useCallback((event: SearchHistoryEvent) => {
    const step = searchHistoryStep(stateRef.current, event);
    stateRef.current = step.state;
    if (step.effect === 'push') {
      window.history.pushState({ ...(window.history.state ?? {}), metrolistSearch: true }, '');
    } else if (step.effect === 'back') {
      if ((window.history.state as { metrolistSearch?: boolean } | null)?.metrolistSearch) window.history.back();
    } else if (step.effect === 'clearSearch') {
      clearRef.current();
    }
  }, []);

  React.useEffect(() => {
    apply({ type: 'searchModeChanged', inSearch });
  }, [apply, inSearch]);

  React.useEffect(() => {
    const onPopState = () => apply({ type: 'popstate' });
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [apply]);
}
