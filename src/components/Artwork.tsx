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

/** Fades the image in over the placeholder (CSS `[data-loaded]`); no React state, so no extra render. */
function markLoaded(e: React.SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.setAttribute('data-loaded', '');
}
/** A cached image is complete before the first paint: show it at once, so it never flashes. */
function markIfLoaded(img: HTMLImageElement | null) {
  if (img && img.complete && img.naturalWidth > 0) img.setAttribute('data-loaded', '');
}

/** Cover art (decorative: the title next to it names the song). Cross-origin, so never read back. */
export const Artwork = React.memo(function Artwork({ src, className = '', eager = false, size = 'small' }: ArtworkProps) {
  const wanted = artworkUrlForSize(src, size);
  // Keyed by the wanted URL: if the right-sized variant fails once, show the original (no loop: it is not retried).
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  const shown = failedUrl === wanted ? src : wanted;
  return (
    <span className={`art select-none ${className}`}>
      <img
        ref={markIfLoaded}
        src={shown}
        alt=""
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onLoad={markLoaded}
        onError={wanted !== src && shown === wanted ? () => setFailedUrl(wanted) : undefined}
      />
    </span>
  );
});
