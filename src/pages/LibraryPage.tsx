import React from 'react';
import { ChevronRight, Download, Heart, History } from 'lucide-react';
import { useAppActions } from '../app/AppActionsContext';
import type { Route } from '../app/router';
import { APP_VERSION } from '../appVersion';
import type { MetrolistTrack } from '../data/track';
import { EmptyState } from '../components/EmptyState';
import { NavLink } from '../components/NavLink';
import { songCount } from '../components/Sidebar';
import { SongList, type ListStatus } from '../components/SongList';
import { countRender } from '../utils/renderProbe';
import { usePlayFromList } from './usePlayList';

interface LibraryPageProps extends ListStatus {
  likedCount: number;
  downloadedCount: number;
  recentTracks: MetrolistTrack[];
}

/** How long the version must be pressed to open the hidden debug log. */
export const DEBUG_LONG_PRESS_MS = 800;

/** Your Library: Liked Songs and Downloads, then Recently played; the version at the bottom. */
export const LibraryPage = React.memo(function LibraryPage({ likedCount, downloadedCount, recentTracks, ...status }: LibraryPageProps) {
  countRender('LibraryPage');
  const { go } = useAppActions();
  const playRecent = usePlayFromList(recentTracks, 'library');
  // A long press on the version opens the hidden debug log (#/debug): no button in the normal UI
  const pressTimer = React.useRef<number | null>(null);
  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };
  React.useEffect(() => cancelPress, []);
  const entries: Array<{ label: string; to: Route; count: number; icon: React.ReactNode }> = [
    { label: 'Liked Songs', to: { name: 'liked' }, count: likedCount, icon: <Heart className="w-7 h-7 fill-current" />, },
    { label: 'Downloads', to: { name: 'downloads' }, count: downloadedCount, icon: <Download className="w-7 h-7" />, },
  ];
  return (
    <div className="space-y-8 short:space-y-6">
      <h1 className="text-[28px] short:text-2xl lg:text-[32px] font-bold tracking-tight text-white">Your Library</h1>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:max-w-3xl">
        {entries.map((entry) => (
          <li key={entry.label}>
            <NavLink to={entry.to} className="group flex items-center gap-4 rounded-xl bg-white/5 hover:bg-white/8 p-3">
              <span aria-hidden="true" className="w-16 h-16 short:w-12 short:h-12 rounded-lg bg-white/8 text-white flex items-center justify-center shrink-0">
                {entry.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-base font-bold text-white">{entry.label}</span>
                <span className="block text-sm text-zinc-400">{songCount(entry.count)}</span>
              </span>
              <ChevronRight className="w-5 h-5 text-zinc-400 group-hover:text-white shrink-0" aria-hidden="true" />
            </NavLink>
          </li>
        ))}
      </ul>

      <section aria-labelledby="library-recent">
        <h2 id="library-recent" className="text-xl font-bold text-white mb-2">
          Recently played
        </h2>
        {recentTracks.length > 0 ? (
          <SongList label="Recently played" tracks={recentTracks} onPlay={playRecent} {...status} />
        ) : (
          <EmptyState
            icon={<History className="w-7 h-7" />}
            title="Nothing played yet"
            action={{ label: 'Find something to play', onClick: () => go({ name: 'search', query: '' }) }}
          >
            Songs you play show up here, so you can get back to them quickly.
          </EmptyState>
        )}
      </section>

      <p
        data-testid="app-version"
        className="pt-2 text-xs text-zinc-400 select-none [-webkit-touch-callout:none]"
        onPointerDown={() => {
          cancelPress();
          pressTimer.current = window.setTimeout(() => {
            pressTimer.current = null;
            go({ name: 'debug' });
          }, DEBUG_LONG_PRESS_MS);
        }}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => e.preventDefault()}
      >
        Metrolist {APP_VERSION}
      </p>
    </div>
  );
});
