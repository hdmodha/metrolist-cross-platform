/**
 * Bundles the Node side of Metrolist with esbuild (cross-platform; used by npm scripts):
 *   node scripts/build-node.mjs server    → dist-server/server.mjs   (the CLI server, `npm start`)
 *   node scripts/build-node.mjs electron  → dist-electron/main.cjs   (the desktop app's main process)
 * Everything (Express, the rate limiter, the InnerTube layer) is bundled, so neither output needs
 * `node_modules` at runtime. Vite stays external: only the dev paths import it, dynamically.
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';

const targets = {
  server: {
    entryPoints: ['server.ts'],
    outfile: 'dist-server/server.mjs',
    format: 'esm',
    target: 'node20.19',
    external: ['vite'],
    define: { __METROLIST_BUNDLED_SERVER__: 'true' },
    // Express is CommonJS and `require`s Node built-ins; give the ESM bundle a real `require`
    banner: { js: "import { createRequire as __metrolistCreateRequire } from 'node:module';\nconst require = __metrolistCreateRequire(import.meta.url);" },
  },
  electron: {
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.cjs',
    format: 'cjs',
    target: 'node22',
    external: ['electron', 'vite'],
  },
};

const names = process.argv.slice(2);
if (names.length === 0 || names.some((name) => !(name in targets))) {
  console.error(`Usage: node scripts/build-node.mjs <${Object.keys(targets).join('|')}>...`);
  process.exit(1);
}

for (const name of names) {
  const options = targets[name];
  rmSync(options.outfile.split('/')[0], { recursive: true, force: true });
  await build({
    bundle: true,
    platform: 'node',
    sourcemap: false,
    minify: false,
    legalComments: 'inline',
    logLevel: 'warning',
    ...options,
  });
  console.log(`Built ${options.outfile}`);
}
