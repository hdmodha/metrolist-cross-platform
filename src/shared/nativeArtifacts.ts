/**
 * Every file `npm run adblock:rules` (alias `npm run native:artifacts`) generates for the native
 * plugins, which cannot import TypeScript: the ad-block rules and vectors (`adBlockArtifacts.ts`),
 * the iOS content-blocker list (`webkitContentBlocker.ts`) and the vectors of the "system paused us"
 * guard (`systemPauseGuardVectors.ts`). `nativeArtifacts.test.ts` fails while any of them is stale.
 */
import { adBlockGeneratedFiles, serializeGenerated, type GeneratedFile } from './adBlockArtifacts';
import { systemPauseGuardVectorsJson } from './systemPauseGuardVectors';
import { webkitContentBlockerRules } from './webkitContentBlocker';

export const PLUGIN_DIR = 'native/capacitor-background-playback';

export function nativeGeneratedFiles(): GeneratedFile[] {
  return [
    ...adBlockGeneratedFiles(),
    { path: `${PLUGIN_DIR}/ios/Resources/metrolist-content-blocker.json`, data: webkitContentBlockerRules() },
    { path: `${PLUGIN_DIR}/android/src/test/resources/system-pause-guard-vectors.json`, data: systemPauseGuardVectorsJson() },
  ];
}

export { serializeGenerated };
