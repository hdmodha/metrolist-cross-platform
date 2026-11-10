import React from 'react';
import { currentHash, parseRoute, subscribeToLocation, type Route } from './router';

/** The current route; re-renders only when the hash really changes. */
export function useRoute(): Route {
  const hash = React.useSyncExternalStore(subscribeToLocation, currentHash, () => '');
  return React.useMemo(() => parseRoute(hash), [hash]);
}
