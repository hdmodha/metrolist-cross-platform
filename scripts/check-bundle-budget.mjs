/**
 * Size budget for the production web bundle (`npm run build` first): `node scripts/check-bundle-budget.mjs`.
 * Fails (exit 1) when the gzipped JS / CSS or the raw fonts in `dist/assets` exceed their budget, or when
 * `dist/index.html` references Google Fonts (fonts are bundled with the app).
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const KB = 1024;
export const BUDGET = { jsGzip: 150 * KB, cssGzip: 20 * KB, fontBytes: 220 * KB };
const GOOGLE_FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const kb = (bytes) => `${(bytes / KB).toFixed(1)} KB`;

/** Pure: `files` = [{ name, raw, gzip }]. Returns the totals and a list of failure messages. */
export function evaluateBudget(files, indexHtml) {
  const sum = (ext, key) => files.filter((f) => f.name.endsWith(ext)).reduce((total, f) => total + f[key], 0);
  const totals = { jsGzip: sum('.js', 'gzip'), cssGzip: sum('.css', 'gzip'), fontBytes: sum('.woff2', 'raw') };
  const failures = [];
  if (totals.jsGzip > BUDGET.jsGzip) failures.push(`JS gzip total ${kb(totals.jsGzip)} exceeds the budget of ${kb(BUDGET.jsGzip)}`);
  if (totals.cssGzip > BUDGET.cssGzip) failures.push(`CSS gzip total ${kb(totals.cssGzip)} exceeds the budget of ${kb(BUDGET.cssGzip)}`);
  if (totals.fontBytes > BUDGET.fontBytes) failures.push(`Font total ${kb(totals.fontBytes)} exceeds the budget of ${kb(BUDGET.fontBytes)}`);
  for (const host of GOOGLE_FONT_HOSTS) {
    if (indexHtml.includes(host)) failures.push(`dist/index.html references ${host}: fonts must be bundled`);
  }
  return { totals, failures };
}

function main() {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
  const assetsDir = path.join(dist, 'assets');
  let names;
  try {
    names = readdirSync(assetsDir);
  } catch {
    console.error(`No ${assetsDir}: run "npm run build" first.`);
    process.exit(1);
  }
  const files = names.map((name) => {
    const data = readFileSync(path.join(assetsDir, name));
    return { name, raw: data.length, gzip: gzipSync(data).length };
  });
  const { totals, failures } = evaluateBudget(files, readFileSync(path.join(dist, 'index.html'), 'utf8'));
  console.log('Bundle budget');
  console.log(`  JS    gzip ${kb(totals.jsGzip).padStart(10)} / ${kb(BUDGET.jsGzip)}`);
  console.log(`  CSS   gzip ${kb(totals.cssGzip).padStart(10)} / ${kb(BUDGET.cssGzip)}`);
  console.log(`  Fonts raw  ${kb(totals.fontBytes).padStart(10)} / ${kb(BUDGET.fontBytes)}`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
