import React from 'react';
import { Heart, LoaderCircle, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from 'lucide-react';
import type { RepeatMode } from '../player/queueRules';

const iconButton =
  'tap-target inline-flex items-center justify-center rounded-full transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default';

export const LikeButton = React.memo(function LikeButton({
  liked,
  onToggle,
  className = '',
  iconClassName = 'w-5 h-5',
}: {
  liked: boolean;
  onToggle: () => void;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <button
      type="button"
      aria-label={liked ? 'Remove from Liked Songs' : 'Save to Liked Songs'}
      onClick={onToggle}
      className={`${iconButton} ${liked ? 'text-emerald-400' : 'text-zinc-300 hover:text-white'} ${className}`}
    >
      <Heart className={`${iconClassName} ${liked ? 'fill-current' : ''}`} />
    </button>
  );
});

export const PlayPauseButton = React.memo(function PlayPauseButton({
  isPlaying,
  isLoading,
  onToggle,
  size = 'md',
  className = '',
}: {
  isPlaying: boolean;
  isLoading: boolean;
  onToggle: () => void;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const box = size === 'lg' ? 'w-16 h-16 short:w-12 short:h-12' : size === 'md' ? 'w-9 h-9' : 'w-10 h-10';
  const icon = size === 'lg' ? 'w-7 h-7 short:w-5 short:h-5' : 'w-4 h-4';
  const look =
    size === 'sm'
      ? 'text-white'
      : 'bg-white text-zinc-950 hover:scale-105 active:scale-95 transition-transform shadow-lg shadow-black/30';
  return (
    <button
      type="button"
      aria-label={isPlaying ? 'Pause Playback' : 'Start Playback'}
      aria-busy={isLoading}
      onClick={onToggle}
      className={`tap-target inline-flex items-center justify-center rounded-full cursor-pointer shrink-0 ${box} ${look} ${className}`}
    >
      {isLoading ? (
        <LoaderCircle className={`${icon} animate-spin`} />
      ) : isPlaying ? (
        <Pause className={`${icon} fill-current`} />
      ) : (
        <Play className={`${icon} fill-current ${size === 'sm' ? '' : 'ml-0.5'}`} />
      )}
    </button>
  );
});

interface TransportProps {
  isPlaying: boolean;
  isLoading: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  size: 'md' | 'lg';
}

const REPEAT_LABEL: Record<RepeatMode, string> = { OFF: 'Repeat: off', ALL: 'Repeat: all', ONE: 'Repeat: one' };

/** Shuffle · Previous · Play / Pause · Next · Repeat (player bar and Now Playing). */
export const TransportControls = React.memo(function TransportControls({
  isPlaying,
  isLoading,
  shuffleEnabled,
  repeatMode,
  onTogglePlay,
  onNext,
  onPrevious,
  onToggleShuffle,
  onCycleRepeat,
  size,
}: TransportProps) {
  const large = size === 'lg';
  const side = large ? 'w-7 h-7 short:w-6 short:h-6' : 'w-5 h-5';
  const skip = large ? 'w-8 h-8 short:w-6 short:h-6' : 'w-5 h-5';
  const pad = large ? 'p-2' : 'p-1.5';
  const toggleClass = (on: boolean) =>
    `${iconButton} ${pad} relative ${on ? 'text-emerald-400' : 'text-zinc-400 hover:text-white'}`;
  const dot = <span aria-hidden="true" className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-current" />;
  return (
    <div className={`flex items-center ${large ? 'justify-between w-full' : 'justify-center gap-4'}`}>
      <button type="button" aria-label="Shuffle" aria-pressed={shuffleEnabled} onClick={onToggleShuffle} className={toggleClass(shuffleEnabled)}>
        <Shuffle className={large ? 'w-6 h-6 short:w-5 short:h-5' : 'w-4 h-4'} />
        {shuffleEnabled && dot}
      </button>
      <button type="button" aria-label="Previous Track" onClick={onPrevious} className={`${iconButton} ${pad} text-white/90 hover:text-white`}>
        <SkipBack className={`${skip} fill-current`} />
      </button>
      <PlayPauseButton isPlaying={isPlaying} isLoading={isLoading} onToggle={onTogglePlay} size={large ? 'lg' : 'md'} />
      <button type="button" aria-label="Next Track" onClick={onNext} className={`${iconButton} ${pad} text-white/90 hover:text-white`}>
        <SkipForward className={`${skip} fill-current`} />
      </button>
      <button type="button" aria-label={REPEAT_LABEL[repeatMode]} onClick={onCycleRepeat} className={toggleClass(repeatMode !== 'OFF')}>
        {repeatMode === 'ONE' ? <Repeat1 className={large ? side : 'w-4 h-4'} /> : <Repeat className={large ? side : 'w-4 h-4'} />}
        {repeatMode !== 'OFF' && dot}
      </button>
    </div>
  );
});
