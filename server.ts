/**
 * CLI entry of the Metrolist server (`npm run dev`, `npm start`, Docker, the portable zip).
 *
 * The server itself lives in `src/server/createServer.ts` (shared with the desktop app). This file only
 * reads the environment:
 * - `NODE_ENV=production` serves the built `dist/`; otherwise Vite's dev middlewares serve the source
 *   (Vite is imported dynamically, so production never loads it). The bundled
 *   `dist-server/server.mjs` is always production.
 * - `PORT` (default 3000) and `RATE_LIMIT_PER_MINUTE` (default 240).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMetrolistServer, type FrontendMiddleware } from './src/server/createServer.ts';
import { readPort, readRateLimitPerMinute, resolveDistPath } from './src/server/serverConfig.ts';

/** Set to `true` by esbuild for `dist-server/server.mjs` (`npm run build:server`). */
declare const __METROLIST_BUNDLED_SERVER__: boolean | undefined;
const isBundled = typeof __METROLIST_BUNDLED_SERVER__ !== 'undefined' && __METROLIST_BUNDLED_SERVER__;

const entryDir = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const isProduction = isBundled || process.env.NODE_ENV === 'production';
  let frontend: FrontendMiddleware | undefined;
  let distPath: string | undefined;
  if (isProduction) {
    distPath = resolveDistPath(entryDir, (file) => fs.existsSync(file));
  } else {
    const { createDevFrontend } = await import('./src/server/devFrontend.ts');
    frontend = (await createDevFrontend(entryDir)).middleware;
  }

  const running = await startMetrolistServer({
    mode: 'web',
    port: readPort(process.env.PORT),
    distPath,
    frontend,
    rateLimitPerMinute: readRateLimitPerMinute(process.env.RATE_LIMIT_PER_MINUTE),
  });
  console.log(`Metrolist server running on ${running.url}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
