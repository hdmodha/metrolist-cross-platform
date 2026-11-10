import React from 'react';
import type { PlaybackClock } from '../player/playbackClock';
import { formatDurationMs } from '../utils/metrolistCore';
import { countRender } from '../utils/renderProbe';

interface SeekBarProps {
  clock: PlaybackClock;
  durationMs: number;
  onSeek: (ms: number) => void;
}

/**
 * The only component that re-renders on playback ticks: it subscribes to the playback clock
 * directly, so its parents never see the position change.
 */
export const SeekBar = React.memo(function SeekBar({ clock, durationMs, onSeek }: SeekBarProps) {
  countRender('SeekBar');
  const positionMs = React.useSyncExternalStore(clock.subscribe, clock.getPositionMs, clock.getPositionMs);
  const shownMs = Math.min(positionMs, durationMs);
  return (
    <div className="w-full flex items-center gap-2">
      <span className="text-[10px] sm:text-[11px] font-mono text-zinc-400 tabular-nums w-8 sm:w-9 text-right shrink-0">
        {formatDurationMs(shownMs)}
      </span>
      <input
        type="range"
        aria-label="Seek playback position"
        aria-valuetext={`${formatDurationMs(shownMs)} of ${formatDurationMs(durationMs)}`}
        min={0}
        max={durationMs}
        step={1000}
        value={shownMs}
        onChange={(e) => onSeek(Number(e.target.value))}
        className="seek-range flex-1 min-w-0 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
      />
      <span className="text-[10px] sm:text-[11px] font-mono text-zinc-400 tabular-nums w-8 sm:w-9 shrink-0">
        {formatDurationMs(durationMs)}
      </span>
    </div>
  );
});
