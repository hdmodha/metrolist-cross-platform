import React from 'react';
import { useAppActions } from '../app/AppActionsContext';
import type { MetrolistTrack } from '../data/track';
import { unplayableShortReason, type UnplayableReason } from '../player/streamErrors';
import { formatDurationMs } from '../utils/metrolistCore';
import { Artwork } from './Artwork';
import { PlayingBars } from './PlayingBars';
import { TrackMenu } from './TrackMenu';
import { buildTrackMenuItems } from './trackMenuItems';

export interface SongItemProps {
  track: MetrolistTrack;
  /** The loaded song (highlighted). */
  isCurrent: boolean;
  /** The loaded song and it is playing. */
  isPlaying: boolean;
  liked: boolean;
  downloaded: boolean;
  /** The player found it cannot play this song: it is dimmed and labelled "Unavailable". */
  unavailableReason?: UnplayableReason;
  /** Tap: play it (or pause it when it is the playing song). */
  onPlay: (track: MetrolistTrack) => void;
}

export function playLabel(track: MetrolistTrack, isPlaying: boolean): string {
  return `${isPlaying ? 'Pause' : 'Play'} ${track.title} by ${track.artist}`;
}

/** Accessible name (and tooltip) of a song button: the play label, plus why it is unavailable. */
export function songButtonLabel(track: MetrolistTrack, isPlaying: boolean, unavailableReason?: UnplayableReason): string {
  const label = playLabel(track, isPlaying);
  return unavailableReason ? `${label}. Unavailable: ${unplayableShortReason(unavailableReason)}` : label;
}

/** One song in a list: artwork, title, artist (and album / duration on wide screens), "⋮" menu. */
export const SongRow = React.memo(function SongRow({ track, isCurrent, isPlaying, liked, downloaded, unavailableReason, onPlay }: SongItemProps) {
  const actions = useAppActions();
  const items = React.useMemo(
    () => buildTrackMenuItems(track, { liked, downloaded }, actions),
    [track, liked, downloaded, actions]
  );
  return (
    <li className="song-row group flex items-center gap-1 rounded-md hover:bg-white/[0.06] focus-within:bg-white/[0.06] transition-colors">
      <button
        type="button"
        onClick={() => onPlay(track)}
        aria-label={songButtonLabel(track, isPlaying, unavailableReason)}
        title={unavailableReason ? songButtonLabel(track, isPlaying, unavailableReason) : undefined}
        aria-current={isCurrent ? 'true' : undefined}
        className="flex flex-1 min-w-0 items-center gap-3 py-2 pl-2 text-left rounded-md cursor-pointer"
      >
        <Artwork
          src={track.coverUrl}
          className={`w-12 h-12 short:w-10 short:h-10 rounded shrink-0 ${unavailableReason ? 'opacity-50' : ''}`}
        />
        <span className={`min-w-0 flex-1 ${unavailableReason ? 'opacity-50' : ''}`}>
          <span className={`flex items-center gap-2 min-w-0 ${isCurrent ? 'text-emerald-400' : 'text-white'}`}>
            {isCurrent && <PlayingBars playing={isPlaying} />}
            <span className="song-title truncate text-[15px] font-medium leading-snug">{track.title}</span>
          </span>
          <span className="block truncate text-[13px] text-zinc-400 leading-snug mt-0.5">{track.artist}</span>
        </span>
        {unavailableReason && (
          <span className="song-unavailable shrink-0 rounded-full border border-white/20 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
            Unavailable
          </span>
        )}
        {track.album && (
          <span className="hidden xl:block w-[28%] min-w-0 truncate text-sm text-zinc-400">{track.album}</span>
        )}
        <span className="hidden md:block w-12 text-right text-sm text-zinc-400 tabular-nums shrink-0">
          {formatDurationMs(track.durationMs).replace(/^0/, '')}
        </span>
      </button>
      <TrackMenu trackTitle={track.title} items={items} className="w-10 h-10 mr-1" />
    </li>
  );
});
