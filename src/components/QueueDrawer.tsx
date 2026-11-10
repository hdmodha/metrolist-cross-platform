import React from 'react';
import {
  ListMusic,
  Sliders,
  ArrowUp,
  ArrowDown,
  Trash2,
  Play,
  Shuffle,
  Repeat,
  Repeat1,
  ListX,
} from 'lucide-react';
import type { MetrolistTrack } from '../data/metrolistData';
import type { RepeatMode } from '../player/queueRules';
import { formatDurationMs } from '../utils/metrolistCore';
import { countRender } from '../utils/renderProbe';
import { SpectrumMeter } from './SpectrumMeter';

export type DrawerTab = 'QUEUE' | 'EQ';

interface QueueDrawerProps {
  activeTab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  activeTrackId: string;
  activeTrackIsLive: boolean;
  queue: MetrolistTrack[];
  /** Tracks the listener added by hand (they play before automatic radio picks). */
  userQueuedIds: ReadonlySet<string>;
  onPlayQueueItem: (trackId: string) => void;
  onMoveQueueItem: (trackId: string, direction: -1 | 1) => void;
  onRemoveQueueItem: (trackId: string) => void;
  onClearUpcoming: () => void;
  shuffleEnabled: boolean;
  onToggleShuffle: () => void;
  repeatMode: RepeatMode;
  onCycleRepeatMode: () => void;
  eqGains: number[];
  onChangeEqGain: (bandIdx: number, gainDb: number) => void;
  onResetEq: () => void;
  /** A local (synthesized) song is playing, so the spectrum has something to show. */
  spectrumActive: boolean;
}

const EQ_BAND_LABELS = ['60 Hz', '230 Hz', '910 Hz', '3.6 kHz', '14 kHz'];

interface QueueRowProps {
  track: MetrolistTrack;
  isCurrent: boolean;
  isHandQueued: boolean;
  isFirst: boolean;
  isLast: boolean;
  onPlay: (trackId: string) => void;
  onMove: (trackId: string, direction: -1 | 1) => void;
  onRemove: (trackId: string) => void;
}

const QueueRow = React.memo(function QueueRow({
  track,
  isCurrent,
  isHandQueued,
  isFirst,
  isLast,
  onPlay,
  onMove,
  onRemove,
}: QueueRowProps) {
  return (
    <li
      className={`flex items-center justify-between gap-1.5 p-2 rounded-xl border ${
        isCurrent ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-white/5 bg-zinc-950/60'
      }`}
    >
      <button
        type="button"
        onClick={() => onPlay(track.id)}
        aria-current={isCurrent ? 'true' : undefined}
        aria-label={`${isCurrent ? 'Now playing' : 'Play'} ${track.title} by ${track.artist}`}
        className="tap-target flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer rounded-lg py-0.5"
      >
        <Play className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-emerald-400 fill-current' : 'text-zinc-400'}`} />
        <div className="min-w-0 flex-1">
          <div className={`text-xs font-semibold truncate ${isCurrent ? 'text-emerald-400' : 'text-white'}`}>
            {track.title}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-zinc-400 min-w-0">
            {isCurrent && (
              <span className="shrink-0 rounded px-1 py-px bg-emerald-500/20 text-emerald-300 font-semibold">
                Now playing
              </span>
            )}
            {!isCurrent && isHandQueued && (
              <span className="shrink-0 rounded px-1 py-px bg-indigo-500/20 text-indigo-300 font-semibold">
                Queued
              </span>
            )}
            <span className="truncate">
              {track.artist} · {formatDurationMs(track.durationMs)}
            </span>
          </div>
        </div>
      </button>

      <div className="flex items-center shrink-0">
        <button
          type="button"
          aria-label={`Move ${track.title} up in queue`}
          disabled={isFirst}
          onClick={() => onMove(track.id, -1)}
          className="tap-target inline-flex items-center justify-center p-1.5 rounded hover:bg-white/10 text-zinc-400 hover:text-white disabled:opacity-30 cursor-pointer"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label={`Move ${track.title} down in queue`}
          disabled={isLast}
          onClick={() => onMove(track.id, 1)}
          className="tap-target inline-flex items-center justify-center p-1.5 rounded hover:bg-white/10 text-zinc-400 hover:text-white disabled:opacity-30 cursor-pointer"
        >
          <ArrowDown className="w-3.5 h-3.5" />
        </button>
        {!isCurrent && (
          <button
            type="button"
            aria-label={`Remove ${track.title} from queue`}
            onClick={() => onRemove(track.id)}
            className="tap-target inline-flex items-center justify-center p-1.5 rounded text-rose-400 hover:bg-rose-500/10 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </li>
  );
});

export const QueueDrawer = React.memo(function QueueDrawer({
  activeTab,
  onTabChange,
  activeTrackId,
  activeTrackIsLive,
  queue,
  userQueuedIds,
  onPlayQueueItem,
  onMoveQueueItem,
  onRemoveQueueItem,
  onClearUpcoming,
  shuffleEnabled,
  onToggleShuffle,
  repeatMode,
  onCycleRepeatMode,
  eqGains,
  onChangeEqGain,
  onResetEq,
  spectrumActive,
}: QueueDrawerProps) {
  countRender('QueueDrawer');
  const activeQueueIdx = queue.findIndex((item) => item.id === activeTrackId);
  const upcomingCount = Math.max(0, queue.length - activeQueueIdx - 1);
  const repeatLabel = repeatMode === 'OFF' ? 'Repeat off' : repeatMode === 'ALL' ? 'Repeat all' : 'Repeat one';

  const tabClass = (active: boolean) =>
    `tap-target flex items-center justify-center gap-1.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
      active ? 'bg-zinc-800 text-emerald-400' : 'text-zinc-400 hover:text-white'
    }`;
  const chipClass = (active: boolean) =>
    `tap-target inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-full border font-semibold cursor-pointer transition-colors ${
      active ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-zinc-400 hover:text-white'
    }`;

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-zinc-900/90 flex flex-col overflow-hidden">
      <div className="p-2.5 border-b border-white/10">
        <div role="tablist" aria-label="Inspector Drawer Tabs" className="grid grid-cols-2 w-full p-1 rounded-full bg-zinc-950/90">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'QUEUE'}
            onClick={() => onTabChange('QUEUE')}
            className={tabClass(activeTab === 'QUEUE')}
          >
            <ListMusic className="w-3.5 h-3.5" />
            <span>Queue ({queue.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'EQ'}
            onClick={() => onTabChange('EQ')}
            className={tabClass(activeTab === 'EQ')}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>EQ</span>
          </button>
        </div>
      </div>

      {activeTab === 'QUEUE' && (
        <div className="p-3 sm:p-4 flex-1 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
            <span className="font-semibold text-white">
              Queue
              <span className="font-mono tabular-nums font-normal text-zinc-400"> · {upcomingCount} up next</span>
            </span>

            {/* Shuffle & repeat live here too so they are reachable on phones */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" aria-pressed={shuffleEnabled} onClick={onToggleShuffle} className={chipClass(shuffleEnabled)}>
                <Shuffle className="w-3.5 h-3.5" />
                <span>Shuffle</span>
              </button>
              <button type="button" onClick={onCycleRepeatMode} className={chipClass(repeatMode !== 'OFF')}>
                {repeatMode === 'ONE' ? <Repeat1 className="w-3.5 h-3.5" /> : <Repeat className="w-3.5 h-3.5" />}
                <span>{repeatLabel}</span>
              </button>
              <button
                type="button"
                aria-label="Clear upcoming songs"
                disabled={upcomingCount === 0}
                onClick={onClearUpcoming}
                className={`${chipClass(false)} disabled:opacity-40 disabled:cursor-default`}
              >
                <ListX className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            </div>
          </div>

          <ul aria-label="Up next" className="space-y-1.5 max-h-[420px] overflow-y-auto overscroll-contain pr-1">
            {queue.map((item, idx) => (
              <QueueRow
                key={item.id}
                track={item}
                isCurrent={item.id === activeTrackId}
                isHandQueued={userQueuedIds.has(item.id)}
                isFirst={idx === 0}
                isLast={idx === queue.length - 1}
                onPlay={onPlayQueueItem}
                onMove={onMoveQueueItem}
                onRemove={onRemoveQueueItem}
              />
            ))}
          </ul>
        </div>
      )}

      {activeTab === 'EQ' && (
        <div className="p-4 flex-1 flex flex-col space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white">5-Band Equalizer</span>
            <button type="button" onClick={onResetEq} className="text-emerald-400 hover:underline cursor-pointer">
              Reset Flat
            </button>
          </div>

          {activeTrackIsLive && (
            <p className="text-[11px] leading-snug text-zinc-400">
              The equalizer shapes Local Studio tracks. YouTube Music streams play through YouTube&rsquo;s own player and
              are not affected.
            </p>
          )}

          <div className="space-y-3">
            {EQ_BAND_LABELS.map((label, idx) => (
              <div key={label} className="space-y-1">
                <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className="text-zinc-300">{label}</span>
                  <span className="text-emerald-400">{eqGains[idx] > 0 ? `+${eqGains[idx]}` : eqGains[idx]} dB</span>
                </div>
                <input
                  type="range"
                  aria-label={`Equalizer band ${label}`}
                  min={-12}
                  max={12}
                  step={1}
                  value={eqGains[idx]}
                  onChange={(e) => onChangeEqGain(idx, Number(e.target.value))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-white/10">
            <div className="text-[11px] font-mono text-zinc-400 mb-2">Audio Spectrum</div>
            <SpectrumMeter active={spectrumActive} />
          </div>
        </div>
      )}
    </div>
  );
});
