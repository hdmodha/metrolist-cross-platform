/**
 * The hidden debug log (`#/debug`, opened by a long press on the version in Library): the last
 * player, page and plugin events with timestamps, so a device test (background play on a phone) can
 * be read without a computer. The native plugin's own lines (logcat tag `Metrolist`) are merged in
 * when the page is opened (`BackgroundPlaybackPlugin.getDebugLog`).
 *
 * In memory only (nothing is stored or sent anywhere). Recording is a few string operations on
 * state changes, never on playback-clock ticks, and nothing renders it outside the debug page.
 */
import { selectActiveTrack, type PlayerState } from '../player/playerCore';
import { createPlaybackTimingTracker } from '../player/playbackTiming';
import type { PlayerStore } from '../player/playerStore';

export const DEBUG_LOG_CAPACITY = 100;
const MAX_MESSAGE_LENGTH = 500;

/** `player`: the player state; `plugin`: the page ↔ native plugin traffic; `page`: visibility, network; `native`: the plugin's own log. */
export type DebugSource = 'player' | 'plugin' | 'page' | 'native';
export type DebugLevel = 'info' | 'warn' | 'error';

export interface DebugEntry {
  /** Epoch milliseconds. */
  at: number;
  source: DebugSource;
  level: DebugLevel;
  message: string;
}

export interface DebugLog {
  add: (source: DebugSource, message: string, level?: DebugLevel) => void;
  /** Oldest first. */
  entries: () => DebugEntry[];
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
}

export function createDebugLog(capacity = DEBUG_LOG_CAPACITY, now: () => number = () => Date.now()): DebugLog {
  let entries: DebugEntry[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    add: (source, message, level = 'info') => {
      const entry: DebugEntry = { at: now(), source, level, message: message.slice(0, MAX_MESSAGE_LENGTH) };
      entries = entries.length >= capacity ? [...entries.slice(entries.length - capacity + 1), entry] : [...entries, entry];
      notify();
    },
    entries: () => entries,
    clear: () => {
      entries = [];
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's one debug log. */
export const debugLog = createDebugLog();

/** What changed between two player states, as log lines (empty when nothing worth logging changed). */
export function describePlayerChange(previous: PlayerState | null, next: PlayerState): string[] {
  const lines: string[] = [];
  const before = previous ? selectActiveTrack(previous) : null;
  const after = selectActiveTrack(next);
  if (!previous || previous.activeTrackId !== next.activeTrackId) {
    lines.push(after ? `Song: "${after.title}" by ${after.artist} (${after.videoId})` : 'Nothing loaded');
  } else if (before && after && before.videoId !== after.videoId) {
    lines.push(`Upload: ${after.videoId}`);
  }
  if (previous && previous.isPlaying !== next.isPlaying) lines.push(next.isPlaying ? 'Play' : 'Pause');
  else if (!previous && next.isPlaying) lines.push('Play');
  if (after && (!previous || previous.streamStatus !== next.streamStatus || previous.activeTrackId !== next.activeTrackId)) {
    lines.push(`Stream: ${next.streamStatus}`);
  }
  if ((previous?.network.waiting ?? false) !== next.network.waiting) {
    lines.push(next.network.waiting ? 'Waiting for the network' : 'Network back');
  }
  if (next.notice && next.notice.id !== previous?.notice?.id) lines.push(`Notice: ${next.notice.message}`);
  return lines;
}

/** Logs every player change described by `describePlayerChange`; returns the disconnect function. */
export function connectPlayerDebugLog(
  store: Pick<PlayerStore, 'getState' | 'subscribe'>,
  log: DebugLog = debugLog,
  now: () => number = () => performance.now()
): () => void {
  let previous: PlayerState | null = null;
  const timing = createPlaybackTimingTracker(now);
  const record = () => {
    const next = store.getState();
    if (next === previous) return;
    for (const line of describePlayerChange(previous, next)) log.add('player', line);
    const timingLine = timing.observe(previous, next);
    if (timingLine) log.add('player', timingLine);
    previous = next;
  };
  record();
  return store.subscribe(record);
}

export function mergeDebugEntries(js: readonly DebugEntry[], native: readonly DebugEntry[]): DebugEntry[] {
  // Stable: entries with the same time keep their order (JS first)
  return [...js, ...native]
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.at - b.entry.at || a.index - b.index)
    .map(({ entry }) => entry);
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** Local time `HH:MM:SS.mmm`. */
export function formatDebugTime(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** One line per entry, oldest first (what "Copy" puts on the clipboard). */
export function formatDebugLogText(entries: readonly DebugEntry[]): string {
  return entries.map((e) => `${formatDebugTime(e.at)} ${e.source} ${e.level} ${e.message}`).join('\n');
}
