/**
 * Browser glue for the tab / scroll memory (rules in `tabMemory.ts`). Everything lives in this
 * module, outside React state and the player store, so nothing here ever causes a render; scroll
 * events only write a number into a Map.
 *
 * - Scroll offsets are recorded per location from `scroll` events (the page, and shelves marked
 *   `data-scroll-memory="<id>"`), and saved again right before the app navigates.
 * - On every location change `useNavigationMemory` applies the plan: top, keep, or restore. A
 *   restore retries every frame until the content is long enough (results can arrive after the
 *   page mounts) or `RESTORE_TIMEOUT_MS` passes, and stops at once when the user scrolls, touches,
 *   clicks or types.
 * - A session copy (tab memory + offsets) is kept in `sessionStorage`, so a reload on web and
 *   desktop comes back to the same places. It is written on navigation and when the page is
 *   hidden; every access is guarded (private modes, disabled storage).
 */
import React from 'react';
import { currentHash, navigationIntentFor, parseRoute, type Route } from './router';
import {
  forgetsSaved,
  INITIAL_TAB_MEMORY,
  isScrollerId,
  locationKey,
  NAVIGATION_STORAGE_KEY,
  parseNavigationMemory,
  planScroll,
  rememberRoute,
  restoreStep,
  RESTORE_TIMEOUT_MS,
  ScrollMemory,
  serializeNavigationMemory,
  type ScrollSnapshot,
  type TabMemory,
} from './tabMemory';

let tabs: TabMemory = INITIAL_TAB_MEMORY;
const positions = new ScrollMemory();
let loaded = false;
/** The location the offsets are recorded for. */
let currentKey: string | null = null;
let booted = false;

interface PendingRestore {
  y: number | null;
  x: Map<string, number>;
  startedAt: number;
  frame: number;
}
let pending: PendingRestore | null = null;

let searchInput: HTMLInputElement | null = null;

function loadOnce(): void {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const saved = parseNavigationMemory(window.sessionStorage.getItem(NAVIGATION_STORAGE_KEY));
    if (saved) {
      tabs = saved.tabs;
      positions.load(saved.scroll);
    }
  } catch {
    // Storage unavailable: memory only
  }
}

function persist(): void {
  try {
    window.sessionStorage.setItem(NAVIGATION_STORAGE_KEY, serializeNavigationMemory(tabs, positions.list()));
  } catch {
    // Quota / disabled storage: memory only
  }
}

/** The last location of every tab (read when a tab is pressed or its link rendered). */
export function getTabMemory(): TabMemory {
  loadOnce();
  return tabs;
}

/* ---------------------------------------- recording ----------------------------------------- */

function scrollerSelector(id: string): string {
  return `[data-scroll-memory="${id}"]`;
}

/** Records the page offset of the current location now (before the app navigates away). */
export function saveScrollPosition(): void {
  if (currentKey === null || typeof window === 'undefined') return;
  if (!pending || pending.y === null) positions.setY(currentKey, window.scrollY);
  for (const el of document.querySelectorAll<HTMLElement>('[data-scroll-memory]')) {
    const id = el.dataset.scrollMemory ?? '';
    if (pending?.x.has(id)) continue;
    positions.setX(currentKey, id, el.scrollLeft);
  }
}

function onScroll(event: Event): void {
  if (currentKey === null) return;
  const target = event.target;
  if (target === document || target === document.documentElement || target === window) {
    if (pending && pending.y !== null) return; // our own restore, or the clamp while content loads
    positions.setY(currentKey, window.scrollY);
    return;
  }
  if (target instanceof HTMLElement) {
    const id = target.dataset.scrollMemory;
    if (!id || !isScrollerId(id) || pending?.x.has(id)) return;
    positions.setX(currentKey, id, target.scrollLeft);
  }
}

/* ----------------------------------------- restoring ----------------------------------------- */

function cancelRestore(): void {
  if (!pending) return;
  cancelAnimationFrame(pending.frame);
  pending = null;
}

function restoreTick(): void {
  const p = pending;
  if (!p) return;
  const elapsed = performance.now() - p.startedAt;
  if (p.y !== null) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const step = restoreStep(p.y, max, elapsed);
    if (Math.abs(window.scrollY - step.scrollTo) >= 1) window.scrollTo(0, step.scrollTo);
    if (step.done) p.y = null;
  }
  for (const [id, x] of p.x) {
    const el = document.querySelector<HTMLElement>(scrollerSelector(id));
    if (!el) {
      if (elapsed >= RESTORE_TIMEOUT_MS) p.x.delete(id);
      continue;
    }
    const step = restoreStep(x, el.scrollWidth - el.clientWidth, elapsed);
    if (Math.abs(el.scrollLeft - step.scrollTo) >= 1) el.scrollLeft = step.scrollTo;
    if (step.done) p.x.delete(id);
  }
  if (p.y === null && p.x.size === 0) {
    pending = null;
    return;
  }
  p.frame = requestAnimationFrame(restoreTick);
}

function startRestore(snapshot: ScrollSnapshot): void {
  const shelves = new Map(Object.entries(snapshot.x).filter(([, x]) => x > 0));
  pending = { y: snapshot.y > 0 ? snapshot.y : null, x: shelves, startedAt: performance.now(), frame: 0 };
  if (snapshot.y <= 0) window.scrollTo(0, 0);
  // First attempt before paint: content already in memory (cached results, the library) needs no wait
  restoreTick();
}

/** The listener takes over: a pending restore never fights a scroll, touch, click or key press. */
function onUserInput(): void {
  cancelRestore();
}

function prefersReducedMotion(): boolean {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Scrolls the page to the top (re-tapping the current tab, a link to the page already shown). */
export function scrollPageToTop(): void {
  cancelRestore();
  window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

/* ------------------------------------------ search box ---------------------------------------- */

/** The Search page registers its box here, so re-tapping the Search tab can focus it at once. */
export function registerSearchInput(input: HTMLInputElement | null): void {
  searchInput = input;
}

/** Focuses the search box synchronously (inside the tap, so iOS / Android show the keyboard). */
export function focusSearchInput(): void {
  searchInput?.focus({ preventScroll: true });
}

/* -------------------------------------------- hook ------------------------------------------- */

function install(): () => void {
  loadOnce();
  try {
    // The app restores scroll itself; the browser's own restore would fight it on Back / reload
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  } catch {
    // Not settable: harmless
  }
  const passiveCapture = { capture: true, passive: true } as const;
  const onPopState = () => saveScrollPosition();
  const onHide = () => {
    saveScrollPosition();
    persist();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onHide();
  };
  const inputs = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
  window.addEventListener('scroll', onScroll, passiveCapture);
  for (const type of inputs) window.addEventListener(type, onUserInput, passiveCapture);
  // Back / Forward: record the offset while the old page is still shown (the new one renders in a microtask)
  window.addEventListener('popstate', onPopState, true);
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('scroll', onScroll, passiveCapture);
    for (const type of inputs) window.removeEventListener(type, onUserInput, passiveCapture);
    window.removeEventListener('popstate', onPopState, true);
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVisibility);
    cancelRestore();
  };
}

function arrive(route: Route): void {
  const key = locationKey(route);
  const intent = booted ? navigationIntentFor(currentHash()) : 'boot';
  booted = true;
  tabs = rememberRoute(tabs, route);
  cancelRestore();
  if (forgetsSaved(intent)) positions.forget(key);
  currentKey = key;
  const plan = planScroll(intent, positions.get(key));
  if (plan.kind === 'top') window.scrollTo(0, 0);
  else if (plan.kind === 'restore') startRestore(plan.snapshot);
  persist();
}

/**
 * Remembers each tab's location and each location's scroll offsets, and applies the scroll plan
 * whenever the location changes (in a layout effect: before paint, after the new page's DOM).
 * Used once, by the app shell.
 */
export function useNavigationMemory(route: Route): void {
  React.useLayoutEffect(install, []);
  const key = locationKey(route);
  const routeRef = React.useRef(route);
  routeRef.current = route;
  React.useLayoutEffect(() => {
    arrive(routeRef.current);
  }, [key]);
}

/** The route currently in the address bar (for handlers that run outside render). */
export function currentRoute(): Route {
  return parseRoute(currentHash());
}
