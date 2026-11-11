import React from 'react';
import type { MetrolistTrack } from '../data/track';
import type { UnplayableReason } from '../player/streamErrors';
import { SongCard } from './SongCard';
import { SongRow } from './SongRow';

/** What every song list needs to know to highlight and label its songs. */
export interface ListStatus {
  activeTrackId: string | null;
  isPlaying: boolean;
  likedIds: ReadonlySet<string>;
  downloadedIds: ReadonlySet<string>;
  /** Songs the player found it cannot play (shown as unavailable). */
  unplayableTracks: Readonly<Record<string, UnplayableReason>>;
}

interface SongListProps extends ListStatus {
  tracks: MetrolistTrack[];
  onPlay: (track: MetrolistTrack) => void;
  label?: string;
}

/** A vertical list of `SongRow`s. */
export function SongList({ tracks, onPlay, label, activeTrackId, isPlaying, likedIds, downloadedIds, unplayableTracks }: SongListProps) {
  return (
    <ul aria-label={label} className="-mx-2">
      {tracks.map((track) => {
        const isCurrent = track.id === activeTrackId;
        return (
          <SongRow
            key={track.id}
            track={track}
            isCurrent={isCurrent}
            isPlaying={isCurrent && isPlaying}
            liked={likedIds.has(track.id)}
            downloaded={downloadedIds.has(track.id)}
            unavailableReason={unplayableTracks[track.id]}
            onPlay={onPlay}
          />
        );
      })}
    </ul>
  );
}

/** The `SongCard`s of a shelf (render inside `<Shelf>`). */
export function SongCards({ tracks, onPlay, activeTrackId, isPlaying, likedIds, downloadedIds, unplayableTracks }: Omit<SongListProps, 'label'>) {
  return (
    <>
      {tracks.map((track) => {
        const isCurrent = track.id === activeTrackId;
        return (
          <SongCard
            key={track.id}
            track={track}
            isCurrent={isCurrent}
            isPlaying={isCurrent && isPlaying}
            liked={likedIds.has(track.id)}
            downloaded={downloadedIds.has(track.id)}
            unavailableReason={unplayableTracks[track.id]}
            onPlay={onPlay}
          />
        );
      })}
    </>
  );
}

/** Grey placeholders while a shelf loads. */
export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} aria-hidden="true" className="w-36 sm:w-40 short:w-28 lg:w-48 xl:w-52 shrink-0 lg:p-3">
          <div className="w-full aspect-square rounded-md bg-white/[0.06] animate-pulse" />
          <div className="mt-2 h-3.5 w-3/4 rounded bg-white/[0.06]" />
          <div className="mt-1.5 h-3 w-1/2 rounded bg-white/[0.04]" />
        </li>
      ))}
    </>
  );
}
