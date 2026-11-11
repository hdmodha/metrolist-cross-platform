import React from 'react';
import { artworkUrlForSize, type ArtworkSize } from '../utils/artworkUrl';

interface ArtworkProps {
  src: string;
  className?: string;
  /** Lazy by default; the large Now Playing artwork loads at once. */
  eager?: boolean;
  /** `small` (default) asks for a thumbnail for boxes up to ~120 px; `large` keeps the original image. */
  size?: ArtworkSize;
}

/** Cover art (decorative: the title next to it names the song). Cross-origin, so never read back. */
export const Artwork = React.memo(function Artwork({ src, className = '', eager = false, size = 'small' }: ArtworkProps) {
  const wanted = artworkUrlForSize(src, size);
  // Keyed by the wanted URL: if the right-sized variant fails once, show the original (no loop: it is not retried).
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  const shown = failedUrl === wanted ? src : wanted;
  return (
    <img
      src={shown}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={wanted !== src && shown === wanted ? () => setFailedUrl(wanted) : undefined}
      className={`object-cover bg-zinc-800 select-none ${className}`}
    />
  );
});
