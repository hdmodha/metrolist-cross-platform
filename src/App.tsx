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
  Radio,
  Loader2,
} from 'lucide-react';
import {
  INITIAL_TRACKS,
  type MetrolistTrack,
} from './data/metrolistData';
import {
  deriveSongSearchTerms,
  formatDurationMs,
  type InnerTubeParsedTrack,
} from './utils/metrolistCore';
import {
  buildPlayNowQueue,
  insertIntoQueueAfterCurrent,
  mergeRadioIntoQueue,
  pickNextQueueIndex,
  type RepeatMode,
} from './player/queueRules';
import { fetchRecommendations, searchTracks } from './utils/apiClient';
import { loadPlayerState, savePlayerState } from './utils/persistence';
import { sharedAudioEngine } from './utils/webAudioSynth';
import { PlayerLibraryView, STATIC_YTM_FALLBACK } from './components/PlayerLibraryView';
import { QueueDrawer } from './components/QueueDrawer';
import {
  STREAM_ERROR_API_UNAVAILABLE,
  YouTubeStreamBridge,
  type StreamStatus,
} from './components/YouTubeStreamBridge';

const IDLE_SPECTRUM = Array.from({ length: 16 }, () => 10);
const MAX_PLAY_HISTORY = 50;
/** Alternate uploads tried for one song before giving up on it. */
const MAX_VIDEO_CANDIDATES_PER_TRACK = 3;
const MAX_CONSECUTIVE_STREAM_FAILURES = 3;

function convertRecommendationToTrack(ytTrack: InnerTubeParsedTrack): MetrolistTrack {
  const fullSongDurationMs = ytTrack.durationMs > 30000 ? ytTrack.durationMs : 218000;
  return {
    id: `ytm-${ytTrack.videoId}`,
    videoId: ytTrack.videoId,
    title: ytTrack.title,
    artist: ytTrack.artist,
    album: ytTrack.album || 'YouTube Music',
    durationMs: fullSongDurationMs,
    bpm: 116,
    rootFreqHz: 220,
    chordIntervals: [0, 3, 7, 10],
    coverUrl:
      ytTrack.thumbnailUrl || `https://i.ytimg.com/vi/${ytTrack.videoId}/hqdefault.jpg`,
    genre: 'YouTube Music',
    liked: false,
    cachedOffline: false,
    isLiveInnerTube: true,
  };
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    tag === 'A' ||
    target.isContentEditable ||
    target.getAttribute('role') === 'button' ||
    target.getAttribute('role') === 'tab'
  );
}

export default function App() {
  // Restored once from localStorage (liked songs, saved library, player preferences)
  const [persisted] = React.useState(loadPlayerState);

  // Catalog & Queue State
  const [tracks, setTracks] = React.useState<MetrolistTrack[]>(() => {
    const restored = persisted.library.map((saved) => ({
      ...convertRecommendationToTrack({
        videoId: saved.videoId,
        title: saved.title,
        artist: saved.artist,
        album: saved.album,
        durationMs: saved.durationMs,
        thumbnailUrl: saved.coverUrl,
      }),
      liked: saved.liked,
      cachedOffline: saved.cachedOffline,
    }));
    const seeds = INITIAL_TRACKS.map((seed) => {
      const flags = persisted.seedFlags[seed.id];
      return flags ? { ...seed, liked: flags.liked, cachedOffline: flags.cachedOffline } : seed;
    });
    return [...restored, ...seeds];
  });
  const [queue, setQueue] = React.useState<MetrolistTrack[]>(INITIAL_TRACKS);
  const [userQueuedIds, setUserQueuedIds] = React.useState<ReadonlySet<string>>(() => new Set());
  const [activeTrackId, setActiveTrackId] = React.useState<string>(INITIAL_TRACKS[0].id);
  const [isPlaying, setIsPlaying] = React.useState<boolean>(false);
  const [currentTimeMs, setCurrentTimeMs] = React.useState<number>(0);
  const [seekRequestMs, setSeekRequestMs] = React.useState<number | null>(null);
  const [volume, setVolume] = React.useState<number>(persisted.volume);
  const [isMuted, setIsMuted] = React.useState<boolean>(persisted.isMuted);
  const [shuffleEnabled, setShuffleEnabled] = React.useState<boolean>(persisted.shuffleEnabled);
  const [repeatMode, setRepeatMode] = React.useState<RepeatMode>(persisted.repeatMode);
  const [autoplayRadio, setAutoplayRadio] = React.useState<boolean>(persisted.autoplayRadio);

  // Live YouTube stream & radio recommendations state
  const [streamStatus, setStreamStatus] = React.useState<StreamStatus>('paused');
  const [ytRecommendations, setYtRecommendations] =
    React.useState<InnerTubeParsedTrack[]>(STATIC_YTM_FALLBACK);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = React.useState<boolean>(false);
  const [notice, setNotice] = React.useState<{ id: number; message: string } | null>(null);

  // Filters & Drawer State
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [selectedGenre, setSelectedGenre] = React.useState<string>('All');
  const [libraryFilter, setLibraryFilter] = React.useState<'ALL' | 'LIKED' | 'CACHED'>('ALL');
  const [drawerTab, setDrawerTab] = React.useState<'QUEUE' | 'EQ'>('QUEUE');
  const [eqGains, setEqGains] = React.useState<number[]>(persisted.eqGains);
  const [frequencyLevels, setFrequencyLevels] = React.useState<number[]>(IDLE_SPECTRUM);

  const activeTrack = React.useMemo(
    () =>
      tracks.find((t) => t.id === activeTrackId) ||
      queue.find((t) => t.id === activeTrackId) ||
      tracks[0],
    [tracks, queue, activeTrackId]
  );
  const isLiveTrack = !!activeTrack.isLiveInnerTube;

  // Long-lived handlers (timers, MediaSession, YouTube player events, keyboard shortcuts) read the
  // current state through this ref instead of capturing a stale render.
  const latest = React.useRef({
    queue,
    tracks,
    activeTrack,
    userQueuedIds,
    isPlaying,
    currentTimeMs,
    volume,
    isMuted,
    shuffleEnabled,
    repeatMode,
  });
  latest.current = {
    queue,
    tracks,
    activeTrack,
    userQueuedIds,
    isPlaying,
    currentTimeMs,
    volume,
    isMuted,
    shuffleEnabled,
    repeatMode,
  };

  const playHistoryRef = React.useRef<string[]>([]);
  const hasStartedPlaybackRef = React.useRef(false);
  const triedVideoIdsRef = React.useRef<Map<string, Set<string>>>(new Map());
  const consecutiveStreamFailuresRef = React.useRef(0);
  const noticeCounterRef = React.useRef(0);

  const showNotice = React.useCallback((message: string) => {
    noticeCounterRef.current += 1;
    setNotice({ id: noticeCounterRef.current, message });
  }, []);

  React.useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const patchTrack = React.useCallback((trackId: string, patch: Partial<MetrolistTrack>) => {
    const apply = (list: MetrolistTrack[]) =>
      list.some((t) => t.id === trackId)
        ? list.map((t) => (t.id === trackId ? { ...t, ...patch } : t))
        : list;
    setTracks(apply);
    setQueue(apply);
  }, []);

  /** Starts `track` from the beginning. Callers are responsible for shaping the queue first. */
  const startTrack = React.useCallback(
    (track: MetrolistTrack, options: { recordHistory?: boolean } = {}) => {
      const previousId = latest.current.activeTrack.id;
      if (
        options.recordHistory !== false &&
        hasStartedPlaybackRef.current &&
        previousId !== track.id
      ) {
        playHistoryRef.current.push(previousId);
        if (playHistoryRef.current.length > MAX_PLAY_HISTORY) playHistoryRef.current.shift();
      }
      hasStartedPlaybackRef.current = true;

      setTracks((prev) => (prev.some((t) => t.id === track.id) ? prev : [track, ...prev]));
      // Invariant: the playing track is always part of the queue
      setQueue((prev) => (prev.some((t) => t.id === track.id) ? prev : [track, ...prev]));
      setUserQueuedIds((prev) => {
        if (!prev.has(track.id)) return prev;
        const next = new Set(prev);
        next.delete(track.id);
        return next;
      });
      setActiveTrackId(track.id);
      setCurrentTimeMs(0);
      // A different video always loads from 0 by itself; only a replay needs an explicit seek
      setSeekRequestMs(previousId === track.id ? 0 : null);
      setStreamStatus(track.isLiveInnerTube ? 'loading' : 'paused');
      setIsPlaying(true);
    },
    []
  );

  const restartCurrentTrack = React.useCallback(() => {
    setCurrentTimeMs(0);
    setSeekRequestMs(0);
    setIsPlaying(true);
  }, []);

  const stopAtEndOfQueue = React.useCallback(() => {
    setIsPlaying(false);
    setCurrentTimeMs(0);
    setStreamStatus('paused');
  }, []);

  /**
   * Moves through the queue.
   * - `user`:  Next / Previous pressed
   * - `ended`: the current track finished on its own (honours repeat-one / end of queue)
   * - `error`: the current track cannot be played, never land on it again
   */
  const skipTrack = React.useCallback(
    (direction: -1 | 1, reason: 'user' | 'ended' | 'error') => {
      const state = latest.current;
      const currentId = state.activeTrack.id;

      if (direction === -1) {
        // Like every music player: Previous restarts the song unless it has only just begun
        if (state.currentTimeMs > 3000) {
          restartCurrentTrack();
          return;
        }
        if (state.shuffleEnabled) {
          while (playHistoryRef.current.length > 0) {
            const previousId = playHistoryRef.current.pop();
            const previous =
              state.queue.find((t) => t.id === previousId) ||
              state.tracks.find((t) => t.id === previousId);
            if (previous && previous.id !== currentId) {
              startTrack(previous, { recordHistory: false });
              return;
            }
          }
        }
      }

      const currentIndex = state.queue.findIndex((t) => t.id === currentId);
      const nextIndex = pickNextQueueIndex({
        queueLength: state.queue.length,
        currentIndex,
        direction,
        shuffle: state.shuffleEnabled,
        repeatMode: reason === 'error' && state.repeatMode === 'ONE' ? 'ALL' : state.repeatMode,
        userInitiated: reason !== 'ended',
      });
      const nextTrack = nextIndex >= 0 ? state.queue[nextIndex] : undefined;

      if (!nextTrack || (reason === 'error' && nextTrack.id === currentId)) {
        stopAtEndOfQueue();
        return;
      }
      if (nextTrack.id === currentId) {
        restartCurrentTrack();
        return;
      }
      startTrack(nextTrack);
    },
    [restartCurrentTrack, startTrack, stopAtEndOfQueue]
  );

  /**
   * YouTube Music radio (`RDAMVM` WatchNext): refreshes the "Recommended for You" shelf for the
   * playing song and, with Autoplay Radio on, tops up the queue when it is about to run out.
   */
  React.useEffect(() => {
    const controller = new AbortController();
    const seed = latest.current.activeTrack;
    setIsLoadingRecommendations(true);

    fetchRecommendations(
      { videoId: seed.videoId, title: seed.title, artist: seed.artist },
      controller.signal
    )
      .then(({ tracks: recs }) => {
        if (controller.signal.aborted) return;
        const usable = recs.filter((r) => r.videoId !== seed.videoId);
        if (usable.length === 0) {
          setYtRecommendations(STATIC_YTM_FALLBACK.filter((t) => t.videoId !== seed.videoId));
          return;
        }
        setYtRecommendations(usable);
        if (autoplayRadio) {
          const radioTracks = usable.map(convertRecommendationToTrack);
          setQueue((prevQueue) => mergeRadioIntoQueue(prevQueue, seed.id, radioTracks));
        }
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setYtRecommendations(STATIC_YTM_FALLBACK.filter((t) => t.videoId !== seed.videoId));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingRecommendations(false);
      });

    return () => controller.abort();
  }, [activeTrack.id, autoplayRadio]);

  // Local Studio Synth engine + playback clock (live YouTube tracks are clocked by the stream itself,
  // so the progress bar never advances while nothing is audible)
  const synthRootFreqHz = activeTrack.rootFreqHz;
  const synthBpm = activeTrack.bpm;
  const synthIntervalsKey = activeTrack.chordIntervals.join(',');
  React.useEffect(() => {
    if (!isPlaying || isLiveTrack) {
      sharedAudioEngine.stop();
      setFrequencyLevels(IDLE_SPECTRUM);
      return;
    }

    const synthTrack = latest.current.activeTrack;
    sharedAudioEngine.startTrack(synthRootFreqHz, synthTrack.chordIntervals, synthBpm, 1.0);

    const timer = window.setInterval(() => {
      setFrequencyLevels(sharedAudioEngine.getFrequencyLevels(16));
      const state = latest.current;
      const next = state.currentTimeMs + 250;
      if (next >= state.activeTrack.durationMs) {
        skipTrack(1, 'ended');
      } else {
        setCurrentTimeMs(next);
      }
    }, 250);

    return () => {
      window.clearInterval(timer);
      sharedAudioEngine.stop();
    };
  }, [isPlaying, isLiveTrack, activeTrack.id, synthRootFreqHz, synthBpm, synthIntervalsKey, skipTrack]);

  // Browsers only allow audio after a user gesture: unlock the Web Audio context on the first one
  React.useEffect(() => {
    const unlock = () => sharedAudioEngine.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // Apply restored volume & EQ to the synth engine once
  React.useEffect(() => {
    sharedAudioEngine.setVolume(persisted.isMuted ? 0 : persisted.volume);
    persisted.eqGains.forEach((gain, idx) => sharedAudioEngine.setEqBandGain(idx, gain));
  }, [persisted]);

  // Persist library & preferences
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const seedFlags: Record<string, { liked: boolean; cachedOffline: boolean }> = {};
      for (const t of tracks) {
        if (!t.isLiveInnerTube) {
          seedFlags[t.id] = { liked: t.liked, cachedOffline: t.cachedOffline };
        }
      }
      savePlayerState({
        library: tracks
          .filter((t) => t.isLiveInnerTube)
          .map((t) => ({
            videoId: t.id.startsWith('ytm-') ? t.id.slice(4) : t.videoId,
            title: t.title,
            artist: t.artist,
            album: t.album,
            durationMs: t.durationMs,
            coverUrl: t.coverUrl,
            liked: t.liked,
            cachedOffline: t.cachedOffline,
          })),
        seedFlags,
        volume,
        isMuted,
        shuffleEnabled,
        repeatMode,
        autoplayRadio,
        eqGains,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [tracks, volume, isMuted, shuffleEnabled, repeatMode, autoplayRadio, eqGains]);

  const handleTogglePlayPause = React.useCallback(() => {
    const state = latest.current;
    if (!state.isPlaying) {
      hasStartedPlaybackRef.current = true;
    }
    setIsPlaying(!state.isPlaying);
  }, []);

  const handleSeekToMs = React.useCallback((ms: number) => {
    const duration = latest.current.activeTrack.durationMs;
    const clamped = Math.max(0, Math.min(ms, Math.max(0, duration - 500)));
    setCurrentTimeMs(clamped);
    setSeekRequestMs(clamped);
  }, []);

  // Cross-platform OS media controls (macOS Control Center, Windows SMTC, iOS Lock Screen, Android notification)
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => setIsPlaying(true)],
      ['pause', () => setIsPlaying(false)],
      ['previoustrack', () => skipTrack(-1, 'user')],
      ['nexttrack', () => skipTrack(1, 'user')],
      ['seekbackward', () => handleSeekToMs(latest.current.currentTimeMs - 10000)],
      ['seekforward', () => handleSeekToMs(latest.current.currentTimeMs + 10000)],
      [
        'seekto',
        (details) => {
          if (typeof details.seekTime === 'number') {
            handleSeekToMs(Math.round(details.seekTime * 1000));
          }
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Action not supported by this browser
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // ignore
        }
      }
    };
  }, [skipTrack, handleSeekToMs]);

  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof MediaMetadata === 'undefined') return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: activeTrack.title,
        artist: activeTrack.artist,
        album: activeTrack.album,
        artwork: [{ src: activeTrack.coverUrl }],
      });
    } catch {
      // Ignore artwork / metadata errors on older browsers
    }
  }, [activeTrack.title, activeTrack.artist, activeTrack.album, activeTrack.coverUrl]);

  const positionBucket = Math.floor(currentTimeMs / 5000);
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      const durationSec = activeTrack.durationMs / 1000;
      if (durationSec > 0 && typeof navigator.mediaSession.setPositionState === 'function') {
        navigator.mediaSession.setPositionState({
          duration: durationSec,
          playbackRate: 1,
          position: Math.min(durationSec, latest.current.currentTimeMs / 1000),
        });
      }
    } catch {
      // ignore
    }
  }, [isPlaying, activeTrack.durationMs, positionBucket]);

  // Desktop keyboard shortcuts: Space = play / pause, ← / → = seek 5s
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInteractiveTarget(e.target)) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        handleTogglePlayPause();
      } else if (e.key === 'ArrowRight') {
        handleSeekToMs(latest.current.currentTimeMs + 5000);
      } else if (e.key === 'ArrowLeft') {
        handleSeekToMs(latest.current.currentTimeMs - 5000);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleTogglePlayPause, handleSeekToMs]);

  /** Library / queue rows: play the track, continuing with the rest of the list it was picked from. */
  const handleSelectAndPlay = (track: MetrolistTrack, contextTracks?: MetrolistTrack[]) => {
    if (track.id === activeTrack.id) {
      handleTogglePlayPause();
      return;
    }
    if (contextTracks) {
      const contextIdx = contextTracks.findIndex((t) => t.id === track.id);
      const followUps = contextIdx >= 0 ? contextTracks.slice(contextIdx + 1) : [];
      const currentId = hasStartedPlaybackRef.current ? activeTrack.id : null;
      setQueue((prev) => buildPlayNowQueue(prev, currentId, track, userQueuedIds, followUps));
    }
    startTrack(track);
  };

  /** Search results & recommendation cards: play now, then continue with radio picks. */
  const handlePlayLiveInnerTubeTrack = (ytTrack: InnerTubeParsedTrack) => {
    const trackId = `ytm-${ytTrack.videoId}`;
    const track =
      tracks.find((t) => t.id === trackId) ||
      queue.find((t) => t.id === trackId) ||
      convertRecommendationToTrack(ytTrack);
    if (track.id === activeTrack.id) {
      handleTogglePlayPause();
      return;
    }
    const currentId = hasStartedPlaybackRef.current ? activeTrack.id : null;
    setQueue((prev) => buildPlayNowQueue(prev, currentId, track, userQueuedIds));
    startTrack(track);
  };

  const handleAddToQueue = (track: MetrolistTrack) => {
    if (track.id === activeTrack.id) {
      showNotice('This song is already playing');
      return;
    }
    setTracks((prev) => (prev.some((t) => t.id === track.id) ? prev : [...prev, track]));
    setQueue((prev) => insertIntoQueueAfterCurrent(prev, activeTrack.id, track, userQueuedIds));
    setUserQueuedIds((prev) => new Set(prev).add(track.id));
    showNotice(`Added “${track.title}” to your queue`);
  };

  const handleQueueRecommendation = (ytTrack: InnerTubeParsedTrack) => {
    const trackId = `ytm-${ytTrack.videoId}`;
    handleAddToQueue(
      tracks.find((t) => t.id === trackId) ||
        queue.find((t) => t.id === trackId) ||
        convertRecommendationToTrack(ytTrack)
    );
  };

  const handleToggleLike = (trackId: string) => {
    const target = tracks.find((t) => t.id === trackId) || queue.find((t) => t.id === trackId);
    if (!target) return;
    const liked = !target.liked;
    // A liked song must live in the library even if it was only ever in the queue
    setTracks((prev) => (prev.some((t) => t.id === trackId) ? prev : [target, ...prev]));
    patchTrack(trackId, { liked });
  };

  const handleToggleCache = (trackId: string) => {
    const target = tracks.find((t) => t.id === trackId) || queue.find((t) => t.id === trackId);
    if (!target) return;
    setTracks((prev) => (prev.some((t) => t.id === trackId) ? prev : [target, ...prev]));
    patchTrack(trackId, { cachedOffline: !target.cachedOffline });
  };

  const handleMoveQueueItem = (index: number, direction: -1 | 1) => {
    setQueue((prev) => {
      const targetIdx = index + direction;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIdx];
      copy[targetIdx] = temp;
      return copy;
    });
  };

  const handleRemoveQueueItem = (trackId: string) => {
    if (trackId === activeTrack.id) return;
    setQueue((prev) => prev.filter((item) => item.id !== trackId));
    setUserQueuedIds((prev) => {
      if (!prev.has(trackId)) return prev;
      const next = new Set(prev);
      next.delete(trackId);
      return next;
    });
  };

  const handleUpdateEqGain = (bandIndex: number, gainDb: number) => {
    setEqGains((prev) => {
      const next = [...prev];
      next[bandIndex] = gainDb;
      return next;
    });
    sharedAudioEngine.setEqBandGain(bandIndex, gainDb);
  };

  const handleVolumeChange = (nextVol: number) => {
    setVolume(nextVol);
    setIsMuted(nextVol === 0);
    sharedAudioEngine.setVolume(nextVol);
  };

  const handleToggleMute = () => {
    const nextMuted = !(isMuted || volume === 0);
    if (!nextMuted && volume === 0) {
      setVolume(0.5);
      sharedAudioEngine.setVolume(0.5);
    } else {
      sharedAudioEngine.setVolume(nextMuted ? 0 : volume);
    }
    setIsMuted(nextMuted);
  };

  const handleCycleRepeatMode = () => {
    setRepeatMode((prev) => (prev === 'OFF' ? 'ALL' : prev === 'ALL' ? 'ONE' : 'OFF'));
  };

  const handleOpenDrawerTab = (tab: 'QUEUE' | 'EQ') => {
    setDrawerTab(tab);
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      document.getElementById('inspector-drawer')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // ---- YouTube stream bridge callbacks (stable identities; state is read through `latest`) ----

  const handleStreamStatusChange = React.useCallback((status: StreamStatus) => {
    setStreamStatus(status);
    if (status === 'playing') {
      consecutiveStreamFailuresRef.current = 0;
    }
  }, []);

  const handleStreamTimeUpdate = React.useCallback(
    (currentMs: number, durMs?: number) => {
      setCurrentTimeMs(currentMs);
      // Keep the full stream duration, but do not rewrite the library four times a second
      const track = latest.current.activeTrack;
      if (durMs && durMs > 30000 && Math.abs(durMs - track.durationMs) > 1500) {
        patchTrack(track.id, { durationMs: durMs });
      }
    },
    [patchTrack]
  );

  const handleStreamEnded = React.useCallback(() => skipTrack(1, 'ended'), [skipTrack]);
  const handleSeekHandled = React.useCallback(() => setSeekRequestMs(null), []);
  const handleExternalPlayPause = React.useCallback((playing: boolean) => setIsPlaying(playing), []);

  const handleStreamError = React.useCallback(
    async (code: number) => {
      const failed = latest.current.activeTrack;

      if (code === STREAM_ERROR_API_UNAVAILABLE) {
        setIsPlaying(false);
        setStreamStatus('paused');
        showNotice('Can’t reach YouTube right now. Check your connection, then press play.');
        return;
      }

      // Some uploads cannot be played outside youtube.com: look for another upload of the same song
      const tried = triedVideoIdsRef.current.get(failed.id) || new Set<string>([failed.videoId]);
      triedVideoIdsRef.current.set(failed.id, tried);
      if (tried.size < MAX_VIDEO_CANDIDATES_PER_TRACK) {
        try {
          const terms = deriveSongSearchTerms(failed.title, failed.artist);
          const candidates = await searchTracks(`${terms.artistName} ${terms.trackName}`.trim());
          const alternate = candidates.find((c) => !tried.has(c.videoId));
          if (latest.current.activeTrack.id !== failed.id) return;
          if (alternate) {
            tried.add(alternate.videoId);
            setStreamStatus('loading');
            patchTrack(failed.id, {
              videoId: alternate.videoId,
              durationMs: alternate.durationMs > 30000 ? alternate.durationMs : failed.durationMs,
            });
            return;
          }
        } catch {
          // Search unavailable: fall through to skipping the track
        }
      }
      if (latest.current.activeTrack.id !== failed.id) return;

      consecutiveStreamFailuresRef.current += 1;
      if (consecutiveStreamFailuresRef.current >= MAX_CONSECUTIVE_STREAM_FAILURES) {
        consecutiveStreamFailuresRef.current = 0;
        setIsPlaying(false);
        setStreamStatus('paused');
        showNotice('Several songs in a row could not be played. Playback paused.');
        return;
      }
      showNotice(`“${failed.title}” can’t be played here. Skipping…`);
      skipTrack(1, 'error');
    },
    [patchTrack, showNotice, skipTrack]
  );

  const isStreamLoading =
    isPlaying && isLiveTrack && (streamStatus === 'loading' || streamStatus === 'buffering');
  const effectivelyMuted = isMuted || volume === 0;

  // Rendered once per layout: above the controls on phones, under them from tablet width up
  const seekBar = (
    <div className="w-full flex items-center gap-2">
      <span className="text-[10px] sm:text-[11px] font-mono text-zinc-400 tabular-nums w-8 sm:w-9 text-right">
        {formatDurationMs(currentTimeMs)}
      </span>
      <input
        type="range"
        aria-label="Seek playback position"
        aria-valuetext={`${formatDurationMs(currentTimeMs)} of ${formatDurationMs(
          activeTrack.durationMs
        )}`}
        min={0}
        max={activeTrack.durationMs}
        step={1000}
        value={Math.min(currentTimeMs, activeTrack.durationMs)}
        onChange={(e) => handleSeekToMs(Number(e.target.value))}
        className="flex-1 min-w-0 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
      />
      <span className="text-[10px] sm:text-[11px] font-mono text-zinc-400 tabular-nums w-8 sm:w-9">
        {formatDurationMs(activeTrack.durationMs)}
      </span>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col selection:bg-emerald-500/30">
      {/* Top Bar Contract: Single-Page Spotify-Style Header (Brand Left · Filter Links Center · Autoplay Radio CTA Right) */}
      <header className="sticky top-0 z-30 bg-[#09090B]/95 backdrop-blur-md border-b border-white/5 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <div className="h-16 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setLibraryFilter('ALL');
              setSearchQuery('');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="flex items-center gap-2 text-white font-display font-extrabold text-base sm:text-lg tracking-tight shrink-0 whitespace-nowrap"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
            <span>Metrolist</span>
          </a>

          <nav
            aria-label="Primary Library Filter Navigation"
            className="flex items-center gap-0.5 sm:gap-2 overflow-x-auto no-scrollbar"
          >
            {(
              [
                { id: 'ALL', label: 'Home & Music', mobileLabel: 'Home' },
                { id: 'LIKED', label: 'Liked Songs', mobileLabel: 'Liked' },
                { id: 'CACHED', label: 'Downloaded', mobileLabel: 'Saved' },
              ] as const
            ).map((item) => {
              const active = libraryFilter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setLibraryFilter(item.id)}
                  className={`px-2 sm:px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 border-b-2 ${
                    active
                      ? 'border-emerald-400 text-white'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <span className="sm:hidden">{item.mobileLabel}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-pressed={autoplayRadio}
              aria-label={`Autoplay Radio ${autoplayRadio ? 'on' : 'off'}`}
              onClick={() => setAutoplayRadio((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                autoplayRadio
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              }`}
              title="Keep the music going with similar songs when your queue runs out"
            >
              <Radio className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Autoplay Radio:</span>
              <span>{autoplayRadio ? 'ON' : 'OFF'}</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area: Single-Page Home & Music + Up Next Queue / EQ Drawer */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-8 min-w-0">
            <PlayerLibraryView
              tracks={tracks}
              activeTrack={activeTrack}
              isPlaying={isPlaying}
              isStreamLoading={isStreamLoading}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedGenre={selectedGenre}
              onGenreChange={setSelectedGenre}
              libraryFilter={libraryFilter}
              onSelectAndPlay={handleSelectAndPlay}
              onPlayLiveInnerTubeTrack={handlePlayLiveInnerTubeTrack}
              ytRecommendations={ytRecommendations}
              isLoadingRecommendations={isLoadingRecommendations}
              onQueueRecommendation={handleQueueRecommendation}
              onToggleLike={handleToggleLike}
              onToggleCache={handleToggleCache}
              onAddToQueue={handleAddToQueue}
            />
          </div>

          <aside
            id="inspector-drawer"
            aria-label="Queue and Equalizer Inspector"
            className="xl:col-span-4 xl:sticky xl:top-20 scroll-mt-20"
          >
            <QueueDrawer
              activeTab={drawerTab}
              onTabChange={setDrawerTab}
              activeTrack={activeTrack}
              queue={queue}
              userQueuedIds={userQueuedIds}
              onSelectTrack={(track) => handleSelectAndPlay(track)}
              onMoveQueueItem={handleMoveQueueItem}
              onRemoveQueueItem={handleRemoveQueueItem}
              shuffleEnabled={shuffleEnabled}
              onToggleShuffle={() => setShuffleEnabled((prev) => !prev)}
              repeatMode={repeatMode}
              onCycleRepeatMode={handleCycleRepeatMode}
              eqGains={eqGains}
              onChangeEqGain={handleUpdateEqGain}
              frequencyLevels={frequencyLevels}
            />
          </aside>
        </div>
      </main>

      {/* Full-Duration YouTube Music Stream Bridge (hidden unless the browser demands a tap to start) */}
      {isLiveTrack && (
        <YouTubeStreamBridge
          videoId={activeTrack.videoId}
          isPlaying={isPlaying}
          volume={volume}
          isMuted={isMuted}
          seekRequestMs={seekRequestMs}
          onSeekHandled={handleSeekHandled}
          onStatusChange={handleStreamStatusChange}
          onTimeUpdateMs={handleStreamTimeUpdate}
          onEnded={handleStreamEnded}
          onError={handleStreamError}
          onExternalPlayPause={handleExternalPlayPause}
        />
      )}

      {/* Transient status messages (queue changes, playback problems) */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 z-50 flex justify-center px-4 pointer-events-none bottom-[calc(5.75rem+env(safe-area-inset-bottom))]"
        >
          <div className="max-w-md px-4 py-2.5 rounded-xl bg-zinc-100 text-zinc-950 text-xs sm:text-sm font-semibold shadow-2xl text-center">
            {notice.message}
          </div>
        </div>
      )}

      {/* Persistent Spotify-Style Now Playing Bottom Bar (Responsive Across Mobile, Tablet, and Desktop) */}
      <footer
        aria-label="Now Playing Audio Transport Bar"
        className="fixed bottom-0 inset-x-0 z-40 bg-[#09090B]/95 backdrop-blur-xl border-t border-white/10 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      >
        <div className="h-20 px-3 sm:px-6 flex flex-col justify-center gap-1.5 sm:gap-0">
          <div className="sm:hidden">{seekBar}</div>
          <div className="max-w-[1600px] w-full mx-auto flex sm:grid sm:grid-cols-12 items-center gap-2 sm:gap-4">
            {/* Left: Track Artwork & Title */}
            <div className="flex-1 sm:col-span-3 flex items-center gap-2.5 sm:gap-3 min-w-0">
              <img
                src={activeTrack.coverUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="w-9 h-9 sm:w-12 sm:h-12 rounded-lg object-cover shrink-0 border border-white/10 bg-zinc-900"
              />
              <div className="min-w-0">
                <div className="text-xs sm:text-sm font-semibold text-white truncate">
                  {activeTrack.title}
                </div>
                <div className="text-[11px] sm:text-xs text-zinc-400 truncate">
                  {activeTrack.artist}
                </div>
              </div>
            </div>

            {/* Center: Transport Controls & Full-Duration Seek Bar */}
            <div className="shrink-0 sm:col-span-6 flex flex-col items-center gap-1 min-w-0">
              <div className="flex items-center gap-1 sm:gap-4">
                <button
                  type="button"
                  aria-label={`Shuffle ${shuffleEnabled ? 'on' : 'off'}`}
                  aria-pressed={shuffleEnabled}
                  onClick={() => setShuffleEnabled((prev) => !prev)}
                  className={`hidden sm:inline-flex p-1.5 rounded-full transition-colors cursor-pointer ${
                    shuffleEnabled ? 'text-emerald-400' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  <Shuffle className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  aria-label="Previous Track"
                  onClick={() => skipTrack(-1, 'user')}
                  className="p-2 sm:p-1.5 rounded-full text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  <SkipBack className="w-4 h-4 fill-current" />
                </button>

                <button
                  type="button"
                  aria-label={isPlaying ? 'Pause Playback' : 'Start Playback'}
                  aria-busy={isStreamLoading}
                  onClick={handleTogglePlayPause}
                  className="w-9 h-9 rounded-full bg-white hover:scale-105 active:scale-95 text-zinc-950 flex items-center justify-center transition-transform cursor-pointer shadow"
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
                  onClick={() => skipTrack(1, 'user')}
                  className="p-2 sm:p-1.5 rounded-full text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  <SkipForward className="w-4 h-4 fill-current" />
                </button>

                <button
                  type="button"
                  aria-label={`Repeat: ${
                    repeatMode === 'OFF' ? 'off' : repeatMode === 'ALL' ? 'all' : 'one song'
                  }`}
                  onClick={handleCycleRepeatMode}
                  className={`hidden sm:inline-flex p-1.5 rounded-full transition-colors cursor-pointer ${
                    repeatMode !== 'OFF' ? 'text-emerald-400' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {repeatMode === 'ONE' ? (
                    <Repeat1 className="w-4 h-4" />
                  ) : (
                    <Repeat className="w-4 h-4" />
                  )}
                </button>
              </div>

              <div className="hidden sm:flex w-full max-w-lg">{seekBar}</div>
            </div>

            {/* Right: Drawer Quick Switchers (Visible on Mobile & Desktop) & Master Volume */}
            <div className="shrink-0 sm:col-span-3 flex items-center justify-end gap-0.5 sm:gap-2">
              <button
                type="button"
                aria-label="Show Dynamic Queue Panel"
                onClick={() => handleOpenDrawerTab('QUEUE')}
                className={`p-1.5 sm:p-2 rounded-lg transition-colors cursor-pointer ${
                  drawerTab === 'QUEUE'
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title="Up Next Queue"
              >
                <ListMusic className="w-4 h-4" />
              </button>

              <button
                type="button"
                aria-label="Show Equalizer Panel"
                onClick={() => handleOpenDrawerTab('EQ')}
                className={`hidden md:inline-flex p-2 rounded-lg transition-colors cursor-pointer ${
                  drawerTab === 'EQ'
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : 'text-zinc-400 hover:text-white'
                }`}
                title="5-Band Equalizer"
              >
                <Sliders className="w-4 h-4" />
              </button>

              <button
                type="button"
                aria-label={effectivelyMuted ? 'Unmute Audio' : 'Mute Audio'}
                onClick={handleToggleMute}
                className="hidden sm:inline-flex p-2 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                {effectivelyMuted ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>

              <input
                type="range"
                aria-label="Master Volume"
                min={0}
                max={1}
                step={0.02}
                value={isMuted ? 0 : volume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                className="hidden lg:block w-20 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
              />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
