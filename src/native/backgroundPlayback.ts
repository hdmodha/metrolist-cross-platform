/**
 * Android background play: mirrors the player into Metrolist's local Capacitor plugin
 * (`native/capacitor-background-playback`), which shows the media notification / lock-screen
 * controls and keeps the app alive in a foreground service, and turns the plugin's commands
 * (notification buttons, lock screen, Bluetooth / headset, headphones unplugged) into the player's
 * own actions.
 *
 * Android native shell only: on the web, the desktop app and iOS `getAndroidBackgroundPlayback()`
 * is `null` and nothing here runs. The mapping is pure and unit-tested; `connectBackgroundPlayback`
 * reads the store and the playback clock through their subscriptions (no React state, so the
 * position ticks re-render nothing).
 */
import {
  createBackgroundPlayback,
  type BackgroundPlaybackPlugin,
  type BackgroundPlaybackState,
  type BackgroundPlaybackUpdate,
  type CapacitorBridgeGlobal,
} from '@metrolist/capacitor-background-playback';
import type { PlaybackClock } from '../player/playbackClock';
import { selectActiveTrack, type PlayerState, type StreamStatus } from '../player/playerCore';
import type { PlayerStore } from '../player/playerStore';
import { isNativeShell } from '../utils/apiClient';

/** While playing, the position is re-sent at most this often (the native side extrapolates it). */
export const POSITION_SYNC_INTERVAL_MS = 5000;
/** A position this far from where playback would be is a seek, sent at once. */
const PLAYING_SEEK_TOLERANCE_MS = 2000;
const PAUSED_SEEK_TOLERANCE_MS = 1000;

/** The plugin, in the packaged Android app only. */
export function getAndroidBackgroundPlayback(): BackgroundPlaybackPlugin | null {
  if (typeof window === 'undefined' || !isNativeShell()) return null;
  return createBackgroundPlayback((window as unknown as { Capacitor?: CapacitorBridgeGlobal }).Capacitor);
}

/**
 * `playing` when audible; `buffering` while the listener wants music that is not audible yet
 * (loading, the next song, a stalled stream): the app stays in the foreground then too, or Android
 * could stop it between two songs; `paused` when the listener paused.
 */
export function playbackStateFor(isPlaying: boolean, streamStatus: StreamStatus): BackgroundPlaybackState {
  if (!isPlaying) return 'paused';
  return streamStatus === 'playing' ? 'playing' : 'buffering';
}

function httpUrlOrEmpty(url: string): string {
  return /^https?:\/\//i.test(url) ? url : '';
}

/** What the notification shows for the active song, or `null` when nothing is loaded. */
export function toBackgroundUpdate(state: PlayerState, positionMs: number): BackgroundPlaybackUpdate | null {
  const track = selectActiveTrack(state);
  if (!track) return null;
  const durationMs = Number.isFinite(track.durationMs) && track.durationMs > 0 ? Math.round(track.durationMs) : 0;
  let position = Number.isFinite(positionMs) ? Math.max(0, Math.round(positionMs)) : 0;
  if (durationMs > 0) position = Math.min(position, durationMs);
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    artworkUrl: httpUrlOrEmpty(track.coverUrl),
    durationMs,
    positionMs: position,
    state: playbackStateFor(state.isPlaying, state.streamStatus),
  };
}

export interface SentUpdate {
  update: BackgroundPlaybackUpdate;
  sentAtMs: number;
}

function sameMetadata(a: BackgroundPlaybackUpdate, b: BackgroundPlaybackUpdate): boolean {
  return a.title === b.title && a.artist === b.artist && a.album === b.album && a.artworkUrl === b.artworkUrl && a.durationMs === b.durationMs;
}

/**
 * Whether the plugin needs to hear about `next`: a new song, new metadata or a new state at once;
 * the position on a seek at once and otherwise at most every 5 s while playing. Nothing is shown
 * before the first play (a restored session is paused); `stop` once nothing is loaded any more.
 */
export function planBackgroundSync(last: SentUpdate | null, next: BackgroundPlaybackUpdate | null, nowMs: number): 'send' | 'stop' | 'skip' {
  if (!next) return last ? 'stop' : 'skip';
  if (!last) return next.state === 'paused' ? 'skip' : 'send';
  if (!sameMetadata(last.update, next) || last.update.state !== next.state) return 'send';
  const elapsed = Math.max(0, nowMs - last.sentAtMs);
  if (last.update.state === 'playing') {
    const expected = last.update.positionMs + elapsed;
    if (Math.abs(next.positionMs - expected) > PLAYING_SEEK_TOLERANCE_MS) return 'send';
    return elapsed >= POSITION_SYNC_INTERVAL_MS ? 'send' : 'skip';
  }
  return Math.abs(next.positionMs - last.update.positionMs) >= PAUSED_SEEK_TOLERANCE_MS ? 'send' : 'skip';
}

export type PlayerCall =
  | { kind: 'setPlaying'; playing: boolean }
  | { kind: 'next' }
  | { kind: 'previous' }
  | { kind: 'seekTo'; ms: number };

/** A command event of the plugin as a player call; `null` for anything malformed. */
export function commandToPlayerCall(command: unknown): PlayerCall | null {
  if (!command || typeof command !== 'object') return null;
  const { action, positionMs } = command as { action?: unknown; positionMs?: unknown };
  switch (action) {
    case 'play':
      return { kind: 'setPlaying', playing: true };
    case 'pause':
      // Also when headphones are unplugged (reason `noisy`): never blast the speaker
      return { kind: 'setPlaying', playing: false };
    case 'next':
      return { kind: 'next' };
    case 'previous':
      return { kind: 'previous' };
    case 'seekTo':
      if (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0) return null;
      return { kind: 'seekTo', ms: Math.round(positionMs) };
    default:
      return null;
  }
}

/** The subset of `usePlayer().actions` the plugin's commands use. */
export interface BackgroundPlayerActions {
  setPlaying: (playing: boolean) => void;
  next: () => void;
  previous: () => void;
  seekTo: (ms: number) => void;
}

/**
 * Keeps the plugin in sync with the player and routes its commands to `actions`. Returns the
 * function that disconnects both directions. Plugin calls are fire-and-forget: a failing bridge
 * never affects playback.
 */
export function connectBackgroundPlayback(options: {
  plugin: BackgroundPlaybackPlugin;
  store: Pick<PlayerStore, 'getState' | 'subscribe'>;
  clock: Pick<PlaybackClock, 'getPositionMs' | 'subscribe'>;
  actions: BackgroundPlayerActions;
  now?: () => number;
}): () => void {
  const { plugin, store, clock, actions } = options;
  const now = options.now ?? (() => Date.now());
  let last: SentUpdate | null = null;
  let askedForNotifications = false;
  let connected = true;

  const ignore = () => undefined;
  const sync = () => {
    if (!connected) return;
    const next = toBackgroundUpdate(store.getState(), clock.getPositionMs());
    const at = now();
    const plan = planBackgroundSync(last, next, at);
    if (plan === 'skip') return;
    if (plan === 'stop' || !next) {
      last = null;
      plugin.stop().catch(ignore);
      return;
    }
    last = { update: next, sentAtMs: at };
    plugin.update(next).catch(ignore);
    if (!askedForNotifications && next.state !== 'paused') {
      askedForNotifications = true;
      plugin.ensureNotificationPermission().catch(ignore);
    }
  };

  const removeCommandListener = plugin.addCommandListener((command) => {
    const call = commandToPlayerCall(command);
    if (!call) return;
    if (call.kind === 'setPlaying') actions.setPlaying(call.playing);
    else if (call.kind === 'next') actions.next();
    else if (call.kind === 'previous') actions.previous();
    else actions.seekTo(call.ms);
  });
  const unsubscribeStore = store.subscribe(sync);
  const unsubscribeClock = clock.subscribe(sync);
  sync();

  return () => {
    connected = false;
    unsubscribeStore();
    unsubscribeClock();
    removeCommandListener();
  };
}
