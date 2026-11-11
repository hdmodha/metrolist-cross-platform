/**
 * Writes src/shared/adBlockRules.json from src/shared/adBlock.ts (`npm run adblock:rules`), the
 * plain-data copy of the ad / tracking blocklist for platforms that cannot import the TypeScript
 * module (the Android app). `src/shared/adBlock.test.ts` fails while the file is stale.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adBlockRulesJson } from '../src/shared/adBlock';

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/shared/adBlockRules.json');
fs.writeFileSync(target, `${JSON.stringify(adBlockRulesJson(), null, 2)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), target)}`);
