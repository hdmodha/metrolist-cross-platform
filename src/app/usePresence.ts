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
 * Keeps an element mounted while it animates out. `open` stays the one source of truth for logic
 * (history, focus, `inert`): only the visual unmount waits. Use `state` as `data-state`.
 */
export function usePresence(open: boolean, exitMs: number): { render: boolean; state: PresenceState } {
  const [mounted, setMounted] = React.useState(open);
  const reduced = prefersReducedMotion();
  React.useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const delay = exitDelayMs(prefersReducedMotion(), exitMs);
    if (delay === 0) {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), delay);
    return () => window.clearTimeout(timer);
  }, [open, exitMs]);
  return presenceView(open, mounted, reduced);
}
