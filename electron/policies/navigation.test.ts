import test from 'node:test';
import assert from 'node:assert/strict';
import { decideNavigation, decideWindowOpen } from './navigation';

const APP = 'http://127.0.0.1:47823';

test('same-origin navigation stays in the app', () => {
  assert.equal(decideNavigation(`${APP}/`, APP), 'allow');
  assert.equal(decideNavigation(`${APP}/#/library/liked`, APP), 'allow');
  assert.equal(decideNavigation(`${APP}/index.html?x=1`, APP), 'allow');
});

test('http(s) links to other origins open in the default browser', () => {
  assert.equal(decideNavigation('https://music.youtube.com/watch?v=abc', APP), 'external');
  assert.equal(decideNavigation('https://www.youtube.com/', APP), 'external');
  assert.equal(decideNavigation('http://example.com/', APP), 'external');
  // Another port or host name is another origin
  assert.equal(decideNavigation('http://127.0.0.1:47824/', APP), 'external');
  assert.equal(decideNavigation('http://localhost:47823/', APP), 'external');
  assert.equal(decideNavigation('https://127.0.0.1:47823/', APP), 'external');
});

test('everything else is denied', () => {
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<p>hi</p>',
    'about:blank',
    'mailto:someone@example.com',
    'ms-settings:privacy',
    'smb://server/share',
    'chrome://settings',
    'not a url',
    '',
    'https://user:secret@example.com/',
  ]) {
    assert.equal(decideNavigation(url, APP), 'deny', url);
  }
});

test('window.open follows the same rule', () => {
  assert.equal(decideWindowOpen(`${APP}/#/search`, APP), 'allow');
  assert.equal(decideWindowOpen('https://www.youtube.com/watch?v=abc', APP), 'external');
  assert.equal(decideWindowOpen('file:///C:/Windows/System32/calc.exe', APP), 'deny');
  assert.equal(decideWindowOpen('about:blank', APP), 'deny');
});

test('a malformed app origin allows nothing in-app', () => {
  assert.equal(decideNavigation(`${APP}/`, 'nonsense'), 'external');
  assert.equal(decideNavigation('file:///x', 'nonsense'), 'deny');
});
