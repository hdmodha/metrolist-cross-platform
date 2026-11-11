/**
 * The files `npm run adblock:rules` generates from `adBlock.ts` / `adBlockVectors.ts`, for platforms
 * that cannot import TypeScript: the rules as JSON (a shared copy, and the Android plugin's asset
 * that its WebView client loads) and the test vectors for the plugin's JUnit test. A unit test fails
 * while any of them is stale.
 */
import { adBlockRulesJson } from './adBlock';
import { adBlockVectorsJson } from './adBlockVectors';

const PLUGIN_ANDROID = 'native/capacitor-background-playback/android/src';

export interface GeneratedFile {
  /** Relative to the repository root. */
  path: string;
  data: unknown;
}

export function adBlockGeneratedFiles(): GeneratedFile[] {
  const rules = adBlockRulesJson();
  return [
    { path: 'src/shared/adBlockRules.json', data: rules },
    { path: `${PLUGIN_ANDROID}/main/assets/metrolist-ad-block-rules.json`, data: rules },
    { path: `${PLUGIN_ANDROID}/test/resources/ad-block-vectors.json`, data: adBlockVectorsJson() },
  ];
}

export function serializeGenerated(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}
