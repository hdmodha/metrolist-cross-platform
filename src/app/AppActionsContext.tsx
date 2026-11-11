import React from 'react';
import type { PlayerActions } from '../player/usePlayer';
import type { HistoryFlags, NavigationIntent, Route } from './router';
import type { TabName } from './tabMemory';

/** Stable, app-wide handlers (their identities never change, so they never cause a render). */
export interface AppActions {
  player: PlayerActions;
  /**
   * Goes to a page (closing Now Playing first when it is open). `intent` (default `push`, a fresh
   * visit at the top) can be `tab` for chrome that returns to a page (scroll restored).
   */
  go: (route: Route, options?: { flags?: HistoryFlags; intent?: NavigationIntent }) => void;
  /** A press on a main tab: its last location, or (when already on it) its root / the top. */
  goTab: (tab: TabName) => void;
  /** Opens Search with the artist's songs. */
  goToArtist: (artist: string) => void;
  openNowPlaying: () => void;
  closeNowPlaying: () => void;
}

export const AppActionsContext = React.createContext<AppActions | null>(null);

export function useAppActions(): AppActions {
  const actions = React.useContext(AppActionsContext);
  if (!actions) throw new Error('useAppActions must be used inside <AppActionsContext.Provider>');
  return actions;
}
