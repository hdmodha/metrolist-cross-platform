/*
 * Metrolist background play: the YouTube player keeps playing while the Android app is in the
 * background, the way Brave's background play works.
 *
 * When the app is minimised the WebView marks its pages hidden, and YouTube's player pauses itself
 * when the Page Visibility API says so. BackgroundPlaybackPlugin injects this script at document
 * start (androidx.webkit addDocumentStartJavaScript) into frames of https://www.youtube.com and
 * https://www.youtube-nocookie.com only, and the script checks that origin again itself: the app's
 * own page (https://localhost) keeps the real visibility, which it needs to save the playback
 * position when it goes to the background.
 *
 * Inside those frames: document.hidden / webkitHidden are false, visibilityState /
 * webkitVisibilityState are 'visible', visibilitychange / webkitvisibilitychange events are
 * swallowed by capturing listeners registered before any page script, and document.hasFocus()
 * returns true. Nothing else changes; playback itself stays in YouTube's own player.
 *
 * Plain ES5, no dependencies, idempotent. Unit-tested in node: src/visibilityOverride.test.ts.
 */
(function (global) {
  'use strict';
  var ALLOWED_ORIGINS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com'];
  var MARK = '__metrolistVisibilityOverride';

  var win = global;
  var doc = win && win.document;
  if (!doc || win[MARK]) return;
  var origin = '';
  try {
    origin = String(win.location && win.location.origin);
  } catch (e) {
    return;
  }
  if (ALLOWED_ORIGINS.indexOf(origin) === -1) return;
  try {
    Object.defineProperty(win, MARK, { value: true, configurable: false, enumerable: false, writable: false });
  } catch (e) {
    return;
  }

  function constant(target, name, value) {
    if (!target) return;
    try {
      Object.defineProperty(target, name, {
        configurable: true,
        enumerable: true,
        get: function () {
          return value;
        },
      });
    } catch (e) {
      // a non-configurable property: leave it
    }
  }

  var docProto = win.Document && win.Document.prototype;
  var targets = [doc, docProto];
  for (var i = 0; i < targets.length; i++) {
    constant(targets[i], 'hidden', false);
    constant(targets[i], 'webkitHidden', false);
    constant(targets[i], 'visibilityState', 'visible');
    constant(targets[i], 'webkitVisibilityState', 'visible');
  }

  function hasFocus() {
    return true;
  }
  for (var j = 0; j < targets.length; j++) {
    if (!targets[j]) continue;
    try {
      Object.defineProperty(targets[j], 'hasFocus', { configurable: true, writable: true, value: hasFocus });
    } catch (e) {
      // leave it
    }
  }

  function swallow(event) {
    event.stopImmediatePropagation();
  }
  var types = ['visibilitychange', 'webkitvisibilitychange'];
  for (var k = 0; k < types.length; k++) {
    // Capturing listeners registered first: they run before any listener of the page
    win.addEventListener(types[k], swallow, true);
    doc.addEventListener(types[k], swallow, true);
  }
})(typeof window !== 'undefined' ? window : this);
