import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APP_BACKGROUND_EVENT,
  APP_BACKGROUND_WINDOW_EVENTS,
  APP_FOREGROUND_EVENT,
  APP_FOREGROUND_WINDOW_EVENTS,
  appBackgroundScript,
  appForegroundScript,
} from './appBackgroundSignal';

test('the desktop app signals minimise and hide with one constant page event', () => {
  assert.deepEqual([...APP_BACKGROUND_WINDOW_EVENTS], ['minimize', 'hide']);
  assert.equal(appBackgroundScript(), 'window.dispatchEvent(new Event("metrolist:app-background"));');
  // Running the script dispatches exactly that event
  const seen: string[] = [];
  const fakeWindow = { dispatchEvent: (event: { type: string }) => seen.push(event.type) };
  new Function('window', 'Event', appBackgroundScript())(fakeWindow, class {
    constructor(readonly type: string) {}
  });
  assert.deepEqual(seen, [APP_BACKGROUND_EVENT]);
});

test('restore and show dispatch the constant foreground event', () => {
  assert.deepEqual([...APP_FOREGROUND_WINDOW_EVENTS], ['restore', 'show']);
  assert.equal(appForegroundScript(), 'window.dispatchEvent(new Event("metrolist:app-foreground"));');
  const seen: string[] = [];
  const fakeWindow = { dispatchEvent: (event: { type: string }) => seen.push(event.type) };
  new Function('window', 'Event', appForegroundScript())(fakeWindow, class {
    constructor(readonly type: string) {}
  });
  assert.deepEqual(seen, [APP_FOREGROUND_EVENT]);
});
