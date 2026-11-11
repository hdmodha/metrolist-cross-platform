import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artworkUrlForSize } from './artworkUrl';

const small = (u: string) => artworkUrlForSize(u, 'small');

test('large keeps the URL', () => {
  const u = 'https://i.ytimg.com/vi/abc/hqdefault.jpg?sqp=x&rs=y';
  assert.equal(artworkUrlForSize(u, 'large'), u);
});

test('ytimg full-size names become mqdefault without the query', () => {
  for (const name of ['hqdefault', 'sddefault', 'maxresdefault', 'hq720']) {
    assert.equal(small(`https://i.ytimg.com/vi/abc_DEF-123/${name}.jpg?sqp=x&rs=y`), 'https://i.ytimg.com/vi/abc_DEF-123/mqdefault.jpg');
  }
  assert.equal(small('https://i1.ytimg.com/vi_webp/abc/hq720.webp?x=1'), 'https://i1.ytimg.com/vi_webp/abc/mqdefault.webp');
});

test('ytimg small names and other shapes stay', () => {
  for (const u of [
    'https://i.ytimg.com/vi/abc/mqdefault.jpg',
    'https://i.ytimg.com/vi/abc/default.jpg?x=1',
    'https://i.ytimg.com/vi/abc/hqdefault.webp',
    'https://i.ytimg.com/vi/abc/extra/hqdefault.jpg',
    'https://i.ytimg.com/an_webp/abc/hqdefault.jpg',
  ]) {
    assert.equal(small(u), u);
  }
});

test('googleusercontent / ggpht size directives shrink to 120', () => {
  assert.equal(small('https://lh3.googleusercontent.com/abc=w400-h400-l90-rj'), 'https://lh3.googleusercontent.com/abc=w120-h120-l90-rj');
  assert.equal(small('https://yt3.ggpht.com/xyz=w544-h544'), 'https://yt3.ggpht.com/xyz=w120-h120');
  assert.equal(small('https://yt3.ggpht.com/xyz=s900'), 'https://yt3.ggpht.com/xyz=s120');
  assert.equal(small('https://lh3.googleusercontent.com/abc'), 'https://lh3.googleusercontent.com/abc');
  assert.equal(small('https://lh3.googleusercontent.com/abc=wide'), 'https://lh3.googleusercontent.com/abc=wide');
  assert.equal(small('https://lh3.googleusercontent.com/a=w1-h2/b'), 'https://lh3.googleusercontent.com/a=w1-h2/b');
});

test('other hosts and unparsable input stay; never throws', () => {
  for (const u of ['https://example.com/vi/abc/hqdefault.jpg', 'not a url', '', 'data:image/png;base64,AAAA', 'https://evilytimg.com/vi/a/hqdefault.jpg']) {
    assert.equal(small(u), u);
  }
});
