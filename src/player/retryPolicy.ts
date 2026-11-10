/**
 * Pure network back-off policy for the player. The timers themselves live in the UI layer; this
 * module only decides how long to wait and whether another retry is allowed.
 */

export const BASE_RETRY_DELAY_MS = 3000;
export const MAX_RETRY_DELAY_MS = 30000;
/** Retries attempted after the network dropped before playback is stopped. */
export const MAX_NETWORK_RETRIES = 5;

/** 3000 · 2^attempt, capped at 30 s. Invalid / negative attempts count as attempt 0. */
export function computeRetryDelayMs(attempt: number): number {
  if (Number.isNaN(attempt) || attempt <= 0) return BASE_RETRY_DELAY_MS;
  const exponent = Math.min(Math.floor(attempt), 16);
  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** exponent);
}

/** True while `retriesSoFar` has not used up the retry budget. */
export function canRetryNetwork(retriesSoFar: number): boolean {
  return retriesSoFar < MAX_NETWORK_RETRIES;
}
