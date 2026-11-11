/**
 * The desktop app's page origin, and the one-time move of saved data from the old one. Pure.
 *
 * The window loads `http://localhost:<port>/`, not `http://127.0.0.1:<port>/`: YouTube's embedded
 * player refuses some videos (error 150, "the owner does not allow playback in other apps") when the
 * embedding page's host is an IP address, and plays the same videos for `localhost` (measured with the
 * official IFrame API: `127.0.0.1` with or without a port, http or https, fails; `localhost` and
 * `https://localhost`, the Android app's origin, play). The server still listens on 127.0.0.1 only.
 *
 * localStorage (liked songs, downloads, recently played, the queue) is per origin, so the data saved
 * under `http://127.0.0.1:<port>` by earlier versions is copied once into the new origin
 * (`electron/storageMigration.ts`): only `metrolist.*` keys with string values, only into keys the
 * new origin does not have yet, within size limits.
 */

/** The host name the window uses (resolved by Chromium to the loopback address). */
export const APP_HOST = 'localhost';
/** The host earlier versions (≤ 1.1.0) loaded, where their saved data stays. */
export const LEGACY_HOST = '127.0.0.1';
/** Only the app's own keys are copied. */
export const STORAGE_KEY_PREFIX = 'metrolist.';
export const MAX_LEGACY_KEYS = 64;
/** Total characters of keys + values (localStorage holds about 5 M characters per origin). */
export const MAX_LEGACY_CHARS = 5_000_000;

export function appUrl(port: number): string {
  return `http://${APP_HOST}:${port}/`;
}

export function legacyUrl(port: number): string {
  return `http://${LEGACY_HOST}:${port}/`;
}

/**
 * The saved entries to copy, from the old page's answer (a JSON object of key → value): `metrolist.*`
 * keys with string values only; nothing at all when the answer is not such an object or is too big.
 */
export function sanitizeLegacyStorage(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  let keys = 0;
  let chars = 0;
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith(STORAGE_KEY_PREFIX) || typeof value !== 'string') continue;
    keys++;
    chars += key.length + value.length;
    if (keys > MAX_LEGACY_KEYS || chars > MAX_LEGACY_CHARS) return {};
    out[key] = value;
  }
  return out;
}

/** The ports whose old data was already handled, from `userData/origin-migration.json`. */
export function parseMigratedPorts(raw: unknown): number[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const ports = (raw as { migratedPorts?: unknown }).migratedPorts;
  if (!Array.isArray(ports)) return [];
  return ports.filter((p): p is number => Number.isInteger(p) && p > 0 && p < 65536);
}

export function needsMigration(port: number, migratedPorts: readonly number[]): boolean {
  return !migratedPorts.includes(port);
}
