/** Small animated "now playing" bars (static while paused or with reduced motion). */
export function PlayingBars({ playing, className = '' }: { playing: boolean; className?: string }) {
  return (
    <span aria-hidden="true" className={`playing-bars ${playing ? '' : 'is-paused'} ${className}`}>
      <span />
      <span />
      <span />
    </span>
  );
}
