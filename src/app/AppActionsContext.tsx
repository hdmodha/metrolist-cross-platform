import React from 'react';
import type { PlayerActions } from '../player/usePlayer';
import type { HistoryFlags, Route } from './router';

/** Stable, app-wide handlers (their identities never change, so they never cause a render). */
export interface AppActions {
  player: PlayerActions;
  /** Goes to a page (closing Now Playing first when it is open). */
  go: (route: Route, options?: { flags?: HistoryFlags }) => void;
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
