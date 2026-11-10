/**
 * Render counter for browser tests. Production code calls `countRender(name)` while rendering; it
 * does nothing unless a test has installed `window.__renderProbe = {}` before the app loaded. The
 * browser suite uses it to prove that nothing above the seek bar re-renders on playback ticks.
 */
export function countRender(name: string): void {
  if (typeof window === 'undefined') return;
  const probe = (window as unknown as { __renderProbe?: Record<string, number> }).__renderProbe;
  if (probe) probe[name] = (probe[name] ?? 0) + 1;
}
