/**
 * JavaScript API of Metrolist's local Capacitor plugin `BackgroundPlayback`, the same on Android
 * (`android/src/main/java/com/metrolist/backgroundplayback/`) and iOS (`ios/Plugin/`, untested on a
 * device).
 *
 * The page mirrors the player into the plugin (`update`, `stop`); the plugin owns the media session,
 * the media notification / lock-screen controls and what keeps the app playing in the background
 * (Android: a WebView kept visible + a foreground service; iOS: the audio session + background audio
 * mode), and sends the listener's commands back (`command` events: notification buttons, lock
 * screen, Bluetooth / headset buttons, headphones unplugged, and `play` once when the system paused
 * the player right after the app went to the background). `lifecycle` events tell the page the app
 * is leaving / back in the foreground, so it saves its state even though it stays "visible".
 *
 * It talks to the native bridge through the `window.Capacitor` global that Capacitor's native shells
 * inject (`nativePromise`, `addListener`), like `src/utils/apiClient.ts` does for CapacitorHttp, so
 * the web bundle needs no `@capacitor/core` runtime. Outside an Android / iOS shell
 * `createBackgroundPlayback` returns `null` and nothing is ever sent.
 */

export const BACKGROUND_PLAYBACK_PLUGIN = 'BackgroundPlayback';
export const COMMAND_EVENT = 'command';
export const LIFECYCLE_EVENT = 'lifecycle';
/** The native shells that have this plugin. */
export const BACKGROUND_PLAYBACK_PLATFORMS = ['android', 'ios'] as const;
export type BackgroundPlaybackPlatform = (typeof BACKGROUND_PLAYBACK_PLATFORMS)[number];

/** `buffering`: the listener wants to hear music that is not audible yet (loading, next song). */
export type BackgroundPlaybackState = 'playing' | 'paused' | 'buffering';

/**
 * Who paused (with `state: 'paused'`): `user` (the app's controls, the notification, a headset,
 * the end of the queue: anything but the player) or `player` (the YouTube player paused itself, e.g.
 * the system pausing a page that went to the background). Only a `player` pause right after the
 * app went to the background is ever resumed by the plugin, once.
 */
export type BackgroundPlaybackPausedBy = 'user' | 'player';

/** What the notification, the lock screen and Bluetooth devices show. */
export interface BackgroundPlaybackUpdate {
  title: string;
  artist: string;
  album: string;
  /** http(s) URL of the cover; the native side downloads it (size-limited, off the main thread). */
  artworkUrl: string;
  /** 0 when unknown. */
  durationMs: number;
  /** Position when this update was made; the native side extrapolates it while `playing`. */
  positionMs: number;
  state: BackgroundPlaybackState;
  /** With `state: 'paused'` only. */
  pausedBy?: BackgroundPlaybackPausedBy;
}

export type BackgroundPlaybackAction = 'play' | 'pause' | 'next' | 'previous' | 'seekTo';

/**
 * Why a command was sent (informational): `systemPause` is the plugin's one `play` after the system
 * paused the player right after the app went to the background.
 */
export type BackgroundPlaybackCommandReason = 'notification' | 'session' | 'noisy' | 'taskRemoved' | 'systemPause';

export interface BackgroundPlaybackCommand {
  action: BackgroundPlaybackAction;
  /** `seekTo` only. */
  positionMs?: number;
  reason?: BackgroundPlaybackCommandReason;
}

/**
 * The app's activity / scene: `pause` (leaving the foreground, or a system dialog over it), `stop`
 * (in the background), `resume` (in the foreground again).
 */
export type BackgroundPlaybackLifecycleState = 'pause' | 'stop' | 'resume';

/** A line of the plugin's own diagnostics (logcat tag `Metrolist` / the iOS console). */
export interface NativeDebugEntry {
  /** Epoch milliseconds. */
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface BackgroundPlaybackPlugin {
  platform: BackgroundPlaybackPlatform;
  /** Shows / updates the media session and notification; `playing` / `buffering` keep the app in the foreground. */
  update: (update: BackgroundPlaybackUpdate) => Promise<void>;
  /** Nothing to play any more (the queue was cleared): removes the notification and stops the service. */
  stop: () => Promise<void>;
  /** Android 13+: asks for the notification permission once per install. Playback works either way. */
  ensureNotificationPermission: () => Promise<{ granted: boolean }>;
  /** The plugin's last diagnostics lines, oldest first (for the hidden debug log). */
  getDebugLog: () => Promise<NativeDebugEntry[]>;
  /** Returns a function that removes the listener. */
  addCommandListener: (listener: (command: unknown) => void) => () => void;
  /** `{ state: 'pause' | 'stop' | 'resume' }` events. Returns a function that removes the listener. */
  addLifecycleListener: (listener: (event: unknown) => void) => () => void;
}

/** The plugin's `getDebugLog` answer, validated (anything malformed is dropped). */
export function parseNativeDebugLog(result: unknown): NativeDebugEntry[] {
  const entries = result && typeof result === 'object' ? (result as { entries?: unknown }).entries : undefined;
  if (!Array.isArray(entries)) return [];
  const out: NativeDebugEntry[] = [];
  for (const entry of entries.slice(-500)) {
    if (!entry || typeof entry !== 'object') continue;
    const { at, level, message } = entry as { at?: unknown; level?: unknown; message?: unknown };
    if (typeof at !== 'number' || !Number.isFinite(at) || typeof message !== 'string') continue;
    out.push({ at, level: level === 'warn' || level === 'error' ? level : 'info', message: message.slice(0, 1000) });
  }
  return out;
}

/** The parts of Capacitor's injected `window.Capacitor` global this plugin uses. */
export interface CapacitorBridgeGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  nativePromise?: (pluginName: string, methodName: string, options?: Record<string, unknown>) => Promise<unknown>;
  addListener?: (
    pluginName: string,
    eventName: string,
    callback: (data: unknown) => void
  ) => { remove: () => Promise<void> | void } | undefined;
}

/** The plugin, or `null` anywhere but in Capacitor's Android / iOS shell. */
export function createBackgroundPlayback(cap: CapacitorBridgeGlobal | undefined): BackgroundPlaybackPlugin | null {
  if (!cap || typeof cap.nativePromise !== 'function') return null;
  let platform: BackgroundPlaybackPlatform | null = null;
  try {
    const name = cap.isNativePlatform?.() ? cap.getPlatform?.() : undefined;
    platform = BACKGROUND_PLAYBACK_PLATFORMS.find((p) => p === name) ?? null;
  } catch {
    platform = null;
  }
  if (!platform) return null;
  const call = (method: string, options: Record<string, unknown> = {}): Promise<unknown> => {
    try {
      return Promise.resolve(cap.nativePromise!(BACKGROUND_PLAYBACK_PLUGIN, method, options));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const listen = (eventName: string, listener: (data: unknown) => void): (() => void) => {
    if (typeof cap.addListener !== 'function') return () => undefined;
    let handle: ReturnType<NonNullable<CapacitorBridgeGlobal['addListener']>>;
    try {
      handle = cap.addListener(BACKGROUND_PLAYBACK_PLUGIN, eventName, (data) => listener(data));
    } catch {
      return () => undefined;
    }
    return () => {
      try {
        void handle?.remove();
      } catch {
        // the bridge is going away with the page
      }
    };
  };
  return {
    platform,
    update: (update) => call('update', { ...update }).then(() => undefined),
    stop: () => call('stop').then(() => undefined),
    ensureNotificationPermission: () =>
      call('ensureNotificationPermission').then((result) => ({
        granted: !!(result && typeof result === 'object' && (result as { granted?: unknown }).granted === true),
      })),
    getDebugLog: () => call('getDebugLog').then(parseNativeDebugLog, () => []),
    addCommandListener: (listener) => listen(COMMAND_EVENT, listener),
    addLifecycleListener: (listener) => listen(LIFECYCLE_EVENT, listener),
  };
}
