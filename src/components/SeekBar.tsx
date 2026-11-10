import React from 'react';
import type { PlaybackClock } from '../player/playbackClock';
import { formatDurationMs } from '../utils/metrolistCore';
import { countRender } from '../utils/renderProbe';

interface SeekBarProps {
  clock: PlaybackClock;
  durationMs: number;
  onSeek: (ms: number) => void;
  /** `inline`: times left and right of the bar (player bar); `stacked`: times below it (Now Playing). */
  layout?: 'inline' | 'stacked';
}

const time = (ms: number) => formatDurationMs(ms).replace(/^0(?=\d:)/, '');

/**
 * One of the only components that re-render on playback ticks: it subscribes to the playback clock
 * directly, so its parents never see the position change.
 */
export const SeekBar = React.memo(function SeekBar({ clock, durationMs, onSeek, layout = 'inline' }: SeekBarProps) {
  countRender('SeekBar');
  const positionMs = React.useSyncExternalStore(clock.subscribe, clock.getPositionMs, clock.getPositionMs);
  const shownMs = Math.min(positionMs, durationMs);
  const fill = durationMs > 0 ? `${(shownMs / durationMs) * 100}%` : '0%';
  const input = (
    <input
      type="range"
      aria-label="Seek playback position"
      aria-valuetext={`${formatDurationMs(shownMs)} of ${formatDurationMs(durationMs)}`}
      min={0}
      max={durationMs}
      step={1000}
      value={shownMs}
      onChange={(e) => onSeek(Number(e.target.value))}
      style={{ '--fill': fill } as React.CSSProperties}
      className="range w-full min-w-0 flex-1"
    />
  );
  if (layout === 'stacked') {
    return (
      <div className="w-full">
        {input}
        <div className="flex justify-between text-xs text-zinc-400 tabular-nums -mt-0.5 short:-mt-1.5">
          <span>{time(shownMs)}</span>
          <span>{time(durationMs)}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="w-full flex items-center gap-2">
      <span className="text-[11px] text-zinc-400 tabular-nums w-10 text-right shrink-0">{time(shownMs)}</span>
      {input}
      <span className="text-[11px] text-zinc-400 tabular-nums w-10 shrink-0">{time(durationMs)}</span>
    </div>
  );
});
