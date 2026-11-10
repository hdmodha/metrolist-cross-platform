/**
 * Pure playback queue rules (no React, no DOM). Generic over anything with an `id`, so they work on
 * track objects and on the player core's normalized id lists alike.
 */

export type RepeatMode = 'OFF' | 'ALL' | 'ONE';

/**
 * Decides which queue index plays next. Returns -1 when playback should stop
 * (natural end of the queue with repeat off).
 */
export function pickNextQueueIndex(options: {
  queueLength: number;
  currentIndex: number;
  direction: -1 | 1;
  shuffle: boolean;
  repeatMode: RepeatMode;
  /** true for Next / Previous button presses, false when a track finished on its own */
  userInitiated: boolean;
  random?: () => number;
}): number {
  const { queueLength, currentIndex, direction, shuffle, repeatMode, userInitiated } = options;
  if (queueLength <= 0) return -1;

  // A finished track with "repeat one" replays itself; pressing Next still moves on
  if (!userInitiated && repeatMode === 'ONE' && currentIndex >= 0) return currentIndex;

  if (queueLength === 1) {
    if (userInitiated || repeatMode !== 'OFF' || currentIndex < 0) return 0;
    return -1;
  }

  // The playing track is no longer in the queue (it was removed): start from the top
  if (currentIndex < 0 || currentIndex >= queueLength) return 0;

  if (shuffle && direction === 1) {
    const random = options.random || Math.random;
    const offset = 1 + Math.min(queueLength - 2, Math.floor(random() * (queueLength - 1)));
    return (currentIndex + offset) % queueLength;
  }

  const target = currentIndex + direction;
  if (target >= queueLength) {
    return repeatMode === 'OFF' && !userInitiated ? -1 : 0;
  }
  if (target < 0) {
    return repeatMode === 'ALL' ? queueLength - 1 : 0;
  }
  return target;
}

/**
 * "Add to queue": places the track right after the current one and after any tracks the listener
 * already queued by hand, so manual picks play in the order they were added and before radio picks.
 */
export function insertIntoQueueAfterCurrent<T extends { id: string }>(
  queue: T[],
  currentId: string,
  track: T,
  userQueuedIds: ReadonlySet<string>
): T[] {
  if (track.id === currentId) return queue;
  const without = queue.filter((t) => t.id !== track.id);
  const currentIdx = without.findIndex((t) => t.id === currentId);
  let insertAt = currentIdx + 1;
  while (insertAt < without.length && userQueuedIds.has(without[insertAt].id)) {
    insertAt++;
  }
  return [...without.slice(0, insertAt), track, ...without.slice(insertAt)];
}

/**
 * "Play this now": keeps what was already played (so Previous still works), plays `track` next,
 * keeps hand-queued tracks after it, then `followUps` (the rest of the list the track was picked
 * from). Stale automatic picks from the previous listening context are dropped.
 */
export function buildPlayNowQueue<T extends { id: string }>(
  queue: T[],
  currentId: string | null,
  track: T,
  userQueuedIds: ReadonlySet<string>,
  followUps: T[] = []
): T[] {
  const currentIdx = currentId === null ? -1 : queue.findIndex((t) => t.id === currentId);
  const played = currentIdx === -1 ? [] : queue.slice(0, currentIdx + 1);
  const upcoming = currentIdx === -1 ? queue : queue.slice(currentIdx + 1);

  const result: T[] = [];
  const seen = new Set<string>([track.id]);
  for (const item of played) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  result.push(track);
  for (const item of [...upcoming.filter((t) => userQueuedIds.has(t.id)), ...followUps]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

/**
 * Autoplay radio: tops the queue up with recommendations only when it is about to run dry,
 * so hand-queued tracks and the visible "Up Next" order are never thrown away.
 */
export function mergeRadioIntoQueue<T extends { id: string }>(
  queue: T[],
  currentId: string,
  radioTracks: T[],
  options: { minUpcoming?: number; maxAppend?: number; maxHistory?: number } = {}
): T[] {
  const minUpcoming = options.minUpcoming ?? 3;
  const maxAppend = options.maxAppend ?? 10;
  const maxHistory = options.maxHistory ?? 30;

  const currentIdx = queue.findIndex((t) => t.id === currentId);
  if (currentIdx === -1) return queue;
  const upcoming = queue.length - currentIdx - 1;
  if (upcoming >= minUpcoming) return queue;

  const seen = new Set(queue.map((t) => t.id));
  const additions: T[] = [];
  for (const candidate of radioTracks) {
    if (additions.length >= maxAppend) break;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    additions.push(candidate);
  }
  if (additions.length === 0) return queue;

  const historyStart = Math.max(0, currentIdx - maxHistory);
  return [...queue.slice(historyStart), ...additions];
}

/**
 * "Play next": places the track immediately after the current one, ahead of songs that were
 * queued earlier. A track that is already in the queue is moved instead of duplicated.
 */
export function insertIntoQueueAsNext<T extends { id: string }>(
  queue: T[],
  currentId: string,
  track: T
): T[] {
  if (track.id === currentId) return queue;
  const without = queue.filter((t) => t.id !== track.id);
  const insertAt = without.findIndex((t) => t.id === currentId) + 1;
  return [...without.slice(0, insertAt), track, ...without.slice(insertAt)];
}
