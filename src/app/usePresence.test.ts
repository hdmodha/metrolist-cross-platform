import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EXIT_MS, exitDelayMs, presenceView } from './usePresence';

describe('presenceView', () => {
  it('draws an open element as open', () => {
    assert.deepEqual(presenceView(true, true, false), { render: true, state: 'open' });
    assert.deepEqual(presenceView(true, false, false), { render: true, state: 'open' });
  });

  it('keeps a closing element mounted, marked closed, until it is unmounted', () => {
    assert.deepEqual(presenceView(false, true, false), { render: true, state: 'closed' });
    assert.deepEqual(presenceView(false, false, false), { render: false, state: 'closed' });
  });

  it('removes a closing element at once with reduced motion', () => {
    assert.deepEqual(presenceView(false, true, true), { render: false, state: 'closed' });
    assert.equal(presenceView(true, true, true).render, true);
  });
});

describe('exitDelayMs', () => {
  it('waits for the animation, or not at all with reduced motion', () => {
    assert.equal(exitDelayMs(false, EXIT_MS.sheet), EXIT_MS.sheet);
    assert.equal(exitDelayMs(true, EXIT_MS.sheet), 0);
    assert.equal(exitDelayMs(false, -5), 0);
  });
});
