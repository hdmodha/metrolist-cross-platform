import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { formatRoute, isSameRoute, navigationEffect, navigationIntentFor, parseRoute, type Route } from './router';

describe('parseRoute', () => {
  test('the five pages', () => {
    assert.deepEqual(parseRoute('#/'), { name: 'home' });
    assert.deepEqual(parseRoute('#/search'), { name: 'search', query: '' });
    assert.deepEqual(parseRoute('#/search?q=daft%20punk'), { name: 'search', query: 'daft punk' });
    assert.deepEqual(parseRoute('#/library'), { name: 'library' });
    assert.deepEqual(parseRoute('#/library/liked'), { name: 'liked' });
    assert.deepEqual(parseRoute('#/library/downloads'), { name: 'downloads' });
  });

  test('the hidden debug log', () => {
    assert.deepEqual(parseRoute('#/debug'), { name: 'debug' });
    assert.deepEqual(parseRoute('#/debug/'), { name: 'debug' });
    assert.deepEqual(parseRoute('#/DEBUG'), { name: 'home' });
  });

  test('an empty hash, a missing slash or a trailing slash still work', () => {
    assert.deepEqual(parseRoute(''), { name: 'home' });
    assert.deepEqual(parseRoute('#'), { name: 'home' });
    assert.deepEqual(parseRoute('#search?q=x'), { name: 'search', query: 'x' });
    assert.deepEqual(parseRoute('#/library/liked/'), { name: 'liked' });
    assert.deepEqual(parseRoute('/library'), { name: 'library' }, 'without the leading #');
  });

  test('unknown routes fall back to Home', () => {
    for (const hash of ['#/nope', '#/library/playlists', '#/search/extra', '#top', '#/LIBRARY', '#//library']) {
      assert.deepEqual(parseRoute(hash), { name: 'home' }, hash);
    }
  });

  test('search queries are decoded, trimmed and length-capped; a malformed query never throws', () => {
    assert.equal((parseRoute('#/search?q=a+b') as { query: string }).query, 'a b', '+ is a space');
    assert.equal((parseRoute('#/search?q=AC%2FDC%20%26%20friends') as { query: string }).query, 'AC/DC & friends');
    assert.equal((parseRoute('#/search?q=%20%20kavinsky%20%20') as { query: string }).query, 'kavinsky');
    assert.equal((parseRoute('#/search?other=1&q=x') as { query: string }).query, 'x');
    assert.equal((parseRoute('#/search?q=') as { query: string }).query, '');
    assert.equal((parseRoute('#/search?q') as { query: string }).query, '');
    assert.doesNotThrow(() => parseRoute('#/search?q=%E0%A4%A'));
    assert.equal(parseRoute('#/search?q=%E0%A4%A').name, 'search');
    assert.equal((parseRoute(`#/search?q=${'x'.repeat(500)}`) as { query: string }).query.length, 200);
    assert.equal((parseRoute('#/search?q=%3Cscript%3E') as { query: string }).query, '<script>', 'kept as text (React escapes it)');
  });
});

describe('formatRoute', () => {
  test('canonical hashes', () => {
    assert.equal(formatRoute({ name: 'home' }), '#/');
    assert.equal(formatRoute({ name: 'search', query: '' }), '#/search');
    assert.equal(formatRoute({ name: 'search', query: '  ' }), '#/search');
    assert.equal(formatRoute({ name: 'library' }), '#/library');
    assert.equal(formatRoute({ name: 'liked' }), '#/library/liked');
    assert.equal(formatRoute({ name: 'downloads' }), '#/library/downloads');
    assert.equal(formatRoute({ name: 'debug' }), '#/debug');
  });

  test('queries are encoded so every character survives a round trip', () => {
    assert.equal(formatRoute({ name: 'search', query: 'daft punk' }), '#/search?q=daft%20punk');
    for (const query of ['AC/DC & friends', 'a+b', '50% off?', 'tum hi ho #1', 'Beyoncé', '아이유', 'x=y&q=z']) {
      const route: Route = { name: 'search', query };
      assert.deepEqual(parseRoute(formatRoute(route)), route, query);
    }
  });

  test('isSameRoute compares names and queries', () => {
    assert.equal(isSameRoute({ name: 'home' }, { name: 'home' }), true);
    assert.equal(isSameRoute({ name: 'search', query: 'a' }, { name: 'search', query: 'a' }), true);
    assert.equal(isSameRoute({ name: 'search', query: 'a' }, { name: 'search', query: 'b' }), false);
    assert.equal(isSameRoute({ name: 'liked' }, { name: 'downloads' }), false);
  });
});

describe('navigationEffect', () => {
  test('a link to the page that is already shown adds no history entry', () => {
    assert.equal(navigationEffect({ name: 'library' }, '#/library'), 'none');
    assert.equal(navigationEffect({ name: 'search', query: 'daft punk' }, '#/search?q=daft%20punk'), 'none');
  });

  test('the same page under another URL (no hash yet on a fresh start, an unknown route) is replaced, not pushed', () => {
    assert.equal(navigationEffect({ name: 'home' }, ''), 'replace');
    assert.equal(navigationEffect({ name: 'home' }, '#'), 'replace');
    assert.equal(navigationEffect({ name: 'home' }, '#/no/such/page'), 'replace');
    assert.equal(navigationEffect({ name: 'library' }, '#/library/'), 'replace');
  });

  test('another page is pushed', () => {
    assert.equal(navigationEffect({ name: 'library' }, ''), 'push');
    assert.equal(navigationEffect({ name: 'search', query: 'x' }, '#/search'), 'push');
  });
});

describe('navigationIntentFor', () => {
  test('a location the app did not navigate to itself counts as Back / Forward (restore its scroll)', () => {
    assert.equal(navigationIntentFor('#/library'), 'pop');
    assert.equal(navigationIntentFor(''), 'pop');
  });
});
