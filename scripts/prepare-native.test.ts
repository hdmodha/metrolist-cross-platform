import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PREPARED_MARKER,
  addBackgroundAudioMode,
  capacitorDefaultMainActivity,
  checkAndroidManifest,
  classifyMainActivity,
  mainActivityPath,
  normalizeSource,
  planMainActivity,
  renderMainActivity,
} from './prepare-native.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const template = fs.readFileSync(path.join(root, 'native/android-app/MainActivity.java'), 'utf8');
const APP_ID = 'com.metrolist.music';

/** Capacitor 6's ios-pods-template Info.plist (trimmed to its shape). */
const IOS_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>Metrolist</string>
\t<key>UIViewControllerBasedStatusBarAppearance</key>
\t<true/>
</dict>
</plist>
`;

describe('Android MainActivity', () => {
  test('Back goes one step back in the page, and at the first entry sends the app to the background', () => {
    // Capacitor's core has no Back handling: without this every Back press finished the activity (music stopped)
    assert.ok(template.includes('getOnBackPressedDispatcher()'));
    assert.ok(template.includes('new OnBackPressedCallback(true)'));
    const handler = template.slice(template.indexOf('handleOnBackPressed'));
    assert.ok(handler.indexOf('webView.canGoBack()') < handler.indexOf('webView.goBack()'));
    assert.ok(handler.indexOf('webView.goBack()') < handler.indexOf('moveTaskToBack(true)'));
    assert.ok(!template.includes('finish()'));
  });

  test('the template is ours: Capacitor\'s BridgeActivity with the plugin\'s layout swap', () => {
    assert.ok(template.startsWith('package com.metrolist.music;'));
    assert.match(template, /public class MainActivity extends BridgeActivity/);
    assert.match(template, /public void setContentView\(int layoutResID\)/);
    assert.ok(template.includes('com.getcapacitor.android.R.layout.bridge_layout_main'));
    assert.ok(template.includes(PREPARED_MARKER));
    // Falls back to Capacitor's layout rather than to "no WebView"
    assert.match(template, /catch \(RuntimeException e\)/);
  });

  test('the generated default is replaced, ours is left alone, anything else stops the script', () => {
    const generated = capacitorDefaultMainActivity(APP_ID);
    assert.equal(classifyMainActivity(generated, template, APP_ID), 'default');
    assert.equal(classifyMainActivity(generated.replace(/\n/g, '\r\n') + '  \n', template, APP_ID), 'default');
    const installed = planMainActivity(generated, template, APP_ID);
    assert.equal(installed, template);
    assert.equal(classifyMainActivity(installed!, template, APP_ID), 'prepared');
    assert.equal(planMainActivity(installed!, template, APP_ID), null, 'idempotent');

    const edited = generated.replace('{}', '{\n    // custom\n}');
    assert.equal(classifyMainActivity(edited, template, APP_ID), 'unexpected');
    assert.throws(() => planMainActivity(edited, template, APP_ID), /neither Capacitor's default MainActivity nor Metrolist's/);
    // A future Capacitor template (e.g. a Kotlin-style or annotated activity) is not overwritten
    assert.throws(() => planMainActivity(`package ${APP_ID};\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {\n  @Override public void onCreate(android.os.Bundle b) { super.onCreate(b); }\n}\n`, template, APP_ID));
    assert.throws(() => planMainActivity('', template, APP_ID));
  });

  test('another app id gets its own package and path', () => {
    assert.equal(mainActivityPath('org.example.app'), 'android/app/src/main/java/org/example/app/MainActivity.java');
    assert.ok(renderMainActivity(template, 'org.example.app').startsWith('package org.example.app;'));
    assert.equal(planMainActivity(capacitorDefaultMainActivity('org.example.app'), template, 'org.example.app'), renderMainActivity(template, 'org.example.app'));
    assert.throws(() => mainActivityPath('not an id'), /not a Java package name/);
    assert.throws(() => renderMainActivity('package other;', APP_ID), /must start with/);
  });

  test('the manifest must launch .MainActivity', () => {
    assert.doesNotThrow(() => checkAndroidManifest('<activity android:name=".MainActivity" android:exported="true">'));
    assert.throws(() => checkAndroidManifest('<activity android:name="com.other.Activity">'), /MainActivity/);
  });

  test('normalizeSource ignores line endings and trailing spaces only', () => {
    assert.equal(normalizeSource('a  \r\nb\r\n\n'), 'a\nb');
    assert.notEqual(normalizeSource('a b'), normalizeSource('ab'));
  });
});

describe('iOS Info.plist', () => {
  test('adds UIBackgroundModes audio before the root dict closes, once', () => {
    const prepared = addBackgroundAudioMode(IOS_PLIST);
    assert.notEqual(prepared, IOS_PLIST);
    assert.ok(prepared.includes('\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>audio</string>\n\t</array>\n</dict>\n</plist>'));
    assert.equal(addBackgroundAudioMode(prepared), prepared, 'idempotent');
    assert.equal(prepared.match(/UIBackgroundModes/g)?.length, 1);
  });

  test('adds audio to an existing UIBackgroundModes array, keeps other modes', () => {
    const withFetch = IOS_PLIST.replace('</dict>', '\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>fetch</string>\n\t</array>\n</dict>');
    const prepared = addBackgroundAudioMode(withFetch);
    assert.ok(prepared.includes('<array>\n\t\t<string>fetch</string>\n\t\t<string>audio</string>\n\t</array>'));
    assert.equal(addBackgroundAudioMode(prepared), prepared);
    const empty = IOS_PLIST.replace('</dict>', '\t<key>UIBackgroundModes</key>\n\t<array/>\n</dict>');
    assert.ok(addBackgroundAudioMode(empty).includes('<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>audio</string>\n\t</array>'));
  });

  test('refuses a plist it does not understand', () => {
    assert.throws(() => addBackgroundAudioMode('<plist></plist>'), /root <dict>/);
    assert.throws(() => addBackgroundAudioMode(IOS_PLIST.replace('</dict>', '<key>UIBackgroundModes</key><string>audio</string></dict>')), /not an array/);
  });
});

describe('the CLI', () => {
  function project(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'metrolist-native-'));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.copyFileSync(path.join(root, 'scripts/prepare-native.mjs'), path.join(dir, 'scripts/prepare-native.mjs'));
    fs.mkdirSync(path.join(dir, 'native/android-app'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'native/android-app/MainActivity.java'), template);
    fs.writeFileSync(path.join(dir, 'capacitor.config.json'), JSON.stringify({ appId: APP_ID }));
    return dir;
  }
  const cli = (dir: string, ...args: string[]) =>
    execFileSync(process.execPath, [path.join(dir, 'scripts/prepare-native.mjs'), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  test('prepares both projects, is idempotent, and --check fails before / passes after', () => {
    const dir = project();
    try {
      fs.mkdirSync(path.join(dir, path.dirname(mainActivityPath(APP_ID))), { recursive: true });
      fs.writeFileSync(path.join(dir, mainActivityPath(APP_ID)), capacitorDefaultMainActivity(APP_ID));
      fs.writeFileSync(path.join(dir, 'android/app/src/main/AndroidManifest.xml'), '<activity android:name=".MainActivity"/>');
      fs.mkdirSync(path.join(dir, 'ios/App/App'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'ios/App/App/Info.plist'), IOS_PLIST);

      assert.throws(() => cli(dir, '--check'), /Not prepared/);
      cli(dir);
      assert.equal(fs.readFileSync(path.join(dir, mainActivityPath(APP_ID)), 'utf8'), template);
      assert.match(fs.readFileSync(path.join(dir, 'ios/App/App/Info.plist'), 'utf8'), /<string>audio<\/string>/);
      const again = cli(dir);
      assert.match(again, /is Metrolist's/);
      assert.match(again, /has UIBackgroundModes audio/);
      cli(dir, '--check');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('stops loudly on an unexpected MainActivity and without any native project', () => {
    const dir = project();
    try {
      assert.throws(() => cli(dir), /No android\/ or ios\/ project/);
      fs.mkdirSync(path.join(dir, path.dirname(mainActivityPath(APP_ID))), { recursive: true });
      fs.writeFileSync(path.join(dir, 'android/app/src/main/AndroidManifest.xml'), '<activity android:name=".MainActivity"/>');
      const custom = capacitorDefaultMainActivity(APP_ID).replace('{}', '{ /* mine */ }');
      fs.writeFileSync(path.join(dir, mainActivityPath(APP_ID)), custom);
      assert.throws(() => cli(dir), /neither Capacitor's default MainActivity nor Metrolist's/);
      assert.equal(fs.readFileSync(path.join(dir, mainActivityPath(APP_ID)), 'utf8'), custom, 'left untouched');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
