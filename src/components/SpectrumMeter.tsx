import React from 'react';
import { sharedAudioEngine } from '../utils/webAudioSynth';

const BAR_COUNT = 16;
const POLL_MS = 250;
const IDLE_LEVELS = Array.from({ length: BAR_COUNT }, () => 10);

function heightClass(level: number): string {
  if (level >= 85) return 'h-full';
  if (level >= 70) return 'h-4/5';
  if (level >= 55) return 'h-3/5';
  if (level >= 40) return 'h-2/5';
  if (level >= 25) return 'h-1/3';
  return 'h-1/5';
}

/**
 * Self-contained spectrum display: polls the synth engine only while it is mounted (the EQ tab is
 * open) and `active` (a local song is playing), so it never drives app-wide renders.
 */
export const SpectrumMeter = React.memo(function SpectrumMeter({ active }: { active: boolean }) {
  const [levels, setLevels] = React.useState<number[]>(IDLE_LEVELS);
  React.useEffect(() => {
    if (!active) {
      setLevels(IDLE_LEVELS);
      return;
    }
    const timer = window.setInterval(() => setLevels(sharedAudioEngine.getFrequencyLevels(BAR_COUNT)), POLL_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  return (
    <div
      aria-hidden="true"
      className="h-24 flex items-end justify-between gap-1.5 px-2 py-2 rounded-xl bg-zinc-950 border border-white/5"
    >
      {levels.map((level, idx) => (
        <div key={idx} className={`flex-1 bg-emerald-500 rounded-t transition-all duration-150 ${heightClass(level)}`} />
      ))}
    </div>
  );
});
