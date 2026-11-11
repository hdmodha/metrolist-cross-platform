import React from 'react';
import { Pause, Play } from 'lucide-react';
import { useAppActions } from '../app/AppActionsContext';
import { Artwork } from './Artwork';
import { PlayingBars } from './PlayingBars';
import { songButtonLabel, type SongItemProps } from './SongRow';
import { TrackMenu } from './TrackMenu';
import { buildTrackMenuItems } from './trackMenuItems';

/** One song in a shelf: square artwork, title, artist, "⋮" menu. */
export const SongCard = React.memo(function SongCard({ track, isCurrent, isPlaying, liked, downloaded, unavailableReason, onPlay }: SongItemProps) {
  const actions = useAppActions();
  const items = React.useMemo(
    () => buildTrackMenuItems(track, { liked, downloaded }, actions),
    [track, liked, downloaded, actions]
  );
  return (
    <li className="group relative w-36 sm:w-40 short:w-28 lg:w-48 xl:w-52 shrink-0 snap-start rounded-lg lg:p-3 lg:hover:bg-white/[0.06] transition-colors">
      <button
        type="button"
        onClick={() => onPlay(track)}
        aria-label={songButtonLabel(track, isPlaying, unavailableReason)}
        title={unavailableReason ? songButtonLabel(track, isPlaying, unavailableReason) : undefined}
        aria-current={isCurrent ? 'true' : undefined}
        className="block w-full text-left rounded-md cursor-pointer"
      >
        <span className="relative block">
          <Artwork
            src={track.coverUrl}
            size="large"
            className={`block w-full aspect-square rounded-md shadow-lg shadow-black/40 ${unavailableReason ? 'opacity-50' : ''}`}
          />
          <span
            aria-hidden="true"
            className={`absolute right-2 bottom-2 w-10 h-10 rounded-full bg-emerald-400 text-zinc-950 shadow-xl items-center justify-center transition-all hidden lg:flex ${
              isCurrent && isPlaying
                ? 'opacity-100 translate-y-0'
                : 'opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0'
            }`}
          >
            {isCurrent && isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </span>
        </span>
        <span className={`block mt-2 pr-8 ${unavailableReason ? 'opacity-50' : ''}`}>
          <span className={`flex items-center gap-1.5 min-w-0 ${isCurrent ? 'text-emerald-400' : 'text-white'}`}>
            {isCurrent && <PlayingBars playing={isPlaying} />}
            <span className="song-title truncate text-sm font-semibold">{track.title}</span>
          </span>
          <span className="block truncate text-[13px] text-zinc-400 mt-0.5">{track.artist}</span>
        </span>
        {unavailableReason && (
          <span className="song-unavailable block mt-1 pr-8 truncate text-[11px] font-medium text-zinc-300">Unavailable</span>
        )}
      </button>
      <TrackMenu
        trackTitle={track.title}
        items={items}
        className="absolute right-0 bottom-0 lg:right-2 lg:bottom-3 w-8 h-8 max-lg:-mr-1.5"
      />
    </li>
  );
});
