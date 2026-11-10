import React from 'react';
import {
  Mic2,
  ListMusic,
  Sliders,
  ArrowUp,
  ArrowDown,
  Trash2,
  Play,
  Shuffle,
  Repeat,
  Repeat1,
} from 'lucide-react';
import type { MetrolistTrack } from '../data/metrolistData';
import {
  findActiveLyricIndex,
  formatDurationMs,
  parseSyncedLrc,
  type RepeatMode,
} from '../utils/metrolistCore';

interface LyricsAndQueueDrawerProps {
  activeTab: 'LYRICS' | 'QUEUE' | 'EQ';
  onTabChange: (tab: 'LYRICS' | 'QUEUE' | 'EQ') => void;
  activeTrack: MetrolistTrack;
  currentTimeMs: number;
  onSeekToMs: (ms: number) => void;
  queue: MetrolistTrack[];
  /** Tracks the listener added by hand (they play before automatic radio picks). */
  userQueuedIds: ReadonlySet<string>;
  onSelectTrack: (track: MetrolistTrack) => void;
  onMoveQueueItem: (index: number, direction: -1 | 1) => void;
  onRemoveQueueItem: (trackId: string) => void;
  shuffleEnabled: boolean;
  onToggleShuffle: () => void;
  repeatMode: RepeatMode;
  onCycleRepeatMode: () => void;
  eqGains: number[];
  onChangeEqGain: (bandIdx: number, gainDb: number) => void;
  frequencyLevels: number[];
  hardenedSecurityMode: boolean;
}

const EQ_BAND_LABELS = ['60 Hz', '230 Hz', '910 Hz', '3.6 kHz', '14 kHz'];

function getSpectrumHeightClass(level: number): string {
  if (level >= 85) return 'h-full';
  if (level >= 70) return 'h-4/5';
  if (level >= 55) return 'h-3/5';
  if (level >= 40) return 'h-2/5';
  if (level >= 25) return 'h-1/3';
  return 'h-1/5';
}

export const LyricsAndQueueDrawer: React.FC<LyricsAndQueueDrawerProps> = ({
  activeTab,
  onTabChange,
  activeTrack,
  currentTimeMs,
  onSeekToMs,
  queue,
  userQueuedIds,
  onSelectTrack,
  onMoveQueueItem,
  onRemoveQueueItem,
  shuffleEnabled,
  onToggleShuffle,
  repeatMode,
  onCycleRepeatMode,
  eqGains,
  onChangeEqGain,
  frequencyLevels,
  hardenedSecurityMode,
}) => {
  const parsedLyrics = React.useMemo(
    () => parseSyncedLrc(activeTrack.rawLrc, hardenedSecurityMode),
    [activeTrack.rawLrc, hardenedSecurityMode]
  );

  const activeLineIdx = React.useMemo(
    () => findActiveLyricIndex(parsedLyrics.lines, currentTimeMs),
    [parsedLyrics.lines, currentTimeMs]
  );

  // Keep the sung line centred inside the lyrics box (scrolls the box only, never the page)
  const lyricsBoxRef = React.useRef<HTMLDivElement | null>(null);
  const activeLineRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    const box = lyricsBoxRef.current;
    const line = activeLineRef.current;
    if (activeTab !== 'LYRICS' || !box || !line) return;
    const top = line.offsetTop - box.clientHeight / 2 + line.clientHeight / 2;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [activeLineIdx, activeTab, activeTrack.id]);

  const activeQueueIdx = queue.findIndex((item) => item.id === activeTrack.id);
  const repeatLabel =
    repeatMode === 'OFF' ? 'Repeat off' : repeatMode === 'ALL' ? 'Repeat all' : 'Repeat one';

  return (
    <div className="w-full rounded-2xl border border-white/10 bg-zinc-900/90 flex flex-col overflow-hidden">
      {/* Clean Spotify-Style Drawer Header */}
      <div className="p-2.5 border-b border-white/10">
        <div
          role="tablist"
          aria-label="Inspector Drawer Tabs"
          className="grid grid-cols-3 w-full p-1 rounded-full bg-zinc-950/90"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'LYRICS'}
            onClick={() => onTabChange('LYRICS')}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'LYRICS'
                ? 'bg-zinc-800 text-emerald-400'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Mic2 className="w-3.5 h-3.5" />
            <span>Lyrics</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'QUEUE'}
            onClick={() => onTabChange('QUEUE')}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'QUEUE'
                ? 'bg-zinc-800 text-emerald-400'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <ListMusic className="w-3.5 h-3.5" />
            <span>Queue ({queue.length})</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'EQ'}
            onClick={() => onTabChange('EQ')}
            className={`flex items-center justify-center gap-1.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              activeTab === 'EQ'
                ? 'bg-zinc-800 text-emerald-400'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>EQ</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Live Synced Lyrics */}
      {activeTab === 'LYRICS' && (
        <div className="p-4 flex-1 flex flex-col space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-zinc-300 font-semibold whitespace-nowrap">Synced Lyrics</span>
            <span className="text-zinc-400 whitespace-nowrap">Tap a line to seek</span>
          </div>

          <div
            ref={lyricsBoxRef}
            className="relative space-y-1.5 max-h-[420px] overflow-y-auto overscroll-contain pr-1"
          >
            {parsedLyrics.lines.map((line, index) => {
              const isCurrent = index === activeLineIdx;
              return (
                <button
                  key={`${line.timeMs}-${index}`}
                  ref={isCurrent ? activeLineRef : undefined}
                  aria-current={isCurrent ? 'true' : undefined}
                  type="button"
                  onClick={() => onSeekToMs(line.timeMs)}
                  className={`w-full text-left px-3 py-2 rounded-xl transition-colors cursor-pointer block ${
                    isCurrent
                      ? 'bg-white/10 text-white'
                      : 'hover:bg-white/5 text-zinc-400'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`text-sm leading-snug ${
                        isCurrent ? 'font-bold text-emerald-400' : 'font-medium'
                      }`}
                    >
                      {line.text}
                    </span>
                    <span className="font-mono text-[10px] text-zinc-500 tabular-nums shrink-0">
                      {line.formattedTime}
                    </span>
                  </div>
                  {line.translation && (
                    <div className="text-xs text-zinc-400 mt-0.5">{line.translation}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 2: Dynamic Queue Manager */}
      {activeTab === 'QUEUE' && (
        <div className="p-4 flex-1 flex flex-col space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
            <span className="font-semibold text-white">
              Queue
              <span className="font-mono tabular-nums font-normal text-zinc-400">
                {' '}
                · {Math.max(0, queue.length - activeQueueIdx - 1)} up next
              </span>
            </span>

            {/* Shuffle & repeat live here too so they are reachable on phones */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-pressed={shuffleEnabled}
                onClick={onToggleShuffle}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border font-semibold cursor-pointer transition-colors ${
                  shuffleEnabled
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>Shuffle</span>
              </button>
              <button
                type="button"
                onClick={onCycleRepeatMode}
                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border font-semibold cursor-pointer transition-colors ${
                  repeatMode !== 'OFF'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                    : 'border-white/10 text-zinc-400 hover:text-white'
                }`}
              >
                {repeatMode === 'ONE' ? (
                  <Repeat1 className="w-3.5 h-3.5" />
                ) : (
                  <Repeat className="w-3.5 h-3.5" />
                )}
                <span>{repeatLabel}</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5 max-h-[420px] overflow-y-auto overscroll-contain pr-1">
            {queue.map((item, idx) => {
              const isCurrent = item.id === activeTrack.id;
              return (
                <div
                  key={`${item.id}-${idx}`}
                  className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border ${
                    isCurrent
                      ? 'border-emerald-500/40 bg-emerald-500/10'
                      : 'border-white/5 bg-zinc-950/60'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectTrack(item)}
                    aria-current={isCurrent ? 'true' : undefined}
                    aria-label={`${isCurrent ? 'Now playing' : 'Play'} ${item.title} by ${item.artist}`}
                    className="flex items-center gap-2.5 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <Play
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isCurrent ? 'text-emerald-400 fill-current' : 'text-zinc-400'
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-xs font-semibold truncate ${
                          isCurrent ? 'text-emerald-400' : 'text-white'
                        }`}
                      >
                        {item.title}
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate">
                        {isCurrent ? 'Now playing · ' : userQueuedIds.has(item.id) ? 'Queued · ' : ''}
                        {item.artist} · {formatDurationMs(item.durationMs)}
                      </div>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      aria-label={`Move ${item.title} up in queue`}
                      disabled={idx === 0}
                      onClick={() => onMoveQueueItem(idx, -1)}
                      className="p-1.5 rounded hover:bg-white/10 text-zinc-400 hover:text-white disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${item.title} down in queue`}
                      disabled={idx === queue.length - 1}
                      onClick={() => onMoveQueueItem(idx, 1)}
                      className="p-1.5 rounded hover:bg-white/10 text-zinc-400 hover:text-white disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    {!isCurrent && (
                      <button
                        type="button"
                        aria-label={`Remove ${item.title} from queue`}
                        onClick={() => onRemoveQueueItem(item.id)}
                        className="p-1.5 rounded text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab 3: 5-Band Equalizer & Spectrum Visualizer */}
      {activeTab === 'EQ' && (
        <div className="p-4 flex-1 flex flex-col space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-white">5-Band Equalizer</span>
            <button
              type="button"
              onClick={() => [0, 1, 2, 3, 4].forEach((idx) => onChangeEqGain(idx, 0))}
              className="text-emerald-400 hover:underline cursor-pointer"
            >
              Reset Flat
            </button>
          </div>

          {activeTrack.isLiveInnerTube && (
            <p className="text-[11px] leading-snug text-zinc-400">
              The equalizer shapes Local Studio tracks. YouTube Music streams play through
              YouTube&rsquo;s own player and are not affected.
            </p>
          )}

          <div className="space-y-3">
            {EQ_BAND_LABELS.map((label, idx) => (
              <div key={label} className="space-y-1">
                <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                  <span className="text-zinc-300">{label}</span>
                  <span className="text-emerald-400">
                    {eqGains[idx] > 0 ? `+${eqGains[idx]}` : eqGains[idx]} dB
                  </span>
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

          {/* Live Frequency Spectrum Bars */}
          <div className="pt-2 border-t border-white/10">
            <div className="text-[11px] font-mono text-zinc-400 mb-2">Audio Spectrum</div>
            <div className="h-24 flex items-end justify-between gap-1.5 px-2 py-2 rounded-xl bg-zinc-950 border border-white/5">
              {frequencyLevels.map((lvl, idx) => (
                <div
                  key={idx}
                  className={`flex-1 bg-emerald-500 rounded-t transition-all duration-150 ${getSpectrumHeightClass(
                    lvl
                  )}`}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
