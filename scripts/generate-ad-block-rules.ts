/**
 * Writes the plain-data files the native plugins need (`npm run adblock:rules`, alias
 * `npm run native:artifacts`), for platforms that cannot import TypeScript: the ad / tracking
 * blocklist (`src/shared/adBlockRules.json`, the Android plugin's asset), its shared test vectors
 * (Android JUnit), the iOS WebKit content-blocker list, and the vectors of the "system paused us"
 * guard (Android JUnit, iOS runner). See `src/shared/nativeArtifacts.ts`;
 * `src/shared/nativeArtifacts.test.ts` fails while any of them is stale.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeGeneratedFiles, serializeGenerated } from '../src/shared/nativeArtifacts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const file of nativeGeneratedFiles()) {
  const target = path.join(root, file.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serializeGenerated(file.data));
  console.log(`Wrote ${file.path}`);
}
