import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adBlockGeneratedFiles } from './adBlockArtifacts';
import { nativeGeneratedFiles, serializeGenerated } from './nativeArtifacts';
import { systemPauseGuardVectorsJson } from './systemPauseGuardVectors';
import { webkitContentBlockerRules } from './webkitContentBlocker';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('every generated native file is in sync (npm run adblock:rules)', () => {
  const files = nativeGeneratedFiles();
  assert.deepEqual(
    files.map((f) => f.path),
    [
      ...adBlockGeneratedFiles().map((f) => f.path),
      'native/capacitor-background-playback/ios/Resources/metrolist-content-blocker.json',
      'native/capacitor-background-playback/android/src/test/resources/system-pause-guard-vectors.json',
    ]
  );
  assert.deepEqual(files.at(-2)?.data, webkitContentBlockerRules());
  assert.deepEqual(files.at(-1)?.data, systemPauseGuardVectorsJson());
  for (const file of files) {
    const onDisk = fs.readFileSync(path.join(root, file.path), 'utf8');
    assert.equal(onDisk, serializeGenerated(file.data), `${file.path} is stale: run \`npm run adblock:rules\``);
  }
});

test('the iOS podspec ships the content-blocker list and the page-visibility script', () => {
  const podspec = fs.readFileSync(path.join(root, 'native/capacitor-background-playback/MetrolistCapacitorBackgroundPlayback.podspec'), 'utf8');
  assert.match(podspec, /ios\/Resources\/metrolist-content-blocker\.json/);
  assert.match(podspec, /android\/src\/main\/assets\/metrolist-page-visibility\.js/);
});
