import React from 'react';
import type { MetrolistTrack } from '../data/track';
import type { PlaybackClock } from '../player/playbackClock';
import { countRender } from '../utils/renderProbe';
import { Artwork } from './Artwork';
import { LikeButton, PlayPauseButton } from './PlayerButtons';
import { ProgressLine } from './ProgressLine';

interface MiniPlayerProps {
  track: MetrolistTrack;
  clock: PlaybackClock;
  isPlaying: boolean;
  isLoading: boolean;
  liked: boolean;
  onTogglePlay: () => void;
  onToggleLike: (trackId: string, track: MetrolistTrack) => void;
  onExpand: () => void;
  expandRef: React.Ref<HTMLButtonElement>;
}

/** Phones and tablets: the song docked above the tab bar. A tap anywhere but its buttons opens Now Playing. */
export const MiniPlayer = React.memo(function MiniPlayer({
  track,
  clock,
  isPlaying,
  isLoading,
  liked,
  onTogglePlay,
  onToggleLike,
  onExpand,
  expandRef,
}: MiniPlayerProps) {
  countRender('MiniPlayer');
  return (
    <div className="h-[var(--mini-h)] px-2 pt-1 pb-1">
      <div className="relative h-full rounded-lg bg-[#27272c] shadow-lg shadow-black/40 flex items-center gap-3 pl-2 pr-1 overflow-hidden">
        <button
          ref={expandRef}
          type="button"
          aria-label="Open Now Playing"
          aria-haspopup="dialog"
          onClick={onExpand}
          className="absolute inset-0 rounded-lg cursor-pointer focus-visible:outline-offset-[-2px]"
        />
        <Artwork src={track.coverUrl} eager className="relative w-10 h-10 short:w-9 short:h-9 rounded pointer-events-none shrink-0" />
        <div className="relative min-w-0 flex-1 pointer-events-none">
          <div data-current-title className="truncate text-sm font-semibold text-white leading-tight">
            {track.title}
          </div>
          <div className="truncate text-[13px] text-zinc-400 leading-tight mt-0.5">{track.artist}</div>
        </div>
        <LikeButton liked={liked} onToggle={() => onToggleLike(track.id, track)} className="relative w-10 h-10" />
        <PlayPauseButton isPlaying={isPlaying} isLoading={isLoading} onToggle={onTogglePlay} size="sm" className="relative" />
        <div className="absolute left-2 right-2 bottom-0 pointer-events-none">
          <ProgressLine clock={clock} durationMs={track.durationMs} />
        </div>
      </div>
    </div>
  );
});
