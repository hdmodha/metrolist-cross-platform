import test from 'node:test';
import assert from 'node:assert/strict';
import { isPermissionAllowed } from './permissions';

test('only fullscreen (the YouTube player) and writing to the clipboard are granted', () => {
  assert.equal(isPermissionAllowed('fullscreen'), true);
  assert.equal(isPermissionAllowed('clipboard-sanitized-write'), true);
});

test('everything the app does not need is denied', () => {
  for (const permission of [
    'media',
    'geolocation',
    'notifications',
    'midi',
    'midiSysex',
    'pointerLock',
    'keyboardLock',
    'openExternal',
    'clipboard-read',
    'display-capture',
    'mediaKeySystem',
    'idle-detection',
    'window-management',
    'hid',
    'serial',
    'usb',
    'unknown',
    'storage-access',
    'top-level-storage-access',
    'speaker-selection',
    'fileSystem',
    '',
  ]) {
    assert.equal(isPermissionAllowed(permission), false, permission);
  }
});
