import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_BACKGROUND_EVENT, APP_BACKGROUND_WINDOW_EVENTS, appBackgroundScript } from './appBackgroundSignal';

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
