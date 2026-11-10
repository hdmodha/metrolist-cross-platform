import React from 'react';
import type { PlaybackClock } from '../player/playbackClock';
import { countRender } from '../utils/renderProbe';

/** The mini player's thin progress line. Subscribes to the clock itself (its parent never re-renders on ticks). */
export const ProgressLine = React.memo(function ProgressLine({ clock, durationMs }: { clock: PlaybackClock; durationMs: number }) {
  countRender('ProgressLine');
  const positionMs = React.useSyncExternalStore(clock.subscribe, clock.getPositionMs, clock.getPositionMs);
  const ratio = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  return (
    <div aria-hidden="true" className="h-[2px] w-full rounded-full bg-white/15 overflow-hidden">
      <div className="h-full w-full bg-white origin-left" style={{ transform: `scaleX(${ratio})` }} />
    </div>
  );
});
