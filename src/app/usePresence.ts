import React from 'react';

/** How long each kind of element needs to animate out (keep in sync with the exit rules in `index.css`). */
export const EXIT_MS = {
  /** Sheets and Now Playing (`--dur-exit` + a frame of slack). */
  sheet: 260,
  /** Menus (`--dur-fast`). */
  pop: 140,
  /** Toasts and banners (`--dur-fast`). */
  toast: 140,
} as const;

export type PresenceState = 'open' | 'closed';

/**
 * What to render for the real `open` flag: the element is drawn while it is open, and while it is
 * still animating out (`mounted`), except that reduced motion removes it at once.
 */
export function presenceView(open: boolean, mounted: boolean, reducedMotion: boolean): { render: boolean; state: PresenceState } {
  return { render: open || (mounted && !reducedMotion), state: open ? 'open' : 'closed' };
}

/** How long to wait before unmounting after `open` turned false (0 = now). */
export function exitDelayMs(reducedMotion: boolean, exitMs: number): number {
  return reducedMotion ? 0 : Math.max(0, exitMs);
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Keeps an element drawn while it animates out. `render` says whether to draw it, `state` goes into
 * `data-state` (the CSS animates on it). Logic never waits for this: callers keep using `open`.
 *
 * No state changes while opening, and none at all with reduced motion: "was open" is a ref set
 * during render, and the only re-render the hook asks for is the one that removes the element
 * when the exit animation is over. (A state copy of `open`, updated in an effect, re-rendered the
 * owner once more after every change; the render probes of the browser suite count that.)
 */
export function usePresence(open: boolean, exitMs: number): { render: boolean; state: PresenceState } {
  const [, removeNow] = React.useReducer((n: number) => n + 1, 0);
  const mountedRef = React.useRef(open);
  if (open) mountedRef.current = true;
  const reduced = prefersReducedMotion();
  React.useEffect(() => {
    if (open || !mountedRef.current) return;
    const delay = exitDelayMs(prefersReducedMotion(), exitMs);
    if (delay === 0) {
      // Reduced motion: `presenceView` already stopped drawing it
      mountedRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      mountedRef.current = false;
      removeNow();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);
  return presenceView(open, mountedRef.current, reduced);
}
