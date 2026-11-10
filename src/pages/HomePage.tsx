import React from 'react';
import { useAppActions } from '../app/AppActionsContext';
import { formatRoute } from '../app/router';
import { FEATURED_ARTISTS } from '../data/browse';
import type { MetrolistTrack } from '../data/track';
import { toMetrolistTrack } from '../player/playerCore';
import { Shelf } from '../components/Shelf';
import { SkeletonCards, SongCards, type ListStatus } from '../components/SongList';
import { greetingFor } from '../utils/greeting';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';
import { countRender } from '../utils/renderProbe';
import { usePlayFromList, usePlayOne } from './usePlayList';
import { usePopularTracks } from './usePopularTracks';

const MAX_SHELF_ITEMS = 12;
const MAX_ARTISTS = 6;

interface HomePageProps extends ListStatus {
  activeTrack: MetrolistTrack | null;
  recentTracks: MetrolistTrack[];
  likedTracks: MetrolistTrack[];
  recommendations: InnerTubeParsedTrack[];
  isLoadingRecommendations: boolean;
}

/** The first credited artist ("A & B", "A, B", "A feat. B" → "A"), without regular expressions. */
function primaryArtist(artist: string): string {
  let cut = artist.length;
  for (const separator of [' & ', ', ', ' feat. ', ' ft. ', ' x ', ' • ']) {
    const at = artist.indexOf(separator);
    if (at > 0) cut = Math.min(cut, at);
  }
  return artist.slice(0, cut).trim();
}

interface ArtistItem {
  name: string;
  coverUrl: string;
}

const AVATAR_COLORS = ['from-rose-500 to-orange-400', 'from-indigo-500 to-sky-400', 'from-emerald-500 to-lime-400', 'from-fuchsia-500 to-pink-400', 'from-amber-500 to-yellow-300', 'from-violet-500 to-indigo-400'];

function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

const ArtistCard = React.memo(function ArtistCard({ artist }: { artist: ArtistItem }) {
  const { goToArtist } = useAppActions();
  return (
    <li className="w-32 sm:w-36 short:w-24 lg:w-44 shrink-0 snap-start lg:p-3 rounded-lg lg:hover:bg-white/[0.06] transition-colors">
      <a
        href={formatRoute({ name: 'search', query: artist.name })}
        onClick={(e) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          goToArtist(artist.name);
        }}
        className="block rounded-md"
      >
        {artist.coverUrl ? (
          <img src={artist.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full aspect-square rounded-full object-cover bg-zinc-800 shadow-lg shadow-black/40" />
        ) : (
          <span aria-hidden="true" className={`flex w-full aspect-square rounded-full bg-gradient-to-br ${colorFor(artist.name)} items-center justify-center text-4xl short:text-2xl font-display font-extrabold text-white/95 shadow-lg shadow-black/40`}>
            {artist.name.slice(0, 1)}
          </span>
        )}
        <span className="block mt-2 truncate text-sm font-semibold text-white text-center lg:text-left">{artist.name}</span>
        <span className="block text-[13px] text-zinc-400 text-center lg:text-left">Artist</span>
      </a>
    </li>
  );
});

export const HomePage = React.memo(function HomePage({
  activeTrack,
  recentTracks,
  likedTracks,
  recommendations,
  isLoadingRecommendations,
  ...status
}: HomePageProps) {
  countRender('HomePage');
  const [greeting] = React.useState(() => greetingFor(new Date().getHours()));
  const popular = usePopularTracks(activeTrack === null);
  const playRecent = usePlayFromList(recentTracks, 'home');
  const playRecommendation = usePlayOne('radio');
  const playPopular = usePlayOne('home');

  const shelfSource = activeTrack ? recommendations : popular.tracks;
  const shelfTracks = React.useMemo(() => shelfSource.slice(0, MAX_SHELF_ITEMS).map(toMetrolistTrack), [shelfSource]);
  const shelfLoading = activeTrack ? isLoadingRecommendations && recommendations.length === 0 : popular.loading;

  const artists = React.useMemo(() => {
    const byName = new Map<string, ArtistItem>();
    for (const track of [...recentTracks, ...likedTracks]) {
      const name = primaryArtist(track.artist);
      if (name && !byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), { name, coverUrl: track.coverUrl });
      if (byName.size >= MAX_ARTISTS) break;
    }
    for (const name of FEATURED_ARTISTS) {
      if (byName.size >= MAX_ARTISTS) break;
      if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), { name, coverUrl: '' });
    }
    return [...byName.values()];
  }, [recentTracks, likedTracks]);

  return (
    <div className="space-y-8 short:space-y-6">
      <h1 className="text-[28px] short:text-2xl lg:text-4xl font-extrabold tracking-tight text-white">{greeting}</h1>

      {recentTracks.length > 0 && (
        <Shelf title="Recently played">
          <SongCards tracks={recentTracks.slice(0, MAX_SHELF_ITEMS)} onPlay={playRecent} {...status} />
        </Shelf>
      )}

      <Shelf
        title={activeTrack ? activeTrack.title : 'Popular right now'}
        eyebrow={activeTrack ? 'Because you listened to' : undefined}
        busy={shelfLoading}
      >
        {shelfLoading || shelfTracks.length === 0 ? (
          <SkeletonCards />
        ) : (
          <SongCards tracks={shelfTracks} onPlay={activeTrack ? playRecommendation : playPopular} {...status} />
        )}
      </Shelf>

      <Shelf title="Artists">
        {artists.map((artist) => (
          <ArtistCard key={artist.name} artist={artist} />
        ))}
      </Shelf>
    </div>
  );
});
