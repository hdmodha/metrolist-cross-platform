#!/usr/bin/env node
/**
 * `npm run native:prepare`: finishes the native projects that `npx cap add android|ios` +
 * `npx cap sync` generate (they are not committed), for background play.
 *
 * - Android: installs Metrolist's MainActivity (`native/android-app/MainActivity.java`) over the
 *   generated one. It swaps Capacitor's WebView layout for the background-playback plugin's, whose
 *   WebView keeps the page visible while music plays (see the template). The generated file must be
 *   exactly Capacitor's default (or already ours): anything else stops the script with an error, so
 *   a future Capacitor template change, or a hand edit, is never overwritten silently.
 * - iOS: adds `audio` to `UIBackgroundModes` in `ios/App/App/Info.plist` (without it iOS suspends
 *   the app, and its web view, when it leaves the foreground).
 *
 * Idempotent: running it again changes nothing. `--check` only verifies (exit 1 if a project is not
 * prepared). Platforms whose project does not exist are skipped; at least one must exist.
 * The pure parts are exported and unit-tested (`prepare-native.test.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TEMPLATE_PACKAGE = 'com.metrolist.music';
export const MAIN_ACTIVITY_TEMPLATE = 'native/android-app/MainActivity.java';
/** What identifies our MainActivity (the template's layout swap). */
export const PREPARED_MARKER = 'com.metrolist.backgroundplayback.R.layout.metrolist_bridge_layout_main';
export const IOS_INFO_PLIST = 'ios/App/App/Info.plist';
export const ANDROID_MANIFEST = 'android/app/src/main/AndroidManifest.xml';

/** Line endings and trailing whitespace do not matter when the generated file is compared. */
export function normalizeSource(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function assertAppId(appId) {
  const parts = typeof appId === 'string' ? appId.split('.') : [];
  if (parts.length < 2 || !parts.every((p) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p))) {
    throw new Error(`capacitor.config.json appId ${JSON.stringify(appId)} is not a Java package name`);
  }
}

/** The MainActivity `npx cap add android` writes (Capacitor 6's template with the app's package). */
export function capacitorDefaultMainActivity(appId) {
  assertAppId(appId);
  return `package ${appId};\n\nimport com.getcapacitor.BridgeActivity;\n\npublic class MainActivity extends BridgeActivity {}\n`;
}

export function mainActivityPath(appId) {
  assertAppId(appId);
  return `android/app/src/main/java/${appId.split('.').join('/')}/MainActivity.java`;
}

/** Our template with the app's package. */
export function renderMainActivity(template, appId) {
  assertAppId(appId);
  const packageLine = `package ${TEMPLATE_PACKAGE};`;
  if (!template.startsWith(packageLine)) throw new Error(`${MAIN_ACTIVITY_TEMPLATE} must start with "${packageLine}"`);
  if (!template.includes(PREPARED_MARKER)) throw new Error(`${MAIN_ACTIVITY_TEMPLATE} must use ${PREPARED_MARKER}`);
  return `package ${appId};${template.slice(packageLine.length)}`;
}

/**
 * `default`: the untouched Capacitor default (to be replaced); `prepared`: exactly our template;
 * `unexpected`: anything else (never overwritten).
 */
export function classifyMainActivity(current, template, appId) {
  const now = normalizeSource(current);
  if (now === normalizeSource(renderMainActivity(template, appId))) return 'prepared';
  if (now === normalizeSource(capacitorDefaultMainActivity(appId))) return 'default';
  return 'unexpected';
}

/** The new MainActivity, or `null` when it is already ours. Throws when the generated file is unexpected. */
export function planMainActivity(current, template, appId) {
  const kind = classifyMainActivity(current, template, appId);
  if (kind === 'prepared') return null;
  if (kind === 'default') return renderMainActivity(template, appId);
  throw new Error(
    `${mainActivityPath(appId)} is neither Capacitor's default MainActivity nor Metrolist's. ` +
      'Capacitor\'s template (or the file) changed: compare it with native/android-app/MainActivity.java, update the template ' +
      'and capacitorDefaultMainActivity() in scripts/prepare-native.mjs, then run npm run native:prepare again.'
  );
}

/** The generated manifest must launch `.MainActivity`, the class this script replaces. */
export function checkAndroidManifest(manifest) {
  if (!manifest.includes('android:name=".MainActivity"')) {
    throw new Error(`${ANDROID_MANIFEST} does not declare android:name=".MainActivity": Capacitor's template changed`);
  }
}

const BACKGROUND_MODES_KEY = '<key>UIBackgroundModes</key>';

/**
 * `Info.plist` with `audio` in `UIBackgroundModes` (the key is added before the root dict closes,
 * or `audio` to its array). Returns the same string when it is already there. Throws on a plist it
 * does not understand.
 */
export function addBackgroundAudioMode(plist) {
  const text = plist.replace(/\r\n?/g, '\n');
  const keyAt = text.indexOf(BACKGROUND_MODES_KEY);
  if (keyAt === -1) {
    const close = text.lastIndexOf('</dict>');
    if (close === -1 || text.indexOf('</plist>', close) === -1 || text.indexOf('<dict>') === -1) {
      throw new Error(`${IOS_INFO_PLIST} has no root <dict>`);
    }
    const entry = `\t${BACKGROUND_MODES_KEY}\n\t<array>\n\t\t<string>audio</string>\n\t</array>\n`;
    return text.slice(0, close) + entry + text.slice(close);
  }
  const after = text.slice(keyAt + BACKGROUND_MODES_KEY.length);
  const trimmed = after.trimStart();
  if (trimmed.startsWith('<array/>')) {
    const at = keyAt + BACKGROUND_MODES_KEY.length + (after.length - trimmed.length);
    return `${text.slice(0, at)}<array>\n\t\t<string>audio</string>\n\t</array>${text.slice(at + '<array/>'.length)}`;
  }
  if (!trimmed.startsWith('<array>')) throw new Error(`${IOS_INFO_PLIST}: UIBackgroundModes is not an array`);
  const arrayStart = keyAt + BACKGROUND_MODES_KEY.length + (after.length - trimmed.length);
  const arrayEnd = text.indexOf('</array>', arrayStart);
  if (arrayEnd === -1) throw new Error(`${IOS_INFO_PLIST}: UIBackgroundModes array is not closed`);
  if (text.slice(arrayStart, arrayEnd).includes('<string>audio</string>')) return text;
  return `${text.slice(0, arrayEnd)}\t<string>audio</string>\n\t${text.slice(arrayEnd)}`;
}

/* ------------------------------------------- CLI -------------------------------------------- */

function run(root, { check }) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  const appId = config.appId;
  const hasAndroid = fs.existsSync(path.join(root, 'android'));
  const hasIos = fs.existsSync(path.join(root, 'ios'));
  if (!hasAndroid && !hasIos) {
    throw new Error('No android/ or ios/ project: run `npx cap add android` / `npx cap add ios` and `npx cap sync` first');
  }
  const pending = [];

  if (hasAndroid) {
    checkAndroidManifest(fs.readFileSync(path.join(root, ANDROID_MANIFEST), 'utf8'));
    const target = path.join(root, mainActivityPath(appId));
    if (!fs.existsSync(target)) throw new Error(`${mainActivityPath(appId)} is missing: run \`npx cap add android\``);
    const template = fs.readFileSync(path.join(root, MAIN_ACTIVITY_TEMPLATE), 'utf8');
    const next = planMainActivity(fs.readFileSync(target, 'utf8'), template, appId);
    if (next === null) {
      console.log(`Android: ${mainActivityPath(appId)} is Metrolist's (background-playback WebView)`);
    } else if (check) {
      pending.push(`Android: ${mainActivityPath(appId)} is still Capacitor's default`);
    } else {
      fs.writeFileSync(target, next);
      console.log(`Android: installed ${MAIN_ACTIVITY_TEMPLATE} as ${mainActivityPath(appId)}`);
    }
  } else {
    console.log('Android: no android/ project, skipped');
  }

  if (hasIos) {
    const plistPath = path.join(root, IOS_INFO_PLIST);
    if (!fs.existsSync(plistPath)) throw new Error(`${IOS_INFO_PLIST} is missing: run \`npx cap add ios\``);
    const plist = fs.readFileSync(plistPath, 'utf8');
    const next = addBackgroundAudioMode(plist);
    if (next === plist) {
      console.log(`iOS: ${IOS_INFO_PLIST} has UIBackgroundModes audio`);
    } else if (check) {
      pending.push(`iOS: ${IOS_INFO_PLIST} lacks UIBackgroundModes audio`);
    } else {
      fs.writeFileSync(plistPath, next);
      console.log(`iOS: added UIBackgroundModes audio to ${IOS_INFO_PLIST}`);
    }
  } else {
    console.log('iOS: no ios/ project, skipped');
  }

  if (pending.length > 0) {
    throw new Error(`Not prepared (run npm run native:prepare):\n- ${pending.join('\n- ')}`);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  try {
    run(root, { check: process.argv.includes('--check') });
  } catch (error) {
    console.error(`native:prepare failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
