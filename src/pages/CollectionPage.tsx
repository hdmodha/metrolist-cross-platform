import React from 'react';
import { ChevronLeft, Download, Heart, Info, Pause, Play, Shuffle } from 'lucide-react';
import { useAppActions } from '../app/AppActionsContext';
import type { MetrolistTrack } from '../data/track';
import type { PlaySource } from '../player/playerCore';
import { EmptyState } from '../components/EmptyState';
import { NavLink } from '../components/NavLink';
import { songCount } from '../components/Sidebar';
import { SongList, type ListStatus } from '../components/SongList';
import { countRender } from '../utils/renderProbe';
import { usePlayFromList } from './usePlayList';

interface CollectionPageProps extends ListStatus {
  kind: 'liked' | 'downloads';
  tracks: MetrolistTrack[];
  playingFrom: PlaySource | null;
}

const COPY = {
  liked: {
    title: 'Liked Songs',
    source: 'liked' as PlaySource,
    tile: 'from-indigo-500 via-indigo-400 to-emerald-400',
    header: 'from-indigo-700/60',
    icon: <Heart className="w-14 h-14 lg:w-20 lg:h-20 fill-current" />,
    emptyIcon: <Heart className="w-7 h-7" />,
    emptyTitle: 'Songs you like will appear here',
    emptyText: 'Save songs by tapping the heart.',
  },
  downloads: {
    title: 'Downloads',
    source: 'downloads' as PlaySource,
    tile: 'from-emerald-600 to-teal-400',
    header: 'from-emerald-800/60',
    icon: <Download className="w-14 h-14 lg:w-20 lg:h-20" />,
    emptyIcon: <Download className="w-7 h-7" />,
    emptyTitle: 'Songs you download will appear here',
    emptyText: 'Choose Download in any song’s ⋮ menu.',
  },
};

/** Liked Songs / Downloads: playlist-style header with Play and Shuffle, then the songs, newest first. */
export const CollectionPage = React.memo(function CollectionPage({ kind, tracks, playingFrom, ...status }: CollectionPageProps) {
  countRender(kind === 'liked' ? 'LikedSongsPage' : 'DownloadsPage');
  const { player, go } = useAppActions();
  const copy = COPY[kind];
  const playRow = usePlayFromList(tracks, copy.source);
  const playingThis =
    playingFrom === copy.source && status.activeTrackId !== null && tracks.some((t) => t.id === status.activeTrackId);
  const showPause = playingThis && status.isPlaying;

  const buttons = tracks.length > 0 && (
    <div className="flex items-center gap-4 short:gap-2 shrink-0">
      <button
        type="button"
        aria-label={`${showPause ? 'Pause' : 'Play'} ${copy.title}`}
        onClick={() => (playingThis ? player.togglePlay() : player.playFromList(tracks[0], tracks, copy.source))}
        className="tap-target w-14 h-14 short:w-12 short:h-12 rounded-full bg-emerald-400 hover:bg-emerald-300 hover:scale-105 active:scale-95 text-zinc-950 inline-flex items-center justify-center shadow-xl shadow-black/40 transition-transform cursor-pointer"
      >
        {showPause ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-6 h-6 fill-current ml-0.5" />}
      </button>
      <button
        type="button"
        aria-label={`Shuffle ${copy.title}`}
        onClick={() => player.shuffleList(tracks, copy.source)}
        className="tap-target w-12 h-12 rounded-full text-zinc-300 hover:text-white inline-flex items-center justify-center cursor-pointer"
      >
        <Shuffle className="w-7 h-7 short:w-6 short:h-6" />
      </button>
    </div>
  );

  return (
    <div>
      <div className={`-mx-[var(--page-px)] -mt-[max(1.25rem,env(safe-area-inset-top))] short:-mt-[max(0.75rem,env(safe-area-inset-top))] lg:-mt-6 px-[var(--page-px)] pt-[max(1.25rem,env(safe-area-inset-top))] short:pt-[max(0.75rem,env(safe-area-inset-top))] lg:pt-6 pb-6 short:pb-4 bg-gradient-to-b ${copy.header} to-transparent`}>
        <NavLink
          to={{ name: 'library' }}
          intent="tab"
          aria-label="Back to Your Library"
          className="lg:hidden short:hidden tap-target -ml-2 mb-1 inline-flex items-center justify-center w-10 h-10 rounded-full text-white hover:bg-white/10"
        >
          <ChevronLeft className="w-6 h-6" />
        </NavLink>
        <div className="flex flex-col sm:flex-row sm:items-end short:flex-row short:items-center gap-4 sm:gap-6 short:gap-4">
          <div aria-hidden="true" className={`w-36 h-36 max-[359px]:w-28 max-[359px]:h-28 sm:w-44 sm:h-44 lg:w-52 lg:h-52 short:w-16 short:h-16 rounded-lg bg-gradient-to-br ${copy.tile} text-white flex items-center justify-center shadow-2xl shadow-black/50 shrink-0 mx-auto sm:mx-0 short:mx-0 [&>svg]:short:w-8 [&>svg]:short:h-8 [&>svg]:max-[359px]:w-11 [&>svg]:max-[359px]:h-11`}>
            {copy.icon}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-3xl sm:text-4xl lg:text-6xl short:text-2xl font-extrabold tracking-tight text-white">{copy.title}</h1>
            <p className="mt-2 short:mt-0.5 text-sm text-zinc-300">{songCount(tracks.length)}</p>
          </div>
          <div className="hidden short:block">{buttons}</div>
        </div>
        {kind === 'downloads' && (
          <p className="mt-4 short:mt-2 flex items-start gap-2 text-sm text-zinc-300">
            <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>Songs in Downloads still need an internet connection to play.</span>
          </p>
        )}
        {buttons && <div className="mt-5 short:hidden">{buttons}</div>}
      </div>

      {tracks.length > 0 ? (
        <SongList label={copy.title} tracks={tracks} onPlay={playRow} {...status} />
      ) : (
        <EmptyState icon={copy.emptyIcon} title={copy.emptyTitle} action={{ label: 'Find songs', onClick: () => go({ name: 'search', query: '' }) }}>
          {copy.emptyText}
        </EmptyState>
      )}
    </div>
  );
});
