import React from 'react';
import { STATIC_YTM_FALLBACK } from './data/fallbackTracks';
import { liveTrackId, selectLibraryTracks, selectQueueTracks } from './player/playerCore';
import { usePlayer } from './player/usePlayer';
import { AppHeader, type LibraryFilter } from './components/AppHeader';
import { NowPlayingBar } from './components/NowPlayingBar';
import { PlayerLibraryView, isSearchQuery } from './components/PlayerLibraryView';
import { PlayerNotices } from './components/PlayerNotices';
import { QueueDrawer, type DrawerTab } from './components/QueueDrawer';
import { YouTubeStreamBridge } from './components/YouTubeStreamBridge';
import { useSearchBackNavigation } from './components/useSearchBackNavigation';
import { countRender } from './utils/renderProbe';

/** Two-column layout (content + drawer) starts at Tailwind's `lg` breakpoint. */
const TWO_COLUMN_MIN_WIDTH = 1024;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export default function App() {
  countRender('App');
  const player = usePlayer();
  const { state, actions, activeTrack } = player;

  // View-only state
  const [searchQuery, setSearchQuery] = React.useState('');
  const [libraryFilter, setLibraryFilter] = React.useState<LibraryFilter>('ALL');
  const [drawerTab, setDrawerTab] = React.useState<DrawerTab>('QUEUE');

  const clearSearch = React.useCallback(() => setSearchQuery(''), []);
  useSearchBackNavigation(isSearchQuery(searchQuery), clearSearch);

  const { tracksById, libraryIds, queueIds, userQueuedIds: userQueuedList, recommendations } = state;
  const libraryTracks = React.useMemo(() => selectLibraryTracks({ tracksById, libraryIds }), [tracksById, libraryIds]);
  const queueTracks = React.useMemo(() => selectQueueTracks({ tracksById, queueIds }), [tracksById, queueIds]);
  const userQueuedIds = React.useMemo(() => new Set(userQueuedList), [userQueuedList]);
  const activeId = activeTrack?.id ?? '';
  const shelf = React.useMemo(
    () =>
      recommendations.length > 0
        ? recommendations
        : STATIC_YTM_FALLBACK.filter((t) => liveTrackId(t.videoId) !== activeId),
    [recommendations, activeId]
  );

  const goHome = React.useCallback(() => {
    setLibraryFilter('ALL');
    setSearchQuery('');
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, []);

  const openDrawerTab = React.useCallback((tab: DrawerTab) => {
    setDrawerTab(tab);
    if (window.innerWidth < TWO_COLUMN_MIN_WIDTH) {
      document
        .getElementById('inspector-drawer')
        ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100 flex flex-col selection:bg-emerald-500/30">
      <AppHeader
        libraryFilter={libraryFilter}
        onLibraryFilterChange={setLibraryFilter}
        onHome={goHome}
        autoplayRadio={state.autoplayRadio}
        onToggleAutoplayRadio={actions.toggleAutoplayRadio}
      />

      <main className="flex-1 max-w-[1600px] w-full mx-auto pt-5 short:pt-3 pb-[calc(8rem+env(safe-area-inset-bottom))] sm:pb-[calc(7rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))]">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 xl:col-span-8 min-w-0">
            <PlayerLibraryView
              libraryTracks={libraryTracks}
              tracksById={tracksById}
              activeTrack={activeTrack}
              isPlaying={state.isPlaying}
              isStreamLoading={player.isStreamLoading}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              libraryFilter={libraryFilter}
              recommendations={shelf}
              isLoadingRecommendations={player.isLoadingRecommendations}
              onTogglePlay={actions.togglePlay}
              onPlaySearchResult={actions.playSearchResult}
              onPlayFromList={actions.playFromList}
              onPlayNext={actions.playNext}
              onAddToQueue={actions.addToQueue}
              onToggleLike={actions.toggleLike}
              onToggleDownloaded={actions.toggleDownloaded}
            />
          </div>

          <aside
            id="inspector-drawer"
            aria-label="Queue and Equalizer Inspector"
            className="lg:col-span-5 xl:col-span-4 lg:sticky lg:top-20 scroll-mt-20 min-w-0"
          >
            <QueueDrawer
              activeTab={drawerTab}
              onTabChange={setDrawerTab}
              activeTrackId={activeId}
              activeTrackIsLive={player.isLive}
              queue={queueTracks}
              userQueuedIds={userQueuedIds}
              onPlayQueueItem={actions.playQueueItem}
              onMoveQueueItem={actions.moveQueueItem}
              onRemoveQueueItem={actions.removeFromQueue}
              onClearUpcoming={actions.clearUpcoming}
              shuffleEnabled={state.shuffleEnabled}
              onToggleShuffle={actions.toggleShuffle}
              repeatMode={state.repeatMode}
              onCycleRepeatMode={actions.cycleRepeat}
              eqGains={player.audio.eqGains}
              onChangeEqGain={actions.setEqGain}
              onResetEq={actions.resetEq}
              spectrumActive={state.isPlaying && !!activeTrack && !player.isLive}
            />
          </aside>
        </div>
      </main>

      {/* Full-length YouTube stream (hidden unless the browser demands a tap to start) */}
      {player.stream && <YouTubeStreamBridge {...player.stream} />}

      <PlayerNotices notice={state.notice} waitingForNetwork={state.network.waiting && player.isLive} />

      <NowPlayingBar
        track={activeTrack}
        clock={player.clock}
        isPlaying={state.isPlaying}
        isStreamLoading={player.isStreamLoading}
        shuffleEnabled={state.shuffleEnabled}
        repeatMode={state.repeatMode}
        volume={player.audio.volume}
        isMuted={player.audio.isMuted}
        drawerTab={drawerTab}
        onTogglePlay={actions.togglePlay}
        onNext={actions.next}
        onPrevious={actions.previous}
        onSeek={actions.seekTo}
        onToggleShuffle={actions.toggleShuffle}
        onCycleRepeat={actions.cycleRepeat}
        onVolumeChange={actions.setVolume}
        onToggleMute={actions.toggleMute}
        onOpenDrawerTab={openDrawerTab}
      />
    </div>
  );
}
