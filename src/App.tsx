import React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Volume2,
  VolumeX,
  Mic2,
  ListMusic,
  Sliders,
  Radio,
} from 'lucide-react';
import {
  INITIAL_TRACKS,
  type MetrolistTrack,
} from './data/metrolistData';
import {
  computeDeterministicHashHex,
  formatDurationMs,
  type InnerTubeParsedTrack,
} from './utils/metrolistCore';
import { sharedAudioEngine } from './utils/webAudioSynth';
import { PlayerLibraryView, STATIC_YTM_FALLBACK } from './components/PlayerLibraryView';
import { LyricsAndQueueDrawer } from './components/LyricsAndQueueDrawer';
import { YouTubeStreamBridge } from './components/YouTubeStreamBridge';

function convertRecommendationToTrack(ytTrack: InnerTubeParsedTrack): MetrolistTrack {
  const fullSongDurationMs = ytTrack.durationMs > 30000 ? ytTrack.durationMs : 218000;
  return {
    id: `ytm-${ytTrack.videoId}`,
    videoId: ytTrack.videoId,
    title: ytTrack.title,
    artist: ytTrack.artist,
    album: ytTrack.album || 'YouTube Music Radio',
    durationMs: fullSongDurationMs,
    bpm: 116,
    rootFreqHz: 220,
    chordIntervals: [0, 3, 7, 10],
    coverUrl: ytTrack.thumbnailUrl || INITIAL_TRACKS[0].coverUrl,
    accentColor: '#10B981',
    genre: 'YouTube Music',
    liked: false,
    cachedOffline: false,
    cacheSizeMb: 6.4,
    sha256Checksum: computeDeterministicHashHex(ytTrack.videoId),
    lyricsSource: 'LRCLIB',
    rawLrc: [
      `[00:00.00] ${ytTrack.title} — ${ytTrack.artist}`,
      `[00:08.00] YouTube Music Radio recommendation (${formatDurationMs(fullSongDurationMs)})`,
      `[00:16.00] Synchronizing time-coded lyrics from LRCLIB...`,
    ].join('\n'),
    streamCandidates: INITIAL_TRACKS[0].streamCandidates,
    isLiveInnerTube: true,
  };
}

export default function App() {
  // Catalog & Queue State
  const [tracks, setTracks] = React.useState<MetrolistTrack[]>(INITIAL_TRACKS);
  const [queue, setQueue] = React.useState<MetrolistTrack[]>(INITIAL_TRACKS);
  const [activeTrackId, setActiveTrackId] = React.useState<string>(INITIAL_TRACKS[0].id);
  const [isPlaying, setIsPlaying] = React.useState<boolean>(false);
  const [currentTimeMs, setCurrentTimeMs] = React.useState<number>(36000);
  const [seekRequestMs, setSeekRequestMs] = React.useState<number | null>(null);
  const [volume, setVolume] = React.useState<number>(0.8);
  const [isMuted, setIsMuted] = React.useState<boolean>(false);
  const [shuffleEnabled, setShuffleEnabled] = React.useState<boolean>(false);
  const [repeatMode, setRepeatMode] = React.useState<'OFF' | 'ALL' | 'ONE'>('ALL');
  const [autoplayRadio, setAutoplayRadio] = React.useState<boolean>(true);

  // Live InnerTube Stream & YouTube Radio Recommendations State
  const [isResolvingLiveTrackId, setIsResolvingLiveTrackId] = React.useState<string | null>(null);
  const [activePlaybackSource, setActivePlaybackSource] = React.useState<
    'DIRECT_AAC_STREAM' | 'YOUTUBE_IFRAME' | 'STUDIO_SYNTH'
  >('STUDIO_SYNTH');
  const [ytBridgeActivelyPlaying, setYtBridgeActivelyPlaying] = React.useState<boolean>(false);
  const [ytRecommendations, setYtRecommendations] =
    React.useState<InnerTubeParsedTrack[]>(STATIC_YTM_FALLBACK);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = React.useState<boolean>(false);

  // Filters & Drawer State
  const [searchQuery, setSearchQuery] = React.useState<string>('');
  const [selectedGenre, setSelectedGenre] = React.useState<string>('All');
  const [libraryFilter, setLibraryFilter] = React.useState<'ALL' | 'LIKED' | 'CACHED'>('ALL');
  const [drawerTab, setDrawerTab] = React.useState<'LYRICS' | 'QUEUE' | 'EQ'>('LYRICS');
  const [eqGains, setEqGains] = React.useState<number[]>([2, 1, 0, 1, 3]);
  const [frequencyLevels, setFrequencyLevels] = React.useState<number[]>(
    Array.from({ length: 16 }, () => 14)
  );

  const activeTrack = React.useMemo(
    () =>
      tracks.find((t) => t.id === activeTrackId) ||
      queue.find((t) => t.id === activeTrackId) ||
      tracks[0],
    [tracks, queue, activeTrackId]
  );

  // Helper to resolve LRCLIB synced lyrics for any YouTube Music track
  const resolveSyncedLyricsForTrack = React.useCallback(
    async (trackId: string, videoId: string, title: string, artist: string, durationMs: number) => {
      try {
        let syncedLrc = '';
        try {
          const res = await fetch(
            `/api/innertube/resolve?videoId=${encodeURIComponent(
              videoId
            )}&title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist)}`
          );
          if (res.ok) {
            const resolved = await res.json();
            syncedLrc = resolved.syncedLrc || '';
          }
        } catch {
          // Static host fallback
        }

        if (!syncedLrc) {
          const lrcUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(
            title
          )}&artist_name=${encodeURIComponent(artist)}`;
          const directRes = await fetch(lrcUrl);
          if (directRes.ok) {
            const items = await directRes.json();
            if (Array.isArray(items) && items.length > 0) {
              const best =
                items.find((i: { syncedLyrics?: string }) => !!i.syncedLyrics) || items[0];
              syncedLrc = best?.syncedLyrics || '';
            }
          }
        }

        if (syncedLrc) {
          setTracks((prev) =>
            prev.map((t) => (t.id === trackId ? { ...t, durationMs, rawLrc: syncedLrc } : t))
          );
          setQueue((prev) =>
            prev.map((t) => (t.id === trackId ? { ...t, durationMs, rawLrc: syncedLrc } : t))
          );
        }
      } catch {
        // Keep existing lyrics
      }
    },
    []
  );

  /**
   * Official YouTube Music Recommendation Engine (`RDAMVM` WatchNext):
   * Whenever the active song changes, fetches YouTube's algorithmic song suggestions
   * for the currently playing song and updates both the Recommendations shelf and Up Next Queue.
   */
  React.useEffect(() => {
    let cancelled = false;

    async function loadRecommendations() {
      setIsLoadingRecommendations(true);
      try {
        const res = await fetch(
          `/api/innertube/recommendations?videoId=${encodeURIComponent(
            activeTrack.videoId
          )}&title=${encodeURIComponent(activeTrack.title)}&artist=${encodeURIComponent(
            activeTrack.artist
          )}`
        );
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = await res.json();
          if (!cancelled && Array.isArray(data.tracks) && data.tracks.length > 0) {
            const recs: InnerTubeParsedTrack[] = data.tracks;
            setYtRecommendations(recs);

            if (autoplayRadio) {
              const recommendedTracks = recs.slice(0, 8).map(convertRecommendationToTrack);
              setQueue((prevQueue) => {
                const currentTrackObj =
                  prevQueue.find((t) => t.id === activeTrack.id) || activeTrack;
                const seenIds = new Set<string>([currentTrackObj.id]);
                const nextQueue: MetrolistTrack[] = [currentTrackObj];

                for (const recTrack of recommendedTracks) {
                  if (!seenIds.has(recTrack.id)) {
                    seenIds.add(recTrack.id);
                    nextQueue.push(recTrack);
                  }
                }
                return nextQueue;
              });
            }
            return;
          }
        }
        if (!cancelled) {
          setYtRecommendations(
            STATIC_YTM_FALLBACK.filter((t) => t.videoId !== activeTrack.videoId)
          );
        }
      } catch {
        if (!cancelled) {
          setYtRecommendations(
            STATIC_YTM_FALLBACK.filter((t) => t.videoId !== activeTrack.videoId)
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRecommendations(false);
        }
      }
    }

    loadRecommendations();
    return () => {
      cancelled = true;
    };
  }, [activeTrack.id, activeTrack.videoId, activeTrack.title, activeTrack.artist, autoplayRadio]);

  const handleSkipTrack = React.useCallback(
    (direction: -1 | 1) => {
      if (!queue.length) return;
      const currentIndex = queue.findIndex((t) => t.id === activeTrack.id);
      let nextIndex = 0;
      if (shuffleEnabled && queue.length > 1) {
        nextIndex = (currentIndex + 2) % queue.length;
      } else {
        nextIndex = (currentIndex + direction + queue.length) % queue.length;
      }
      const nextTrack = queue[nextIndex];
      if (!nextTrack) return;

      setTracks((prev) => (prev.some((t) => t.id === nextTrack.id) ? prev : [nextTrack, ...prev]));
      setActiveTrackId(nextTrack.id);
      setCurrentTimeMs(0);
      setSeekRequestMs(0);
      setYtBridgeActivelyPlaying(false);
      setActivePlaybackSource(nextTrack.isLiveInnerTube ? 'DIRECT_AAC_STREAM' : 'STUDIO_SYNTH');
      setIsPlaying(true);

      if (nextTrack.isLiveInnerTube) {
        resolveSyncedLyricsForTrack(
          nextTrack.id,
          nextTrack.videoId,
          nextTrack.title,
          nextTrack.artist,
          nextTrack.durationMs
        );
      }
    },
    [queue, activeTrack.id, shuffleEnabled, resolveSyncedLyricsForTrack]
  );

  // Playback Timer & Continuous Full-Song Engine Lifecycle
  React.useEffect(() => {
    if (!isPlaying) {
      sharedAudioEngine.stop();
      setFrequencyLevels(Array.from({ length: 16 }, () => 10));
      return;
    }

    // Start Web Audio synthesizer for local studio tracks or when not using the YouTube IFrame bridge
    if (!activeTrack.isLiveInnerTube || activePlaybackSource === 'STUDIO_SYNTH') {
      sharedAudioEngine.startTrack(
        activeTrack.rootFreqHz,
        activeTrack.chordIntervals,
        activeTrack.bpm,
        1.0
      );
    } else {
      sharedAudioEngine.stop();
    }

    const timer = window.setInterval(() => {
      setFrequencyLevels(sharedAudioEngine.getFrequencyLevels(16));

      // When YouTubeStreamBridge is actively streaming & reporting time, let it drive currentTimeMs
      if (activeTrack.isLiveInnerTube && ytBridgeActivelyPlaying) {
        return;
      }

      setCurrentTimeMs((prev) => {
        const next = prev + 250;
        if (next >= activeTrack.durationMs) {
          if (repeatMode === 'ONE') {
            return 0;
          }
          window.setTimeout(() => handleSkipTrack(1), 0);
          return 0;
        }
        return next;
      });
    }, 250);

    return () => {
      window.clearInterval(timer);
    };
  }, [
    isPlaying,
    activeTrack,
    activePlaybackSource,
    ytBridgeActivelyPlaying,
    repeatMode,
    handleSkipTrack,
  ]);

  // Cross-Platform OS MediaSession Integration (macOS Control Center, Windows SMTC, iOS Lock Screen, Android Media Notification)
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: activeTrack.title,
        artist: activeTrack.artist,
        album: activeTrack.album,
        artwork: [{ src: activeTrack.coverUrl, sizes: '512x512', type: 'image/jpeg' }],
      });
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      navigator.mediaSession.setActionHandler('play', () => setIsPlaying(true));
      navigator.mediaSession.setActionHandler('pause', () => setIsPlaying(false));
      navigator.mediaSession.setActionHandler('previoustrack', () => handleSkipTrack(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => handleSkipTrack(1));
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') {
          const ms = Math.round(details.seekTime * 1000);
          setCurrentTimeMs(ms);
          setSeekRequestMs(ms);
        }
      });
    } catch {
      // Ignore unsupported mediaSession actions on older browsers
    }
  }, [activeTrack, isPlaying, handleSkipTrack]);

  const handleTogglePlayPause = () => {
    setIsPlaying((prev) => !prev);
  };

  const handleSelectAndPlay = (track: MetrolistTrack) => {
    if (track.id === activeTrack.id) {
      setIsPlaying((prev) => !prev);
    } else {
      setTracks((prev) => (prev.some((t) => t.id === track.id) ? prev : [track, ...prev]));
      setActiveTrackId(track.id);
      setCurrentTimeMs(0);
      setSeekRequestMs(0);
      setYtBridgeActivelyPlaying(false);
      setActivePlaybackSource(track.isLiveInnerTube ? 'DIRECT_AAC_STREAM' : 'STUDIO_SYNTH');
      setIsPlaying(true);

      if (track.isLiveInnerTube) {
        resolveSyncedLyricsForTrack(
          track.id,
          track.videoId,
          track.title,
          track.artist,
          track.durationMs
        );
      }
    }
  };

  /**
   * Optimistic Zero-Latency Full-Length YouTube Music Playback:
   * Immediately updates Now Playing state with the FULL track duration (`ytTrack.durationMs`)
   * and triggers YouTube Music's RDAMVM algorithmic recommendations.
   */
  const handlePlayLiveInnerTubeTrack = async (ytTrack: InnerTubeParsedTrack) => {
    const existing = tracks.find((t) => t.videoId === ytTrack.videoId);
    if (existing) {
      handleSelectAndPlay(existing);
      return;
    }

    const optimisticTrack = convertRecommendationToTrack(ytTrack);
    optimisticTrack.liked = true;

    // Instant UI update (<10ms latency) with FULL song duration preserved
    setTracks((prev) => [optimisticTrack, ...prev]);
    setQueue((prev) => [optimisticTrack, ...prev.filter((t) => t.id !== optimisticTrack.id)]);
    setActiveTrackId(optimisticTrack.id);
    setCurrentTimeMs(0);
    setSeekRequestMs(0);
    setYtBridgeActivelyPlaying(false);
    setActivePlaybackSource('DIRECT_AAC_STREAM');
    setIsPlaying(true);
    setDrawerTab('LYRICS');

    setIsResolvingLiveTrackId(ytTrack.videoId);
    try {
      await resolveSyncedLyricsForTrack(
        optimisticTrack.id,
        ytTrack.videoId,
        ytTrack.title,
        ytTrack.artist,
        optimisticTrack.durationMs
      );
    } finally {
      setIsResolvingLiveTrackId(null);
    }
  };

  const handleQueueRecommendation = (ytTrack: InnerTubeParsedTrack) => {
    const trackToQueue = convertRecommendationToTrack(ytTrack);
    setTracks((prev) =>
      prev.some((t) => t.id === trackToQueue.id) ? prev : [...prev, trackToQueue]
    );
    setQueue((prev) =>
      prev.some((t) => t.id === trackToQueue.id) ? prev : [...prev, trackToQueue]
    );
    setDrawerTab('QUEUE');
  };

  const handleToggleLike = (trackId: string) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, liked: !t.liked } : t))
    );
    setQueue((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, liked: !t.liked } : t))
    );
  };

  const handleToggleCache = (trackId: string) => {
    setTracks((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, cachedOffline: !t.cachedOffline } : t))
    );
    setQueue((prev) =>
      prev.map((t) => (t.id === trackId ? { ...t, cachedOffline: !t.cachedOffline } : t))
    );
  };

  const handleAddToQueue = (track: MetrolistTrack) => {
    setQueue((prev) => {
      if (prev.some((item) => item.id === track.id)) return prev;
      return [...prev, track];
    });
    setDrawerTab('QUEUE');
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
    setQueue((prev) => prev.filter((item) => item.id !== trackId));
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
    setIsMuted((prev) => {
      const nextMuted = !prev;
      sharedAudioEngine.setVolume(nextMuted ? 0 : volume);
      return nextMuted;
    });
  };

  const handleOpenDrawerTab = (tab: 'LYRICS' | 'QUEUE' | 'EQ') => {
    setDrawerTab(tab);
    if (typeof window !== 'undefined' && window.innerWidth < 1280) {
      document.getElementById('inspector-drawer')?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col selection:bg-emerald-500/30">
      {/* Top Bar Contract: Single-Page Spotify-Style Header (Brand Left · Filter Links Center · Autoplay Radio CTA Right) */}
      <header className="sticky top-0 z-30 h-16 bg-[#09090B]/95 backdrop-blur-md border-b border-white/5 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setLibraryFilter('ALL');
            setSearchQuery('');
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
            onClick={() => setAutoplayRadio((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              autoplayRadio
                ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
            title="Automatically queue YouTube Music recommendations when playing a song"
          >
            <Radio className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Autoplay Radio:</span>
            <span>{autoplayRadio ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </header>

      {/* Main Content Area: Single-Page Home & Music + Synced Lyrics / Up Next Queue Drawer */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 sm:px-6 pt-5 pb-28">
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          <div className="xl:col-span-8 min-w-0">
            <PlayerLibraryView
              tracks={tracks}
              activeTrack={activeTrack}
              isPlaying={isPlaying}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedGenre={selectedGenre}
              onGenreChange={setSelectedGenre}
              libraryFilter={libraryFilter}
              onLibraryFilterChange={setLibraryFilter}
              onSelectAndPlay={handleSelectAndPlay}
              onPlayLiveInnerTubeTrack={handlePlayLiveInnerTubeTrack}
              isResolvingLiveTrackId={isResolvingLiveTrackId}
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
            aria-label="Live Lyrics, Queue, and Equalizer Inspector"
            className="xl:col-span-4 xl:sticky xl:top-20"
          >
            <LyricsAndQueueDrawer
              activeTab={drawerTab}
              onTabChange={setDrawerTab}
              activeTrack={activeTrack}
              currentTimeMs={currentTimeMs}
              onSeekToMs={(ms: number) => {
                setCurrentTimeMs(ms);
                setSeekRequestMs(ms);
              }}
              queue={queue}
              onSelectTrack={handleSelectAndPlay}
              onMoveQueueItem={handleMoveQueueItem}
              onRemoveQueueItem={handleRemoveQueueItem}
              eqGains={eqGains}
              onChangeEqGain={handleUpdateEqGain}
              frequencyLevels={frequencyLevels}
              hardenedSecurityMode={true}
            />
          </aside>
        </div>
      </main>

      {/* Hidden Full-Duration YouTube Music Stream Bridge */}
      {activeTrack.isLiveInnerTube && activePlaybackSource !== 'STUDIO_SYNTH' && (
        <YouTubeStreamBridge
          videoId={activeTrack.videoId}
          isPlaying={isPlaying}
          volume={volume}
          isMuted={isMuted}
          seekRequestMs={seekRequestMs}
          onSeekHandled={() => setSeekRequestMs(null)}
          onPlayingStateChange={(playing) => setYtBridgeActivelyPlaying(playing)}
          onTimeUpdateMs={(currentMs: number, durMs?: number) => {
            setCurrentTimeMs(currentMs);
            if (durMs && durMs > 30000) {
              setTracks((prev) =>
                prev.map((t) => (t.id === activeTrack.id ? { ...t, durationMs: durMs } : t))
              );
              setQueue((prev) =>
                prev.map((t) => (t.id === activeTrack.id ? { ...t, durationMs: durMs } : t))
              );
            }
          }}
          onEnded={() => handleSkipTrack(1)}
          onFallbackNeeded={() => {
            setYtBridgeActivelyPlaying(false);
            setActivePlaybackSource('STUDIO_SYNTH');
          }}
        />
      )}

      {/* Persistent Spotify-Style Now Playing Bottom Bar (Responsive Across Mobile, Tablet, and Desktop) */}
      <footer
        aria-label="Now Playing Audio Transport Bar"
        className="fixed bottom-0 inset-x-0 z-40 h-20 bg-[#09090B]/95 backdrop-blur-xl border-t border-white/10 px-3 sm:px-6 flex items-center"
      >
        <div className="max-w-[1600px] w-full mx-auto grid grid-cols-12 items-center gap-2 sm:gap-4">
          {/* Left: Track Artwork & Title */}
          <div className="col-span-4 sm:col-span-3 flex items-center gap-2.5 sm:gap-3 min-w-0">
            <img
              src={activeTrack.coverUrl}
              alt={activeTrack.title}
              referrerPolicy="no-referrer"
              className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg object-cover shrink-0 border border-white/10 bg-zinc-900"
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
          <div className="col-span-6 sm:col-span-6 flex flex-col items-center gap-1">
            <div className="flex items-center gap-2.5 sm:gap-4">
              <button
                type="button"
                aria-label="Toggle Shuffle"
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
                onClick={() => handleSkipTrack(-1)}
                className="p-1.5 rounded-full text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                <SkipBack className="w-4 h-4 fill-current" />
              </button>

              <button
                type="button"
                aria-label={isPlaying ? 'Pause Playback' : 'Start Playback'}
                onClick={handleTogglePlayPause}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-white hover:scale-105 active:scale-95 text-zinc-950 flex items-center justify-center transition-transform cursor-pointer shadow"
              >
                {isPlaying ? (
                  <Pause className="w-4 h-4 fill-current" />
                ) : (
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                aria-label="Next Track"
                onClick={() => handleSkipTrack(1)}
                className="p-1.5 rounded-full text-zinc-300 hover:text-white transition-colors cursor-pointer"
              >
                <SkipForward className="w-4 h-4 fill-current" />
              </button>

              <button
                type="button"
                aria-label="Toggle Repeat Mode"
                onClick={() =>
                  setRepeatMode((prev) =>
                    prev === 'OFF' ? 'ALL' : prev === 'ALL' ? 'ONE' : 'OFF'
                  )
                }
                className={`hidden sm:inline-flex p-1.5 rounded-full transition-colors cursor-pointer ${
                  repeatMode !== 'OFF' ? 'text-emerald-400' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Repeat className="w-4 h-4" />
              </button>
            </div>

            <div className="w-full max-w-lg flex items-center gap-2">
              <span className="text-[10px] sm:text-[11px] font-mono text-zinc-400 tabular-nums w-8 sm:w-9 text-right">
                {formatDurationMs(currentTimeMs)}
              </span>
              <input
                type="range"
                aria-label="Seek playback position"
                min={0}
                max={activeTrack.durationMs}
                value={Math.min(currentTimeMs, activeTrack.durationMs)}
                onChange={(e) => {
                  const target = Number(e.target.value);
                  setCurrentTimeMs(target);
                  setSeekRequestMs(target);
                }}
                className="flex-1 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-400"
              />
              <span className="text-[10px] sm:text-[11px] font-mono text-zinc-400 tabular-nums w-8 sm:w-9">
                {formatDurationMs(activeTrack.durationMs)}
              </span>
            </div>
          </div>

          {/* Right: Drawer Quick Switchers (Visible on Mobile & Desktop) & Master Volume */}
          <div className="col-span-2 sm:col-span-3 flex items-center justify-end gap-1 sm:gap-2">
            <button
              type="button"
              aria-label="Show Synced Lyrics Panel"
              onClick={() => handleOpenDrawerTab('LYRICS')}
              className={`p-1.5 sm:p-2 rounded-lg transition-colors cursor-pointer ${
                drawerTab === 'LYRICS'
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-zinc-400 hover:text-white'
              }`}
              title="Synced Lyrics"
            >
              <Mic2 className="w-4 h-4" />
            </button>

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
              aria-label={isMuted ? 'Unmute Audio' : 'Mute Audio'}
              onClick={handleToggleMute}
              className="hidden sm:inline-flex p-2 rounded-lg text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              {isMuted || volume === 0 ? (
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
      </footer>
    </div>
  );
}
