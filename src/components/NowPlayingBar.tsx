import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  ListMusic,
  Sliders,
  Loader2,
} from 'lucide-react';
import type { MetrolistTrack } from '../data/metrolistData';
import type { PlaybackClock } from '../player/playbackClock';
import type { RepeatMode } from '../player/queueRules';
import { countRender } from '../utils/renderProbe';
import type { DrawerTab } from './QueueDrawer';
import { SeekBar } from './SeekBar';

interface NowPlayingBarProps {
  track: MetrolistTrack | null;
  clock: PlaybackClock;
  isPlaying: boolean;
  isStreamLoading: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  volume: number;
  isMuted: boolean;
  drawerTab: DrawerTab;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (ms: number) => void;
  onToggleShuffle: () => void;
  onCycleRepeat: () => void;
  onVolumeChange: (volume: number) => void;
  onToggleMute: () => void;
  onOpenDrawerTab: (tab: DrawerTab) => void;
}

/** Display is set per button (`inline-flex`, or `hidden sm:inline-flex`), never in this shared class. */
const iconButton = 'tap-target items-center justify-center rounded-full transition-colors cursor-pointer';

/**
 * Fixed transport bar. It never re-renders on playback ticks: only the `SeekBar` inside it
 * subscribes to the playback clock.
 */
export const NowPlayingBar = React.memo(function NowPlayingBar({
  track,
  clock,
  isPlaying,
  isStreamLoading,
  shuffleEnabled,
  repeatMode,
  volume,
  isMuted,
  drawerTab,
  onTogglePlay,
  onNext,
  onPrevious,
  onSeek,
  onToggleShuffle,
  onCycleRepeat,
  onVolumeChange,
  onToggleMute,
  onOpenDrawerTab,
}: NowPlayingBarProps) {
  countRender('NowPlayingBar');
  const durationMs = track?.durationMs ?? 0;
  const effectivelyMuted = isMuted || volume === 0;
  const seekBar = <SeekBar clock={clock} durationMs={durationMs} onSeek={onSeek} />;

  return (
    <footer
      data-chrome="bottom"
      aria-label="Now Playing Audio Transport Bar"
      className="fixed bottom-0 inset-x-0 z-40 bg-[#09090B]/95 backdrop-blur-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      <div className="px-3 sm:px-6 py-2 sm:py-0 sm:h-20 short:sm:h-16 flex flex-col justify-center gap-1.5 sm:gap-0">
        <div className="sm:hidden">{seekBar}</div>
        <div className="max-w-[1600px] w-full mx-auto flex sm:grid sm:grid-cols-12 items-center gap-2 sm:gap-4">
          {/* Left: artwork & title */}
          <div className="flex-1 sm:col-span-3 flex items-center gap-2.5 sm:gap-3 min-w-0">
            {track && (
              <img
                src={track.coverUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="w-9 h-9 sm:w-12 sm:h-12 rounded-lg object-cover shrink-0 border border-white/10 bg-zinc-900"
              />
            )}
            <div className="min-w-0">
              <div className="text-xs sm:text-sm font-semibold text-white truncate">{track?.title ?? 'Nothing playing'}</div>
              <div className="text-[11px] sm:text-xs text-zinc-400 truncate">{track?.artist ?? ''}</div>
            </div>
          </div>

          {/* Center: transport + seek bar */}
          <div className="shrink-0 sm:col-span-6 flex flex-col items-center gap-1 min-w-0">
            <div className="flex items-center gap-0.5 sm:gap-3">
              <button
                type="button"
                aria-label={`Shuffle ${shuffleEnabled ? 'on' : 'off'}`}
                aria-pressed={shuffleEnabled}
                onClick={onToggleShuffle}
                className={`${iconButton} hidden sm:inline-flex p-1.5 ${
                  shuffleEnabled ? 'text-emerald-400' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Shuffle className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Previous Track"
                onClick={onPrevious}
                className={`${iconButton} inline-flex p-2 sm:p-1.5 text-zinc-300 hover:text-white`}
              >
                <SkipBack className="w-4 h-4 fill-current" />
              </button>
              <button
                type="button"
                aria-label={isPlaying ? 'Pause Playback' : 'Start Playback'}
                aria-busy={isStreamLoading}
                onClick={onTogglePlay}
                className="tap-target w-10 h-10 rounded-full bg-white hover:scale-105 active:scale-95 text-zinc-950 flex items-center justify-center transition-transform cursor-pointer shadow"
              >
                {isStreamLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>
              <button
                type="button"
                aria-label="Next Track"
                onClick={onNext}
                className={`${iconButton} inline-flex p-2 sm:p-1.5 text-zinc-300 hover:text-white`}
              >
                <SkipForward className="w-4 h-4 fill-current" />
              </button>
              <button
                type="button"
                aria-label={`Repeat: ${repeatMode === 'OFF' ? 'off' : repeatMode === 'ALL' ? 'all' : 'one song'}`}
                onClick={onCycleRepeat}
                className={`${iconButton} hidden sm:inline-flex p-1.5 ${
                  repeatMode !== 'OFF' ? 'text-emerald-400' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {repeatMode === 'ONE' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
              </button>
            </div>
            <div className="hidden sm:flex w-full max-w-lg">{seekBar}</div>
          </div>

          {/* Right: drawer switchers & volume */}
          <div className="shrink-0 sm:col-span-3 flex items-center justify-end gap-0.5 sm:gap-2">
            <button
              type="button"
              aria-label="Show Dynamic Queue Panel"
              onClick={() => onOpenDrawerTab('QUEUE')}
              className={`${iconButton} inline-flex p-1.5 sm:p-2 rounded-lg ${
                drawerTab === 'QUEUE' ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-400 hover:text-white'
              }`}
              title="Up Next Queue"
            >
              <ListMusic className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Show Equalizer Panel"
              onClick={() => onOpenDrawerTab('EQ')}
              className={`${iconButton} hidden md:inline-flex p-2 rounded-lg ${
                drawerTab === 'EQ' ? 'text-emerald-400 bg-emerald-500/10' : 'text-zinc-400 hover:text-white'
              }`}
              title="5-Band Equalizer"
            >
              <Sliders className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label={effectivelyMuted ? 'Unmute Audio' : 'Mute Audio'}
              onClick={onToggleMute}
              className={`${iconButton} hidden sm:inline-flex p-2 rounded-lg text-zinc-400 hover:text-white`}
            >
              {effectivelyMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <input
              type="range"
              aria-label="Master Volume"
              min={0}
              max={1}
              step={0.02}
              value={isMuted ? 0 : volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              className="hidden lg:block w-20 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
            />
          </div>
        </div>
      </div>
    </footer>
  );
});
