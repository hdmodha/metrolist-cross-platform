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
  className?: string;
}

/** A vertical list of `SongRow`s. */
export function SongList({ tracks, onPlay, label, className = '', activeTrackId, isPlaying, likedIds, downloadedIds, unplayableTracks }: SongListProps) {
  return (
    <ul aria-label={label} className={`-mx-2 ${className}`}>
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
export function SongCards({ tracks, onPlay, activeTrackId, isPlaying, likedIds, downloadedIds, unplayableTracks }: Omit<SongListProps, 'label' | 'className'>) {
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

/** Placeholders while a shelf loads: the dimensions of a `SongCard`. */
export function SkeletonCards({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} aria-hidden="true" className="skeleton w-36 sm:w-40 short:w-28 lg:w-48 xl:w-52 shrink-0 lg:p-3">
          <div className="skeleton-bar w-full aspect-square rounded-xl" />
          <div className="mt-2 h-5 flex items-center">
            <div className="skeleton-bar h-3.5 w-3/4 rounded-md" />
          </div>
          <div className="mt-0.5 h-5 flex items-center">
            <div className="skeleton-bar h-3 w-1/2 rounded-md" />
          </div>
        </li>
      ))}
    </>
  );
}

/** Placeholders while a list loads: the dimensions of a `SongRow` (so results arrive without a layout shift). */
export function SkeletonRows({ count = 8 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className="skeleton -mx-2">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex items-center gap-3 py-2 pl-2 pr-12 h-16 short:h-14">
          <div className="skeleton-bar w-12 h-12 short:w-10 short:h-10 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="skeleton-bar h-3.5 w-2/3 rounded-md" />
            <div className="skeleton-bar h-3 w-2/5 rounded-md mt-2" />
          </div>
        </li>
      ))}
    </ul>
  );
}
