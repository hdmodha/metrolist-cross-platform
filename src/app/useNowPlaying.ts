import React from 'react';
import { INITIAL_NOW_PLAYING, nowPlayingStep, type NowPlayingEvent } from './nowPlayingHistory';
import { historyFlags } from './router';

/**
 * Open / closed state of the full-screen Now Playing view, backed by one history entry so the
 * Android / browser Back button closes it (rules in `nowPlayingHistory.ts`).
 */
export function useNowPlaying(canOpen: boolean) {
  const [state, setState] = React.useState(INITIAL_NOW_PLAYING);
  const stateRef = React.useRef(state);

  /** Applies an event; returns `true` when the caller's navigation must replace the current entry. */
  const apply = React.useCallback((event: NowPlayingEvent): boolean => {
    const step = nowPlayingStep(stateRef.current, event);
    stateRef.current = step.state;
    setState(step.state);
    const flags = historyFlags();
    if (step.effect === 'push') {
      window.history.pushState({ ...flags, nowPlaying: true }, '');
    } else if (step.effect === 'back') {
      window.history.back();
    } else if (step.effect === 'clearFlag') {
      window.history.replaceState({ ...flags, nowPlaying: false }, '');
    }
    return step.effect === 'replace';
  }, []);

  const canOpenRef = React.useRef(canOpen);
  canOpenRef.current = canOpen;

  React.useEffect(() => {
    apply({ type: 'boot', flagged: !!historyFlags().nowPlaying, canOpen: canOpenRef.current });
    const onPopState = () => apply({ type: 'popstate', flagged: !!historyFlags().nowPlaying && canOpenRef.current });
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [apply]);

  // Nothing left to show (cannot normally happen once a song is loaded)
  React.useEffect(() => {
    if (!canOpen && stateRef.current.open) apply({ type: 'close' });
  }, [apply, canOpen]);

  const controls = React.useMemo(
    () => ({
      open: () => {
        if (canOpenRef.current) apply({ type: 'open' });
      },
      close: () => {
        apply({ type: 'close' });
      },
      /** Call before navigating somewhere else; `true` = replace the current history entry. */
      leaveForNavigation: () => apply({ type: 'navigate' }),
    }),
    [apply]
  );

  return { isOpen: state.open, ...controls };
}
