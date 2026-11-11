import test from 'node:test';
import assert from 'node:assert/strict';
import { BUDGET, evaluateBudget } from './check-bundle-budget.mjs';

const KB = 1024;
const ok = [
  { name: 'index-a.js', raw: 367 * KB, gzip: 114 * KB },
  { name: 'index-a.css', raw: 62 * KB, gzip: 11 * KB },
  { name: 'f-a.woff2', raw: 100 * KB, gzip: 100 * KB },
];

test('the current bundle shape passes', () => {
  assert.deepEqual(evaluateBudget(ok, '<html></html>').failures, []);
});

test('JS, CSS and font overruns are each reported with actual and budget', () => {
  const big = [
    { name: 'a.js', raw: 1, gzip: BUDGET.jsGzip + 1 },
    { name: 'a.css', raw: 1, gzip: BUDGET.cssGzip + 1 },
    { name: 'a.woff2', raw: BUDGET.fontBytes + 1, gzip: 1 },
  ];
  const { failures } = evaluateBudget(big, '') as { failures: string[] };
  assert.equal(failures.length, 3);
  assert.match(failures[0], /JS.*gzip.*150/i);
  assert.match(failures[1], /CSS.*gzip.*20/i);
  assert.match(failures[2], /font/i);
});

test('only the sum counts, across several files', () => {
  const split = [
    { name: 'a.js', raw: 1, gzip: 100 * KB },
    { name: 'b.js', raw: 1, gzip: 60 * KB },
  ];
  assert.equal(evaluateBudget(split, '').failures.length, 1);
});

test('index.html must not reference Google Fonts', () => {
  assert.equal(evaluateBudget(ok, '<link href="https://fonts.googleapis.com/css2">').failures.length, 1);
  assert.equal(evaluateBudget(ok, '<link href="https://fonts.gstatic.com">').failures.length, 1);
});
