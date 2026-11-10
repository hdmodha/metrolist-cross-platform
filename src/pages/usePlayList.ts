import React from 'react';
import { useAppActions } from '../app/AppActionsContext';
import type { MetrolistTrack } from '../data/track';
import type { PlaySource } from '../player/playerCore';

/** A stable row handler: plays the song, then continues through `list` (read when tapped). */
export function usePlayFromList(list: MetrolistTrack[], source: PlaySource): (track: MetrolistTrack) => void {
  const { player } = useAppActions();
  const listRef = React.useRef(list);
  listRef.current = list;
  return React.useCallback((track: MetrolistTrack) => player.playFromList(track, listRef.current, source), [player, source]);
}

/** A stable handler that plays one song now (the radio continues after it). */
export function usePlayOne(source: PlaySource, onPlayed?: () => void): (track: MetrolistTrack) => void {
  const { player } = useAppActions();
  const onPlayedRef = React.useRef(onPlayed);
  onPlayedRef.current = onPlayed;
  return React.useCallback(
    (track: MetrolistTrack) => {
      player.playSearchResult(track, source);
      onPlayedRef.current?.();
    },
    [player, source]
  );
}
