import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatRoute, type NavigationIntent, type Route } from './router';
import {
  forgetsSaved,
  INITIAL_TAB_MEMORY,
  isScrollerId,
  isTabRoot,
  MAX_SCROLL_LOCATIONS,
  MAX_SCROLLERS_PER_LOCATION,
  parseNavigationMemory,
  planScroll,
  planTabPress,
  rememberRoute,
  RESTORE_TIMEOUT_MS,
  restoreStep,
  ScrollMemory,
  serializeNavigationMemory,
  tabOf,
  tabTarget,
  type TabMemory,
} from './tabMemory';

const home: Route = { name: 'home' };
const searchRoot: Route = { name: 'search', query: '' };
const searchQ: Route = { name: 'search', query: 'daft punk' };
const library: Route = { name: 'library' };
const liked: Route = { name: 'liked' };
const downloads: Route = { name: 'downloads' };

describe('tabs', () => {
  test('every route belongs to one tab; Liked Songs and Downloads are Library pages', () => {
    assert.equal(tabOf(home), 'home');
    assert.equal(tabOf(searchRoot), 'search');
    assert.equal(tabOf(searchQ), 'search');
    assert.equal(tabOf(library), 'library');
    assert.equal(tabOf(liked), 'library');
    assert.equal(tabOf(downloads), 'library');
    assert.ok(isTabRoot(home) && isTabRoot(searchRoot) && isTabRoot(library));
    assert.ok(!isTabRoot(searchQ) && !isTabRoot(liked) && !isTabRoot(downloads));
  });

  test('a fresh session remembers every tab at its root', () => {
    assert.deepEqual(INITIAL_TAB_MEMORY, { home, search: searchRoot, library });
  });

  test('rememberRoute keeps the last location per tab (same object when nothing changes)', () => {
    let memory: TabMemory = INITIAL_TAB_MEMORY;
    assert.equal(rememberRoute(memory, home), memory);
    memory = rememberRoute(memory, searchQ);
    memory = rememberRoute(memory, liked);
    assert.deepEqual(memory, { home, search: searchQ, library: liked });
    assert.equal(rememberRoute(memory, { name: 'search', query: 'daft punk' }), memory);
    memory = rememberRoute(memory, searchRoot);
    assert.deepEqual(memory.search, searchRoot, 'clearing the search is remembered too');
    assert.deepEqual(memory.library, liked);
  });

  test('switching to another tab returns to its last location', () => {
    const memory: TabMemory = { home, search: searchQ, library: liked };
    assert.deepEqual(planTabPress(memory, home, 'search'), { kind: 'switch', to: searchQ });
    assert.deepEqual(planTabPress(memory, searchQ, 'library'), { kind: 'switch', to: liked });
    assert.deepEqual(planTabPress(memory, downloads, 'home'), { kind: 'switch', to: home });
  });

  test('re-tapping the current tab goes to its root, or (already there) to the top', () => {
    const memory: TabMemory = { home, search: searchQ, library: liked };
    assert.deepEqual(planTabPress(memory, searchQ, 'search'), { kind: 'root', to: searchRoot });
    assert.deepEqual(planTabPress(memory, liked, 'library'), { kind: 'root', to: library });
    assert.deepEqual(planTabPress(memory, downloads, 'library'), { kind: 'root', to: library });
    assert.deepEqual(planTabPress(memory, home, 'home'), { kind: 'top' });
    assert.deepEqual(planTabPress(memory, searchRoot, 'search'), { kind: 'top' });
    assert.deepEqual(planTabPress(memory, library, 'library'), { kind: 'top' });
  });

  test('a tab link points where a press leads', () => {
    const memory: TabMemory = { home, search: searchQ, library: liked };
    assert.equal(formatRoute(tabTarget(memory, home, 'search')), '#/search?q=daft%20punk');
    assert.equal(formatRoute(tabTarget(memory, home, 'library')), '#/library/liked');
    assert.equal(formatRoute(tabTarget(memory, liked, 'library')), '#/library', 'the current tab links to its root');
    assert.equal(formatRoute(tabTarget(memory, home, 'home')), '#/');
  });
});

describe('ScrollMemory', () => {
  test('stores the page offset and shelf offsets per location (rounded, never negative / huge)', () => {
    const memory = new ScrollMemory();
    memory.setY('#/', 420.6);
    memory.setX('#/', 'recent', 300);
    memory.setX('#/', 'artists', 120.2);
    assert.deepEqual(memory.get('#/'), { y: 421, x: { recent: 300, artists: 120 } });
    memory.setY('#/', -5);
    memory.setY('#/', Number.NaN);
    memory.setY('#/', 5_000_000);
    memory.setX('#/', 'Bad Id', 10);
    memory.setX('#/', 'recent', Number.POSITIVE_INFINITY);
    assert.deepEqual(memory.get('#/'), { y: 421, x: { recent: 300, artists: 120 } });
    memory.setX('#/library/liked', 'recent', 50);
    assert.deepEqual(memory.get('#/library/liked'), { y: 0, x: { recent: 50 } });
  });

  test('is bounded: the least recently written location goes first', () => {
    const memory = new ScrollMemory();
    for (let i = 0; i < MAX_SCROLL_LOCATIONS + 5; i++) memory.setY(`#/search?q=q${i}`, i + 1);
    assert.equal(memory.size, MAX_SCROLL_LOCATIONS);
    assert.equal(memory.get('#/search?q=q0'), undefined);
    assert.equal(memory.get(`#/search?q=q${MAX_SCROLL_LOCATIONS + 4}`)?.y, MAX_SCROLL_LOCATIONS + 5);
    // Writing refreshes recency
    memory.setY('#/search?q=q5', 999);
    memory.setY('#/new', 1);
    assert.equal(memory.get('#/search?q=q6'), undefined);
    assert.equal(memory.get('#/search?q=q5')?.y, 999);
  });

  test('keeps at most a few shelves per location', () => {
    const memory = new ScrollMemory();
    for (let i = 0; i < MAX_SCROLLERS_PER_LOCATION + 3; i++) memory.setX('#/', `shelf-${i}`, i + 1);
    const shelves = Object.keys(memory.get('#/')?.x ?? {});
    assert.equal(shelves.length, MAX_SCROLLERS_PER_LOCATION);
    assert.ok(!shelves.includes('shelf-0'));
    assert.ok(shelves.includes(`shelf-${MAX_SCROLLERS_PER_LOCATION + 2}`));
  });

  test('forget drops a location; load keeps the newest that fit', () => {
    const memory = new ScrollMemory();
    memory.setY('#/', 10);
    memory.forget('#/');
    assert.equal(memory.get('#/'), undefined);
    const many = Array.from({ length: MAX_SCROLL_LOCATIONS + 2 }, (_, i) => [`#/search?q=${i}`, { y: i, x: {} }] as [string, { y: number; x: Record<string, number> }]);
    memory.load(many);
    assert.equal(memory.size, MAX_SCROLL_LOCATIONS);
    assert.equal(memory.list()[0][0], '#/search?q=2');
  });

  test('shelf ids are short, lower-case and selector-safe', () => {
    for (const id of ['recent', 'recommendations', 'artists', 'a-1']) assert.ok(isScrollerId(id), id);
    for (const id of ['', 'Recent', 'a b', 'x"]', 'a'.repeat(33), 7, null]) assert.ok(!isScrollerId(id), String(id));
  });
});

describe('scroll plan', () => {
  const saved = { y: 640, x: { recent: 200 } };

  test('Back / Forward, a tab switch and a reload restore what the location had', () => {
    for (const intent of ['pop', 'tab', 'boot'] as NavigationIntent[]) {
      assert.deepEqual(planScroll(intent, saved), { kind: 'restore', snapshot: saved }, intent);
      assert.deepEqual(planScroll(intent, undefined), { kind: 'top' }, `${intent}: a new location starts at the top`);
      assert.deepEqual(planScroll(intent, { y: 0, x: {} }), { kind: 'top' });
    }
    assert.deepEqual(planScroll('tab', { y: 0, x: { artists: 90 } }), { kind: 'restore', snapshot: { y: 0, x: { artists: 90 } } }, 'only a shelf moved');
  });

  test('a link and a re-tap start at the top and forget the old offsets; refining a search keeps the page still', () => {
    assert.deepEqual(planScroll('push', saved), { kind: 'top' });
    assert.deepEqual(planScroll('retap', saved), { kind: 'top' });
    assert.deepEqual(planScroll('replace', saved), { kind: 'keep' });
    assert.ok(forgetsSaved('push') && forgetsSaved('retap'));
    for (const intent of ['pop', 'tab', 'boot', 'replace'] as NavigationIntent[]) assert.ok(!forgetsSaved(intent), intent);
  });

  test('restoreStep waits for the content, scrolling as far as it allows, then gives up at the timeout', () => {
    assert.deepEqual(restoreStep(800, 2000, 0), { scrollTo: 800, done: true }, 'content already long enough');
    assert.deepEqual(restoreStep(800, 300, 100), { scrollTo: 300, done: false }, 'results still loading');
    assert.deepEqual(restoreStep(800, -50, 100), { scrollTo: 0, done: false }, 'a page shorter than the window');
    assert.deepEqual(restoreStep(800, 799.4, 100), { scrollTo: 799.4, done: true }, 'sub-pixel rounding counts as reached');
    assert.deepEqual(restoreStep(800, 300, RESTORE_TIMEOUT_MS), { scrollTo: 300, done: true }, 'the content never got that long');
  });
});

describe('session copy', () => {
  test('round-trips the tab memory and the offsets', () => {
    const memory = new ScrollMemory();
    memory.setY('#/', 120);
    memory.setX('#/', 'recent', 80);
    memory.setY('#/search?q=daft%20punk', 900);
    const tabs: TabMemory = { home, search: searchQ, library: liked };
    const parsed = parseNavigationMemory(serializeNavigationMemory(tabs, memory.list()));
    assert.deepEqual(parsed, { tabs, scroll: memory.list() });
  });

  test('anything corrupt is dropped, field by field', () => {
    for (const raw of [null, '', '{', '[]', '42', 'null', JSON.stringify({ version: 2, tabs: {}, scroll: [] }), JSON.stringify({ version: 1, tabs: 'x', scroll: [] })]) {
      assert.equal(parseNavigationMemory(raw), null, String(raw));
    }
    const parsed = parseNavigationMemory(
      JSON.stringify({
        version: 1,
        // a Library page saved as the Search tab, a non-canonical URL, a valid Library page
        tabs: { home: '#/library', search: '#/search?q=a+b', library: '#/library/downloads' },
        scroll: [
          ['#/', 100, { recent: 40, 'Bad Id': 5, artists: -3 }],
          ['#/nope', 10, {}],
          ['#/library', 'x', {}],
          ['#/library/liked', 50, []],
          ['#/library/liked', 60],
          'junk',
          ['#/search?q=x', 70, {}],
        ],
      })
    );
    assert.deepEqual(parsed, {
      tabs: { home, search: searchRoot, library: downloads },
      scroll: [
        ['#/', { y: 100, x: { recent: 40 } }],
        ['#/search?q=x', { y: 70, x: {} }],
      ],
    });
  });
});
