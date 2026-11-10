import React from 'react';

interface ArtworkProps {
  src: string;
  className?: string;
  /** Lazy by default; the large Now Playing artwork loads at once. */
  eager?: boolean;
}

/** Cover art (decorative: the title next to it names the song). Cross-origin, so never read back. */
export const Artwork = React.memo(function Artwork({ src, className = '', eager = false }: ArtworkProps) {
  return (
    <img
      src={src}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      className={`object-cover bg-zinc-800 select-none ${className}`}
    />
  );
});
