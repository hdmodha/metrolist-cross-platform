import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_EMBEDDABLE_IDS,
  OEMBED_ORIGIN,
  buildOEmbedUrl,
  embeddabilityFromOEmbedStatus,
  parseEmbeddableIds,
  readEmbeddabilityResults,
} from './embeddability';

test('the oEmbed URL is fixed: youtube.com, JSON, the watch URL of one valid video id', () => {
  const url = buildOEmbedUrl('DrLaoBKGS3g');
  assert.equal(url.origin, OEMBED_ORIGIN);
  assert.equal(url.pathname, '/oembed');
  assert.equal(url.searchParams.get('format'), 'json');
  assert.equal(url.searchParams.get('url'), 'https://www.youtube.com/watch?v=DrLaoBKGS3g');
  assert.equal(url.href, 'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DDrLaoBKGS3g');
  assert.throws(() => buildOEmbedUrl('../../evil'));
  assert.throws(() => buildOEmbedUrl('abc'));
});

test('oEmbed status: 200 embeddable, 401 / 403 / 404 not, anything else unknown', () => {
  assert.equal(embeddabilityFromOEmbedStatus(200), true);
  for (const status of [401, 403, 404]) assert.equal(embeddabilityFromOEmbedStatus(status), false);
  for (const status of [0, 204, 302, 400, 429, 500, 503]) assert.equal(embeddabilityFromOEmbedStatus(status), null);
});

test('the ids parameter: comma separated, 1 to 10 valid ids, duplicates removed; anything else is rejected', () => {
  assert.deepEqual(parseEmbeddableIds('DrLaoBKGS3g,b1kbLwvqugk,DrLaoBKGS3g'), ['DrLaoBKGS3g', 'b1kbLwvqugk']);
  assert.deepEqual(parseEmbeddableIds(' DrLaoBKGS3g , b1kbLwvqugk '), ['DrLaoBKGS3g', 'b1kbLwvqugk']);
  assert.equal(parseEmbeddableIds(''), null);
  assert.equal(parseEmbeddableIds(undefined), null);
  assert.equal(parseEmbeddableIds(['DrLaoBKGS3g']), null, 'a repeated query parameter is not accepted');
  assert.equal(parseEmbeddableIds('DrLaoBKGS3g,<script>'), null);
  const eleven = Array.from({ length: MAX_EMBEDDABLE_IDS + 1 }, (_, i) => `video${String(i).padStart(6, '0')}`);
  assert.equal(parseEmbeddableIds(eleven.join(',')), null);
  assert.equal(parseEmbeddableIds(eleven.slice(0, MAX_EMBEDDABLE_IDS).join(','))?.length, MAX_EMBEDDABLE_IDS);
  assert.equal(parseEmbeddableIds('x'.repeat(5000)), null);
});

test('a results payload is read defensively: only the requested ids, only true / false / null', () => {
  const ids = ['DrLaoBKGS3g', 'b1kbLwvqugk', 'Z7MIQJluULU'];
  assert.deepEqual(
    readEmbeddabilityResults({ results: { DrLaoBKGS3g: false, b1kbLwvqugk: true, Z7MIQJluULU: 'yes', other123456: true } }, ids),
    { DrLaoBKGS3g: false, b1kbLwvqugk: true, Z7MIQJluULU: null }
  );
  assert.deepEqual(readEmbeddabilityResults(null, ids), { DrLaoBKGS3g: null, b1kbLwvqugk: null, Z7MIQJluULU: null });
  assert.deepEqual(readEmbeddabilityResults({ results: [] }, ['DrLaoBKGS3g']), { DrLaoBKGS3g: null });
});
