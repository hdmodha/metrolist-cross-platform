import React from 'react';

interface YouTubeStreamBridgeProps {
  videoId: string;
  isPlaying: boolean;
  volume: number; // 0..1
  isMuted: boolean;
  seekRequestMs: number | null;
  onSeekHandled?: () => void;
  onPlayingStateChange?: (activelyPlaying: boolean) => void;
  onTimeUpdateMs: (currentMs: number, durationMs?: number) => void;
  onEnded: () => void;
  onFallbackNeeded: () => void;
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
      PlayerState?: {
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface YTPlayerInstance {
  loadVideoById: (videoId: string, startSeconds?: number) => void;
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

let ytScriptLoading = false;
const readyCallbacks: Array<() => void> = [];

function loadYouTubeIframeApi(cb: () => void) {
  if (typeof window === 'undefined') return;
  if (window.YT && window.YT.Player) {
    cb();
    return;
  }
  readyCallbacks.push(cb);
  if (ytScriptLoading) return;
  ytScriptLoading = true;

  const prev = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => {
    if (prev) prev();
    while (readyCallbacks.length > 0) {
      const fn = readyCallbacks.shift();
      if (fn) fn();
    }
  };

  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  script.async = true;
  script.onerror = () => {
    ytScriptLoading = false;
  };
  document.head.appendChild(script);
}

export const YouTubeStreamBridge: React.FC<YouTubeStreamBridgeProps> = ({
  videoId,
  isPlaying,
  volume,
  isMuted,
  seekRequestMs,
  onSeekHandled,
  onPlayingStateChange,
  onTimeUpdateMs,
  onEnded,
  onFallbackNeeded,
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const playerRef = React.useRef<YTPlayerInstance | null>(null);
  const isReadyRef = React.useRef<boolean>(false);
  const currentVideoIdRef = React.useRef<string>(videoId);
  const isPlayingRef = React.useRef<boolean>(isPlaying);

  isPlayingRef.current = isPlaying;

  // Mount YouTube IFrame Player once
  React.useEffect(() => {
    let mounted = true;

    loadYouTubeIframeApi(() => {
      if (!mounted || !containerRef.current || !window.YT?.Player) return;

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId: currentVideoIdRef.current,
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: isPlayingRef.current ? 1 : 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (ev) => {
            if (!mounted) return;
            isReadyRef.current = true;
            ev.target.setVolume(Math.round(volume * 100));
            if (isMuted) ev.target.mute();
            if (isPlayingRef.current) {
              ev.target.playVideo();
            }
          },
          onStateChange: (ev) => {
            if (!mounted) return;
            onPlayingStateChange?.(ev.data === 1);
            // YT.PlayerState.ENDED === 0
            if (ev.data === 0) {
              onEnded();
            }
          },
          onError: () => {
            if (!mounted) return;
            onPlayingStateChange?.(false);
            onFallbackNeeded();
          },
        },
      });
    });

    return () => {
      mounted = false;
      isReadyRef.current = false;
      onPlayingStateChange?.(false);
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore cleanup error
        }
        playerRef.current = null;
      }
    };
  }, []);

  // Switch videoId when user selects a different YouTube Music track
  React.useEffect(() => {
    if (currentVideoIdRef.current === videoId) return;
    currentVideoIdRef.current = videoId;
    if (playerRef.current && isReadyRef.current) {
      try {
        playerRef.current.loadVideoById(videoId, 0);
        if (!isPlayingRef.current) {
          playerRef.current.pauseVideo();
        }
      } catch {
        onFallbackNeeded();
      }
    }
  }, [videoId, onFallbackNeeded]);

  // Sync Play / Pause
  React.useEffect(() => {
    if (!playerRef.current || !isReadyRef.current) return;
    try {
      if (isPlaying) {
        playerRef.current.playVideo();
      } else {
        playerRef.current.pauseVideo();
        onPlayingStateChange?.(false);
      }
    } catch {
      // ignore transient state
    }
  }, [isPlaying, onPlayingStateChange]);

  // Sync Volume & Mute
  React.useEffect(() => {
    if (!playerRef.current || !isReadyRef.current) return;
    try {
      playerRef.current.setVolume(Math.round(volume * 100));
      if (isMuted || volume === 0) {
        playerRef.current.mute();
      } else {
        playerRef.current.unMute();
      }
    } catch {
      // ignore
    }
  }, [volume, isMuted]);

  // Sync explicit user seek requests (scrubbing or clicking synced lyrics)
  React.useEffect(() => {
    if (seekRequestMs === null) return;
    if (playerRef.current && isReadyRef.current) {
      try {
        playerRef.current.seekTo(seekRequestMs / 1000, true);
      } catch {
        // ignore
      }
    }
    onSeekHandled?.();
  }, [seekRequestMs, onSeekHandled]);

  // Poll current playback time & full song duration every 250ms while playing
  React.useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      if (!playerRef.current || !isReadyRef.current) return;
      try {
        const state = playerRef.current.getPlayerState();
        // 1 === PLAYING
        if (state === 1) {
          const curSec = playerRef.current.getCurrentTime();
          const durSec = playerRef.current.getDuration();
          if (Number.isFinite(curSec) && curSec >= 0) {
            const durMs =
              Number.isFinite(durSec) && durSec > 35 ? Math.round(durSec * 1000) : undefined;
            onTimeUpdateMs(Math.round(curSec * 1000), durMs);
          }
        }
      } catch {
        // ignore
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [isPlaying, onTimeUpdateMs]);

  return (
    <div
      aria-hidden="true"
      className="fixed bottom-0 right-0 w-px h-px opacity-0 pointer-events-none overflow-hidden"
    >
      <div ref={containerRef} />
    </div>
  );
};
