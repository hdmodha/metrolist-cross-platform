import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  LOW_QUALITY_HINT,
  STREAM_QUALITY_KEY,
  hiddenPlayerCssSize,
  isAboveTarget,
  qualityPlayerVars,
  readStreamQualityMode,
  suggestedQualityFor,
  writeStreamQualityMode,
} from './streamQuality';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

describe('stream quality mode storage', () => {
  it('defaults to low', () => {
    assert.equal(readStreamQualityMode(memory()), 'low');
    assert.equal(readStreamQualityMode(null), 'low');
  });
  it('round-trips and validates', () => {
    const s = memory();
    writeStreamQualityMode('auto', s);
    assert.equal(s.getItem(STREAM_QUALITY_KEY), 'auto');
    assert.equal(readStreamQualityMode(s), 'auto');
    writeStreamQualityMode('low', s);
    assert.equal(readStreamQualityMode(s), 'low');
    assert.equal(readStreamQualityMode(memory({ [STREAM_QUALITY_KEY]: 'hd' })), 'low');
  });
  it('swallows storage errors', () => {
    const broken = {
      getItem: () => {
        throw new Error('no');
      },
      setItem: () => {
        throw new Error('no');
      },
      removeItem: () => undefined,
    };
    assert.equal(readStreamQualityMode(broken), 'low');
    assert.doesNotThrow(() => writeStreamQualityMode('auto', broken));
  });
});

describe('hiddenPlayerCssSize', () => {
  it('auto is 1x1', () => {
    assert.deepEqual(hiddenPlayerCssSize('auto', 3), { width: 1, height: 1 });
  });
  it('low is about 320x180 device pixels', () => {
    assert.deepEqual(hiddenPlayerCssSize('low', 1), { width: 320, height: 180 });
    assert.deepEqual(hiddenPlayerCssSize('low', 2), { width: 160, height: 90 });
    assert.deepEqual(hiddenPlayerCssSize('low', 2.625), { width: 122, height: 69 });
    assert.deepEqual(hiddenPlayerCssSize('low', 3), { width: 107, height: 60 });
  });
  it('sanitises the ratio', () => {
    assert.deepEqual(hiddenPlayerCssSize('low', NaN), { width: 320, height: 180 });
    assert.deepEqual(hiddenPlayerCssSize('low', 0.5), { width: 320, height: 180 });
    assert.deepEqual(hiddenPlayerCssSize('low', 10), { width: 80, height: 45 });
    assert.deepEqual(hiddenPlayerCssSize('low', Infinity), { width: 320, height: 180 });
  });
});

describe('quality hints', () => {
  it('low adds vq=tiny and suggests tiny; auto adds nothing', () => {
    assert.equal(LOW_QUALITY_HINT, 'tiny');
    assert.deepEqual(qualityPlayerVars('low'), { vq: 'tiny' });
    assert.equal(suggestedQualityFor('low'), 'tiny');
    assert.deepEqual(qualityPlayerVars('auto'), {});
    assert.equal(suggestedQualityFor('auto'), undefined);
  });
});

describe('isAboveTarget', () => {
  it('flags qualities above 240p', () => {
    for (const q of ['medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'highres']) assert.equal(isAboveTarget(q), true, q);
    for (const q of ['tiny', 'small', 'auto', 'unknown', '', 'banana']) assert.equal(isAboveTarget(q), false, q);
  });
});
