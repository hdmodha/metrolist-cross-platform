/**
 * Writes the plain-data copies of the ad / tracking blocklist (`npm run adblock:rules`), for
 * platforms that cannot import the TypeScript module: `src/shared/adBlockRules.json`, the Android
 * plugin's asset (`native/capacitor-background-playback/android/src/main/assets/`) and the shared
 * test vectors for its JUnit test (`.../android/src/test/resources/`). See
 * `src/shared/adBlockArtifacts.ts`; `src/shared/adBlock.test.ts` fails while any of them is stale.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adBlockGeneratedFiles, serializeGenerated } from '../src/shared/adBlockArtifacts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const file of adBlockGeneratedFiles()) {
  const target = path.join(root, file.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serializeGenerated(file.data));
  console.log(`Wrote ${file.path}`);
}
