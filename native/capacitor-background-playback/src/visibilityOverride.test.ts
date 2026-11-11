/**
 * The page-visibility override the Android app injects into YouTube's frames
 * (`android/src/main/assets/metrolist-page-visibility.js`), run in node against a fake window /
 * document with real event propagation (capture → target → bubble, stopImmediatePropagation).
 */
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(here, '../android/src/main/assets/metrolist-page-visibility.js');
const PLUGIN_JAVA = path.join(here, '../android/src/main/java/com/metrolist/backgroundplayback/BackgroundPlaybackPlugin.java');
const SCRIPT = fs.readFileSync(SCRIPT_PATH, 'utf8');

type Listener = (event: FakeEvent) => void;

class FakeEvent {
  propagationStopped = false;
  immediateStopped = false;
  constructor(readonly type: string) {}
  stopPropagation(): void {
    this.propagationStopped = true;
  }
  stopImmediatePropagation(): void {
    this.propagationStopped = true;
    this.immediateStopped = true;
  }
}

class FakeEventTarget {
  readonly entries: Array<{ type: string; listener: Listener; capture: boolean }> = [];
  addEventListener(type: string, listener: Listener, options?: boolean | { capture?: boolean }): void {
    const capture = typeof options === 'boolean' ? options : !!options?.capture;
    if (this.entries.some((e) => e.type === type && e.listener === listener && e.capture === capture)) return;
    this.entries.push({ type, listener, capture });
  }
  /** Runs this target's listeners of one phase; false once the event was stopped immediately. */
  invoke(event: FakeEvent, capture: boolean): boolean {
    for (const entry of [...this.entries]) {
      if (entry.type !== event.type || entry.capture !== capture) continue;
      entry.listener(event);
      if (event.immediateStopped) return false;
    }
    return true;
  }
}

/** Stands in for the browser's Document: hidden, unfocused (an app in the background). */
class FakeDocument extends FakeEventTarget {
  get hidden(): boolean {
    return true;
  }
  get webkitHidden(): boolean {
    return true;
  }
  get visibilityState(): string {
    return 'hidden';
  }
  get webkitVisibilityState(): string {
    return 'hidden';
  }
  hasFocus(): boolean {
    return false;
  }
}

class FakeWindow extends FakeEventTarget {
  readonly document = new FakeDocument();
  readonly Document = FakeDocument;
  readonly location: { origin: string };
  constructor(origin: string) {
    super();
    this.location = { origin };
  }
  /** An event fired at the document: window (capture), document (capture, then bubble), window (bubble). */
  dispatchAtDocument(type: string): FakeEvent {
    const event = new FakeEvent(type);
    if (!this.invoke(event, true) || event.propagationStopped) return event;
    if (!this.document.invoke(event, true)) return event;
    if (!this.document.invoke(event, false) || event.propagationStopped) return event;
    this.invoke(event, false);
    return event;
  }
}

const descriptors = Object.getOwnPropertyDescriptors(FakeDocument.prototype);

function freshWindow(origin: string): FakeWindow {
  // Each test gets a pristine prototype (the script patches Document.prototype)
  for (const [name, descriptor] of Object.entries(descriptors)) Object.defineProperty(FakeDocument.prototype, name, descriptor);
  return new FakeWindow(origin);
}

function inject(win: FakeWindow): void {
  vm.runInNewContext(SCRIPT, { window: win }, { filename: 'metrolist-page-visibility.js' });
}

/** Registers the page's own listeners (after the script, as YouTube's code would) and counts calls. */
function pageListeners(win: FakeWindow, type: string): { calls: () => number } {
  let calls = 0;
  const count = () => {
    calls++;
  };
  win.document.addEventListener(type, count);
  win.document.addEventListener(type, count, true);
  win.addEventListener(type, count, true);
  win.addEventListener(type, count);
  return { calls: () => calls };
}

describe('page-visibility override in YouTube frames', () => {
  for (const origin of ['https://www.youtube.com', 'https://www.youtube-nocookie.com']) {
    test(`${origin}: the document always reads visible and focused`, () => {
      const win = freshWindow(origin);
      inject(win);
      assert.equal(win.document.hidden, false);
      assert.equal(win.document.webkitHidden, false);
      assert.equal(win.document.visibilityState, 'visible');
      assert.equal(win.document.webkitVisibilityState, 'visible');
      assert.equal(win.document.hasFocus(), true);
      // Read through the prototype too (another document, or code calling the prototype getter)
      const other = new FakeDocument();
      assert.equal(other.hidden, false);
      assert.equal(other.visibilityState, 'visible');
      assert.equal(Reflect.get(FakeDocument.prototype, 'visibilityState', win.document), 'visible');
      assert.equal(FakeDocument.prototype.hasFocus.call(win.document), true);
    });

    test(`${origin}: visibilitychange never reaches the page`, () => {
      const win = freshWindow(origin);
      inject(win);
      for (const type of ['visibilitychange', 'webkitvisibilitychange']) {
        const page = pageListeners(win, type);
        const event = win.dispatchAtDocument(type);
        assert.equal(page.calls(), 0, type);
        assert.equal(event.immediateStopped, true, `${type} is stopped in the capture phase`);
      }
    });
  }

  test('other events are untouched', () => {
    const win = freshWindow('https://www.youtube.com');
    inject(win);
    for (const type of ['click', 'pagehide', 'focus', 'message']) {
      const page = pageListeners(win, type);
      win.dispatchAtDocument(type);
      assert.equal(page.calls(), 4, type);
    }
  });

  test('injecting twice changes nothing more (one listener per event type)', () => {
    const win = freshWindow('https://www.youtube.com');
    inject(win);
    inject(win);
    assert.equal(win.entries.filter((e) => e.type === 'visibilitychange').length, 1);
    assert.equal(win.document.entries.filter((e) => e.type === 'visibilitychange').length, 1);
  });
});

describe('every other origin keeps the real Page Visibility API', () => {
  const others = [
    'https://localhost', // the app itself (Capacitor's Android scheme): it saves the position on hidden
    'capacitor://localhost',
    'http://localhost:3000',
    'https://music.youtube.com',
    'https://m.youtube.com',
    'https://www.youtube.com.example.com',
    'http://www.youtube.com',
    'null',
  ];
  for (const origin of others) {
    test(origin, () => {
      const win = freshWindow(origin);
      inject(win);
      assert.equal(win.document.hidden, true);
      assert.equal(win.document.visibilityState, 'hidden');
      assert.equal(win.document.hasFocus(), false);
      const page = pageListeners(win, 'visibilitychange');
      win.dispatchAtDocument('visibilitychange');
      assert.equal(page.calls(), 4);
    });
  }
});

test('the native side injects it into exactly the origins the script accepts', () => {
  const java = fs.readFileSync(PLUGIN_JAVA, 'utf8');
  const scriptOrigins = /ALLOWED_ORIGINS = \[([^\]]*)\]/.exec(SCRIPT)?.[1] ?? '';
  const fromScript = [...scriptOrigins.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  const javaOrigins = /YOUTUBE_FRAME_ORIGINS\s*=\s*Collections\.unmodifiableSet\(\s*new HashSet<>\(Arrays\.asList\(([^)]*)\)/.exec(java)?.[1] ?? '';
  const fromJava = [...javaOrigins.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(fromScript, ['https://www.youtube-nocookie.com', 'https://www.youtube.com']);
  assert.deepEqual(fromJava, fromScript);
  assert.match(java, /"metrolist-page-visibility\.js"/);
});
