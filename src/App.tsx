import React from 'react';
import { AppActionsContext, type AppActions } from './app/AppActionsContext';
import { formatRoute, navigate, type HistoryFlags, type Route } from './app/router';
import { useNowPlaying } from './app/useNowPlaying';
import { useRoute } from './app/useRoute';
import { BottomNav } from './components/BottomNav';
import { MiniPlayer } from './components/MiniPlayer';
import { Notices } from './components/Notices';
import { NowPlaying } from './components/NowPlaying';
import { PlayerBar } from './components/PlayerBar';
import { Sidebar } from './components/Sidebar';
import { YouTubeStreamBridge } from './components/YouTubeStreamBridge';
import { CollectionPage } from './pages/CollectionPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { SearchPage } from './pages/SearchPage';
import {
  selectDownloadedTracks,
  selectLikedTracks,
  selectQueueTracks,
  selectRecentlyPlayedTracks,
} from './player/playerCore';
import { usePlayer } from './player/usePlayer';
import { countRender } from './utils/renderProbe';

const DESKTOP_QUERY = '(min-width: 1024px)';

/**
 * The app shell: player state (`usePlayer`), the route (`useRoute`) and Now Playing
 * (`useNowPlaying`) in, pages and chrome out. It never re-renders on playback ticks.
 */
export default function App() {
  countRender('App');
  const player = usePlayer();
  const { state, actions, activeTrack, clock } = player;
  const route = useRoute();
  const nowPlaying = useNowPlaying(activeTrack !== null);
  const [queueFirst, setQueueFirst] = React.useState(false);

  const { tracksById, likedIds, downloadedIds, recentlyPlayedIds, queueIds } = state;
  const likedTracks = React.useMemo(() => selectLikedTracks({ tracksById, likedIds }), [tracksById, likedIds]);
  const downloadedTracks = React.useMemo(() => selectDownloadedTracks({ tracksById, downloadedIds }), [tracksById, downloadedIds]);
  const recentTracks = React.useMemo(() => selectRecentlyPlayedTracks({ tracksById, recentlyPlayedIds }), [tracksById, recentlyPlayedIds]);
  const queueTracks = React.useMemo(() => selectQueueTracks({ tracksById, queueIds }), [tracksById, queueIds]);
  const likedSet = React.useMemo(() => new Set(likedIds), [likedIds]);
  const downloadedSet = React.useMemo(() => new Set(downloadedIds), [downloadedIds]);

  const { open: openNowPlaying, close: closeNowPlaying, leaveForNavigation } = nowPlaying;
  const appActions = React.useMemo<AppActions>(() => {
    const go = (to: Route, options: { flags?: HistoryFlags } = {}) => {
      const replace = leaveForNavigation();
      if (!replace && !options.flags && formatRoute(to) === window.location.hash) {
        window.scrollTo(0, 0);
        return;
      }
      navigate(to, { replace, flags: options.flags });
      window.scrollTo(0, 0);
    };
    return {
      player: actions,
      go,
      goToArtist: (artist: string) => go({ name: 'search', query: artist }),
      openNowPlaying: () => {
        setQueueFirst(false);
        openNowPlaying();
      },
      closeNowPlaying,
    };
  }, [actions, closeNowPlaying, leaveForNavigation, openNowPlaying]);

  const openQueue = React.useCallback(() => {
    setQueueFirst(true);
    openNowPlaying();
  }, [openNowPlaying]);

  // Focus returns to the control that opened Now Playing when it closes
  const miniExpandRef = React.useRef<HTMLButtonElement | null>(null);
  const barExpandRef = React.useRef<HTMLButtonElement | null>(null);
  const wasOpenRef = React.useRef(false);
  React.useEffect(() => {
    if (nowPlaying.isOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const desktop = window.matchMedia?.(DESKTOP_QUERY).matches;
    (desktop ? barExpandRef.current : miniExpandRef.current)?.focus({ preventScroll: true });
  }, [nowPlaying.isOpen]);

  const status = {
    activeTrackId: state.activeTrackId,
    isPlaying: state.isPlaying,
    likedIds: likedSet,
    downloadedIds: downloadedSet,
  };

  let page: React.ReactNode;
  switch (route.name) {
    case 'search':
      page = <SearchPage query={route.query} {...status} />;
      break;
    case 'library':
      page = (
        <LibraryPage likedCount={likedTracks.length} downloadedCount={downloadedTracks.length} recentTracks={recentTracks} {...status} />
      );
      break;
    case 'liked':
      page = <CollectionPage key="liked" kind="liked" tracks={likedTracks} playingFrom={state.playingFrom} {...status} />;
      break;
    case 'downloads':
      page = <CollectionPage key="downloads" kind="downloads" tracks={downloadedTracks} playingFrom={state.playingFrom} {...status} />;
      break;
    default:
      page = (
        <HomePage
          activeTrack={activeTrack}
          recentTracks={recentTracks}
          likedTracks={likedTracks}
          recommendations={state.recommendations}
          isLoadingRecommendations={player.isLoadingRecommendations}
          {...status}
        />
      );
  }

  const liked = activeTrack ? likedSet.has(activeTrack.id) : false;

  return (
    <AppActionsContext.Provider value={appActions}>
      <div
        className="app-shell min-h-dvh bg-[#09090B] text-zinc-100 selection:bg-emerald-500/30"
        data-player={activeTrack ? 'on' : 'off'}
      >
        <div inert={nowPlaying.isOpen}>
          <Sidebar route={route} likedCount={likedTracks.length} downloadedCount={downloadedTracks.length} />

          <main className="page lg:ml-64 min-w-0">{page}</main>

          <div
            data-chrome="bottom"
            className="lg:hidden fixed inset-x-0 bottom-0 z-40 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] bg-gradient-to-t from-[#09090B] from-60% to-[#09090B]/85 backdrop-blur-md"
          >
            {activeTrack && (
              <MiniPlayer
                track={activeTrack}
                clock={clock}
                isPlaying={state.isPlaying}
                isLoading={player.isStreamLoading}
                liked={liked}
                onTogglePlay={actions.togglePlay}
                onToggleLike={actions.toggleLike}
                onExpand={appActions.openNowPlaying}
                expandRef={miniExpandRef}
              />
            )}
            <BottomNav route={route} />
          </div>

          {activeTrack && (
            <PlayerBar
              track={activeTrack}
              clock={clock}
              isPlaying={state.isPlaying}
              isLoading={player.isStreamLoading}
              liked={liked}
              shuffleEnabled={state.shuffleEnabled}
              repeatMode={state.repeatMode}
              volume={player.audio.volume}
              isMuted={player.audio.isMuted}
              onTogglePlay={actions.togglePlay}
              onNext={actions.next}
              onPrevious={actions.previous}
              onSeek={actions.seekTo}
              onToggleShuffle={actions.toggleShuffle}
              onCycleRepeat={actions.cycleRepeat}
              onToggleLike={actions.toggleLike}
              onVolumeChange={actions.setVolume}
              onToggleMute={actions.toggleMute}
              onOpenQueue={openQueue}
              onExpand={appActions.openNowPlaying}
              expandRef={barExpandRef}
            />
          )}
        </div>

        {nowPlaying.isOpen && activeTrack && (
          <NowPlaying
            track={activeTrack}
            clock={clock}
            queue={queueTracks}
            isPlaying={state.isPlaying}
            isLoading={player.isStreamLoading}
            liked={liked}
            downloaded={downloadedSet.has(activeTrack.id)}
            shuffleEnabled={state.shuffleEnabled}
            repeatMode={state.repeatMode}
            autoplayRadio={state.autoplayRadio}
            playingFrom={state.playingFrom}
            initialQueueOpen={queueFirst}
            onClose={closeNowPlaying}
          />
        )}

        <Notices notice={state.notice} waitingForNetwork={state.network.waiting && activeTrack !== null} />

        {/* Full-length YouTube stream (hidden unless the browser demands a tap to start) */}
        {player.stream && <YouTubeStreamBridge {...player.stream} />}
      </div>
    </AppActionsContext.Provider>
  );
}
