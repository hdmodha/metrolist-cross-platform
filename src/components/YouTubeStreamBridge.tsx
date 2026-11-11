import React from 'react';
import { STREAM_ERROR_API_UNAVAILABLE } from '../player/effectPolicies';
import type { StreamStatus } from '../player/playerCore';

/*
 * Stream status reported to the player core:
 * - `loading`:   the player (or a new video) is still being set up
 * - `buffering`: the stream is stalled waiting for data
 * - `playing` / `paused`: self-explanatory
 * - `blocked`:   the browser refused to start audio without a tap on the player itself
 *                (iOS Safari, strict autoplay policies) — the player is revealed so it can be tapped
 */

interface YouTubeStreamBridgeProps {
  videoId: string;
  isPlaying: boolean;
  volume: number; // 0..1
  isMuted: boolean;
  /** A new `token` asks for a seek; it is reported handled only once it was applied. */
  seekRequest: { token: number; ms: number } | null;
  onSeekHandled: (token: number) => void;
  /** Where a newly created player starts (read whenever the player is created). */
  initialPositionMs: number;
  /** Changing it tears the player down and creates it again (network retry). */
  retryNonce: number;
  onStatusChange: (status: StreamStatus) => void;
  onTimeUpdateMs: (currentMs: number, durationMs?: number) => void;
  onEnded: () => void;
  /** YouTube player error code (2, 5, 100, 101, 150) or `STREAM_ERROR_API_UNAVAILABLE`. */
  onError: (code: number) => void;
  /** The stream was paused / resumed outside the app UI (OS media keys, headset button, tap on player). */
  onExternalPlayPause?: (playing: boolean) => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId?: string;
          width?: string | number;
          height?: string | number;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (ev: { target: YTPlayerInstance }) => void;
            onStateChange?: (ev: { data: number; target: YTPlayerInstance }) => void;
            onError?: (ev: { data: number }) => void;
          };
        }
      ) => YTPlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayerInstance {
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  cueVideoById: (videoId: string, startSeconds?: number) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume0to100: number) => void;
  mute: () => void;
  unMute: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

const YT_STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 } as const;

const API_LOAD_TIMEOUT_MS = 15000;
/** How long a requested start may sit in "unstarted" before we assume autoplay was refused. */
const START_WATCHDOG_MS = 6000;
const START_WATCHDOG_AFTER_BLOCK_MS = 1800;
/** Grace period before a pause / play that the app did not ask for is treated as external. */
const EXTERNAL_STATE_SETTLE_MS = 700;

interface ApiListener {
  ready: () => void;
  fail: () => void;
}

let ytApiLoading = false;
const apiListeners: ApiListener[] = [];

function flushApiListeners(outcome: keyof ApiListener) {
  const pending = apiListeners.splice(0, apiListeners.length);
  for (const listener of pending) {
    listener[outcome]();
  }
}

function loadYouTubeIframeApi(listener: ApiListener) {
  if (typeof window === 'undefined') return;
  if (window.YT && window.YT.Player) {
    listener.ready();
    return;
  }
  apiListeners.push(listener);
  if (ytApiLoading) return;
  ytApiLoading = true;

  let settled = false;
  const settle = (outcome: keyof ApiListener) => {
    if (settled) return;
    settled = true;
    ytApiLoading = false;
    window.clearTimeout(timeoutId);
    flushApiListeners(outcome);
  };

  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    if (prev) prev();
    settle('ready');
  };

  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  script.async = true;
  script.onerror = () => {
    script.remove();
    settle('fail');
  };
  const timeoutId = window.setTimeout(() => {
    if (!(window.YT && window.YT.Player)) {
      script.remove();
      settle('fail');
    }
  }, API_LOAD_TIMEOUT_MS);
  document.head.appendChild(script);
}

export const YouTubeStreamBridge: React.FC<YouTubeStreamBridgeProps> = (props) => {
  const { videoId, isPlaying, volume, isMuted, seekRequest, retryNonce } = props;

  const hostRef = React.useRef<HTMLDivElement | null>(null);
  const playerRef = React.useRef<YTPlayerInstance | null>(null);
  const isReadyRef = React.useRef(false);
  const apiFailedRef = React.useRef(false);
  const loadedVideoIdRef = React.useRef(videoId);
  const everBlockedRef = React.useRef(false);
  const watchdogRef = React.useRef<number | null>(null);
  const settleTimerRef = React.useRef<number | null>(null);
  const initPlayerRef = React.useRef<() => void>(() => {});
  /** A seek requested before the player was ready: applied (and reported) on ready. */
  const pendingSeekRef = React.useRef<{ token: number; ms: number } | null>(null);
  const [isBlocked, setIsBlocked] = React.useState(false);

  // Always call the latest callbacks / read the latest props from long-lived player event handlers.
  // (Capturing them once at mount made "track ended" act on a stale queue.)
  const latest = React.useRef(props);
  latest.current = props;

  const clearWatchdog = React.useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  /** After asking the player to start, verify that it really left the "unstarted" state. */
  const armStartWatchdog = React.useCallback(() => {
    clearWatchdog();
    watchdogRef.current = window.setTimeout(
      () => {
        watchdogRef.current = null;
        const player = playerRef.current;
        if (!player || !isReadyRef.current || !latest.current.isPlaying) return;
        let state: number = YT_STATE.UNSTARTED;
        try {
          state = player.getPlayerState();
        } catch {
          // keep UNSTARTED
        }
        if (state === YT_STATE.UNSTARTED || state === YT_STATE.CUED) {
          everBlockedRef.current = true;
          setIsBlocked(true);
          latest.current.onStatusChange('blocked');
        }
      },
      everBlockedRef.current ? START_WATCHDOG_AFTER_BLOCK_MS : START_WATCHDOG_MS
    );
  }, [clearWatchdog]);

  const applyVolume = React.useCallback((player: YTPlayerInstance) => {
    const { volume: vol, isMuted: muted } = latest.current;
    try {
      player.setVolume(Math.round(vol * 100));
      if (muted || vol === 0) player.mute();
      else player.unMute();
    } catch {
      // ignore transient player state
    }
  }, []);

  /**
   * Seeks the player. A cued / unstarted video is re-cued at the position instead: `seekTo` on a
   * cued video starts playing it, which would break a paused restore.
   */
  const applySeek = React.useCallback((player: YTPlayerInstance, request: { token: number; ms: number }) => {
    const seconds = Math.max(0, request.ms / 1000);
    try {
      const state = player.getPlayerState();
      const idle = state === YT_STATE.UNSTARTED || state === YT_STATE.CUED;
      if (idle && !latest.current.isPlaying) {
        player.cueVideoById(loadedVideoIdRef.current, seconds);
      } else {
        player.seekTo(seconds, true);
        if (latest.current.isPlaying) player.playVideo();
      }
    } catch {
      // ignore transient player state
    }
    latest.current.onSeekHandled(request.token);
  }, []);

  // Mount the YouTube IFrame player (again whenever `retryNonce` changes)
  React.useEffect(() => {
    let disposed = false;
    const host = hostRef.current;

    const initPlayer = () => {
      if (disposed || !host || playerRef.current) return;
      apiFailedRef.current = false;
      latest.current.onStatusChange('loading');

      loadYouTubeIframeApi({
        fail: () => {
          if (disposed) return;
          apiFailedRef.current = true;
          latest.current.onError(STREAM_ERROR_API_UNAVAILABLE);
        },
        ready: () => {
          if (disposed || !window.YT?.Player || playerRef.current) return;

          // The API replaces this node with its <iframe>; keep it outside React's control
          const mountNode = document.createElement('div');
          host.replaceChildren(mountNode);

          const autoplay = latest.current.isPlaying;
          const playerVars: Record<string, string | number> = {
            autoplay: autoplay ? 1 : 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
          };
          const startSeconds = Math.floor(Math.max(0, latest.current.initialPositionMs) / 1000);
          if (startSeconds > 0) playerVars.start = startSeconds;
          if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
            playerVars.origin = window.location.origin;
          }

          loadedVideoIdRef.current = latest.current.videoId;
          try {
            playerRef.current = new window.YT.Player(mountNode, {
              videoId: latest.current.videoId,
              width: '100%',
              height: '100%',
              playerVars,
              events: {
                onReady: (ev) => {
                  if (disposed) return;
                  isReadyRef.current = true;
                  applyVolume(ev.target);
                  // The track may have changed while the player was still loading
                  const wanted = latest.current.videoId;
                  if (wanted !== loadedVideoIdRef.current) {
                    loadedVideoIdRef.current = wanted;
                    if (latest.current.isPlaying) ev.target.loadVideoById(wanted, 0);
                    else ev.target.cueVideoById(wanted, 0);
                  } else if (latest.current.isPlaying) {
                    ev.target.playVideo();
                  } else if (autoplay) {
                    // Paused while the player was still getting ready: cueing cancels the autoplay it
                    // was created with (it would start the song anyway, and look like an external play)
                    ev.target.cueVideoById(wanted, startSeconds);
                  }
                  const pendingSeek = pendingSeekRef.current;
                  if (pendingSeek) {
                    pendingSeekRef.current = null;
                    applySeek(ev.target, pendingSeek);
                  }
                  if (latest.current.isPlaying) armStartWatchdog();
                  else latest.current.onStatusChange('paused');
                },
                onStateChange: (ev) => {
                  if (disposed) return;
                  const state = ev.data;
                  if (settleTimerRef.current !== null) {
                    window.clearTimeout(settleTimerRef.current);
                    settleTimerRef.current = null;
                  }

                  if (state === YT_STATE.PLAYING) {
                    clearWatchdog();
                    setIsBlocked(false);
                    latest.current.onStatusChange('playing');
                    if (!latest.current.isPlaying) {
                      settleTimerRef.current = window.setTimeout(() => {
                        settleTimerRef.current = null;
                        const player = playerRef.current;
                        if (disposed || !player || latest.current.isPlaying) return;
                        if (player.getPlayerState() === YT_STATE.PLAYING) {
                          latest.current.onExternalPlayPause?.(true);
                        }
                      }, EXTERNAL_STATE_SETTLE_MS);
                    }
                  } else if (state === YT_STATE.BUFFERING) {
                    clearWatchdog();
                    if (latest.current.isPlaying) latest.current.onStatusChange('buffering');
                  } else if (state === YT_STATE.PAUSED) {
                    latest.current.onStatusChange('paused');
                    if (latest.current.isPlaying) {
                      settleTimerRef.current = window.setTimeout(() => {
                        settleTimerRef.current = null;
                        const player = playerRef.current;
                        if (disposed || !player || !latest.current.isPlaying) return;
                        if (player.getPlayerState() === YT_STATE.PAUSED) {
                          latest.current.onExternalPlayPause?.(false);
                        }
                      }, EXTERNAL_STATE_SETTLE_MS);
                    }
                  } else if (state === YT_STATE.ENDED) {
                    clearWatchdog();
                    latest.current.onEnded();
                  }
                },
                onError: (ev) => {
                  if (disposed) return;
                  clearWatchdog();
                  latest.current.onError(typeof ev.data === 'number' ? ev.data : 5);
                },
              },
            });
          } catch {
            apiFailedRef.current = true;
            latest.current.onError(STREAM_ERROR_API_UNAVAILABLE);
          }
        },
      });
    };

    initPlayerRef.current = initPlayer;
    initPlayer();

    return () => {
      disposed = true;
      isReadyRef.current = false;
      clearWatchdog();
      if (settleTimerRef.current !== null) {
        window.clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore cleanup error
        }
        playerRef.current = null;
      }
      host?.replaceChildren();
    };
  }, [applySeek, applyVolume, armStartWatchdog, clearWatchdog, retryNonce]);

  // Switch video when a different track (or an alternate upload of the same track) is selected
  React.useEffect(() => {
    if (loadedVideoIdRef.current === videoId) return;
    const player = playerRef.current;
    if (!player || !isReadyRef.current) return; // onReady picks up the latest videoId
    loadedVideoIdRef.current = videoId;
    setIsBlocked(false);
    try {
      if (latest.current.isPlaying) {
        latest.current.onStatusChange('loading');
        player.loadVideoById(videoId, 0);
        armStartWatchdog();
      } else {
        player.cueVideoById(videoId, 0);
      }
    } catch {
      latest.current.onError(5);
    }
  }, [videoId, armStartWatchdog]);

  // Sync Play / Pause
  React.useEffect(() => {
    const player = playerRef.current;
    if (!player || !isReadyRef.current) {
      // The API script failed earlier (e.g. offline): pressing play retries the whole setup
      if (isPlaying && apiFailedRef.current) initPlayerRef.current();
      return;
    }
    try {
      if (isPlaying) {
        player.playVideo();
        armStartWatchdog();
      } else {
        clearWatchdog();
        setIsBlocked(false);
        player.pauseVideo();
      }
    } catch {
      // ignore transient state
    }
  }, [isPlaying, armStartWatchdog, clearWatchdog]);

  // Sync Volume & Mute
  React.useEffect(() => {
    if (!playerRef.current || !isReadyRef.current) return;
    applyVolume(playerRef.current);
  }, [volume, isMuted, applyVolume]);

  // Sync explicit seek requests (scrubbing, restart). Before the player is ready they are kept.
  const seekToken = seekRequest?.token;
  React.useEffect(() => {
    const request = latest.current.seekRequest;
    if (!request) return;
    const player = playerRef.current;
    if (player && isReadyRef.current) applySeek(player, request);
    else pendingSeekRef.current = request;
  }, [seekToken, applySeek]);

  // Poll current playback time & full song duration every 250ms while playing
  React.useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || !isReadyRef.current) return;
      try {
        if (player.getPlayerState() !== YT_STATE.PLAYING) return;
        const curSec = player.getCurrentTime();
        const durSec = player.getDuration();
        if (Number.isFinite(curSec) && curSec >= 0) {
          const durMs =
            Number.isFinite(durSec) && durSec > 35 ? Math.round(durSec * 1000) : undefined;
          latest.current.onTimeUpdateMs(Math.round(curSec * 1000), durMs);
        }
      } catch {
        // ignore
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [isPlaying]);

  return (
    <div
      aria-hidden={!isBlocked}
      className={
        isBlocked
          ? 'fixed right-3 z-[70] w-64 max-w-[calc(100vw-1.5rem)] rounded-xl overflow-hidden border border-emerald-500/50 bg-zinc-950 shadow-2xl bottom-[calc(var(--chrome-bottom)+0.75rem)]'
          : 'fixed bottom-0 right-0 w-px h-px opacity-0 pointer-events-none overflow-hidden'
      }
    >
      {isBlocked && (
        <p className="px-3 py-2 text-xs font-semibold text-emerald-300">
          Tap the player below to start playback
        </p>
      )}
      <div ref={hostRef} className={isBlocked ? 'w-full aspect-video' : 'w-px h-px'} />
    </div>
  );
};
