/** Pure configuration helpers for the CLI server (`server.ts`). */
import path from 'node:path';

export const DEFAULT_RATE_LIMIT_PER_MINUTE = 240;
export const DEFAULT_PORT = 3000;

/**
 * Requests per IP per minute. `RATE_LIMIT_PER_MINUTE` may raise it for trusted setups (the end-to-end
 * suite loads the app hundreds of times from one address); anything that is not a positive integer
 * keeps the default.
 */
export function readRateLimitPerMinute(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_RATE_LIMIT_PER_MINUTE;
}

/** `PORT`, when it is a valid TCP port; otherwise `fallback` (3000). */
export function readPort(raw: string | undefined, fallback: number = DEFAULT_PORT): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= 65535 ? value : fallback;
}

/**
 * Where the built frontend lives. `npx tsx server.ts` runs from the repository root (`./dist`); the
 * bundled `node dist-server/server.mjs` runs one level down (`../dist`).
 */
export function resolveDistPath(entryDir: string, exists: (file: string) => boolean): string {
  const candidates = [path.join(entryDir, 'dist'), path.join(entryDir, '..', 'dist')];
  return candidates.find((dir) => exists(path.join(dir, 'index.html'))) ?? candidates[0];
}
