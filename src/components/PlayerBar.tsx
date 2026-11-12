import React from 'react';
import { ListMusic, Maximize2, Volume1, Volume2, VolumeX } from 'lucide-react';
import type { MetrolistTrack } from '../data/track';
import type { PlaybackClock } from '../player/playbackClock';
import type { RepeatMode } from '../player/queueRules';
import { countRender } from '../utils/renderProbe';
import { Artwork } from './Artwork';
import { LikeButton, TransportControls } from './PlayerButtons';
import { SeekBar } from './SeekBar';

interface PlayerBarProps {
  track: MetrolistTrack;
  clock: PlaybackClock;
  isPlaying: boolean;
  isLoading: boolean;
  liked: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  volume: number;
  isMuted: boolean;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (ms: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onToggleLike: (trackId: string, track: MetrolistTrack) => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onOpenQueue: () => void;
  onExpand: () => void;
  expandRef: React.Ref<HTMLButtonElement>;
}

const iconButton = 'tap-target inline-flex items-center justify-center w-8 h-8 rounded-full text-zinc-400 hover:text-white cursor-pointer';

/** Desktop: the full-width player along the bottom. Only its seek bar re-renders on playback ticks. */
export const PlayerBar = React.memo(function PlayerBar(props: PlayerBarProps) {
  countRender('PlayerBar');
  const { track, clock, volume, isMuted } = props;
  const muted = isMuted || volume === 0;
  const shownVolume = muted ? 0 : volume;
  const VolumeIcon = muted ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return (
    <footer
      aria-label="Player"
      data-chrome="bottom"
      className="enter-up hidden lg:grid fixed inset-x-0 bottom-0 z-40 h-[calc(var(--bar-h)+env(safe-area-inset-bottom))] pb-[env(safe-area-inset-bottom)] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] grid-cols-[minmax(0,1fr)_minmax(0,40rem)_minmax(0,1fr)] items-center gap-6 bg-(--surface-solid)"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Artwork src={track.coverUrl} eager className="w-14 h-14 rounded-lg shrink-0" />
        <div className="min-w-0">
          <div data-current-title className="truncate text-sm font-semibold text-white">
            <span key={track.id} className="fade-in">
              {track.title}
            </span>
          </div>
          <div className="truncate text-xs text-zinc-400 mt-0.5">
            <span key={track.id} className="fade-in">
              {track.artist}
            </span>
          </div>
        </div>
        <LikeButton resetKey={track.id} liked={props.liked} onToggle={() => props.onToggleLike(track.id, track)} className="w-8 h-8 shrink-0" iconClassName="w-4 h-4" />
      </div>

      <div className="flex flex-col items-center gap-1 min-w-0">
        <TransportControls
          size="md"
          isPlaying={props.isPlaying}
          isLoading={props.isLoading}
          shuffleEnabled={props.shuffleEnabled}
          repeatMode={props.repeatMode}
          onTogglePlay={props.onTogglePlay}
          onNext={props.onNext}
          onPrevious={props.onPrevious}
          onToggleShuffle={props.onToggleShuffle}
          onCycleRepeat={props.onCycleRepeat}
        />
        <SeekBar clock={clock} durationMs={track.durationMs} onSeek={props.onSeek} />
      </div>

      <div className="flex items-center justify-end gap-1 min-w-0">
        <button type="button" aria-label="Queue" onClick={props.onOpenQueue} className={iconButton}>
          <ListMusic className="w-4 h-4" />
        </button>
        <button type="button" aria-label={muted ? 'Unmute' : 'Mute'} onClick={props.onToggleMute} className={iconButton}>
          <VolumeIcon className="w-4 h-4" />
        </button>
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.02}
          value={shownVolume}
          onChange={(e) => props.onVolumeChange(Number(e.target.value))}
          style={{ '--fill': `${shownVolume * 100}%` } as React.CSSProperties}
          className="range w-24 xl:w-28"
        />
        <button
          ref={props.expandRef}
          type="button"
          aria-label="Open Now Playing"
          aria-haspopup="dialog"
          onClick={props.onExpand}
          className={iconButton}
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </footer>
  );
});
