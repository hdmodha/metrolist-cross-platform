/**
 * JavaScript API of Metrolist's local Capacitor plugin `BackgroundPlayback` (Android only; the
 * native side is `android/src/main/java/com/metrolist/backgroundplayback/`).
 *
 * The page mirrors the player into the plugin (`update`, `stop`); the plugin owns the media session,
 * the media notification and the foreground service that keep the app playing in the background,
 * and sends the listener's commands back (`command` events: notification buttons, lock screen,
 * Bluetooth / headset buttons, headphones unplugged).
 *
 * It talks to the native bridge through the `window.Capacitor` global that Capacitor's Android shell
 * injects (`nativePromise`, `addListener`), like `src/utils/apiClient.ts` does for CapacitorHttp, so
 * the web bundle needs no `@capacitor/core` runtime. Outside an Android shell `createBackgroundPlayback`
 * returns `null` and nothing is ever sent.
 */

export const BACKGROUND_PLAYBACK_PLUGIN = 'BackgroundPlayback';
export const COMMAND_EVENT = 'command';

/** `buffering`: the listener wants to hear music that is not audible yet (loading, next song). */
export type BackgroundPlaybackState = 'playing' | 'paused' | 'buffering';

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
}

export type BackgroundPlaybackAction = 'play' | 'pause' | 'next' | 'previous' | 'seekTo';

/** Why a command was sent (informational). */
export type BackgroundPlaybackCommandReason = 'notification' | 'session' | 'noisy' | 'taskRemoved';

export interface BackgroundPlaybackCommand {
  action: BackgroundPlaybackAction;
  /** `seekTo` only. */
  positionMs?: number;
  reason?: BackgroundPlaybackCommandReason;
}

export interface BackgroundPlaybackPlugin {
  /** Shows / updates the media session and notification; `playing` / `buffering` keep the app in the foreground. */
  update: (update: BackgroundPlaybackUpdate) => Promise<void>;
  /** Nothing to play any more (the queue was cleared): removes the notification and stops the service. */
  stop: () => Promise<void>;
  /** Android 13+: asks for the notification permission once per install. Playback works either way. */
  ensureNotificationPermission: () => Promise<{ granted: boolean }>;
  /** Returns a function that removes the listener. */
  addCommandListener: (listener: (command: unknown) => void) => () => void;
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

/** The plugin, or `null` anywhere but in Capacitor's Android shell. */
export function createBackgroundPlayback(cap: CapacitorBridgeGlobal | undefined): BackgroundPlaybackPlugin | null {
  if (!cap || typeof cap.nativePromise !== 'function') return null;
  let android = false;
  try {
    android = !!cap.isNativePlatform?.() && cap.getPlatform?.() === 'android';
  } catch {
    android = false;
  }
  if (!android) return null;
  const call = (method: string, options: Record<string, unknown> = {}): Promise<unknown> => {
    try {
      return Promise.resolve(cap.nativePromise!(BACKGROUND_PLAYBACK_PLUGIN, method, options));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  return {
    update: (update) => call('update', { ...update }).then(() => undefined),
    stop: () => call('stop').then(() => undefined),
    ensureNotificationPermission: () =>
      call('ensureNotificationPermission').then((result) => ({
        granted: !!(result && typeof result === 'object' && (result as { granted?: unknown }).granted === true),
      })),
    addCommandListener: (listener) => {
      if (typeof cap.addListener !== 'function') return () => undefined;
      let handle: ReturnType<NonNullable<CapacitorBridgeGlobal['addListener']>>;
      try {
        handle = cap.addListener(BACKGROUND_PLAYBACK_PLUGIN, COMMAND_EVENT, (data) => listener(data));
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
    },
  };
}
