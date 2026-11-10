import test from 'node:test';
import assert from 'node:assert/strict';

test('Queue rules: next / previous, repeat modes, shuffle and end of queue', async () => {
  const { pickNextQueueIndex } = await import('./queueRules');
  const base = { queueLength: 4, shuffle: false, repeatMode: 'OFF' as const };

  // Natural end of a song
  assert.equal(pickNextQueueIndex({ ...base, currentIndex: 1, direction: 1, userInitiated: false }), 2);
  assert.equal(pickNextQueueIndex({ ...base, currentIndex: 3, direction: 1, userInitiated: false }), -1);
  assert.equal(
    pickNextQueueIndex({ ...base, repeatMode: 'ALL', currentIndex: 3, direction: 1, userInitiated: false }),
    0
  );
  assert.equal(
    pickNextQueueIndex({ ...base, repeatMode: 'ONE', currentIndex: 2, direction: 1, userInitiated: false }),
    2
  );

  // Pressing Next always moves on, even with repeat-one
  assert.equal(
    pickNextQueueIndex({ ...base, repeatMode: 'ONE', currentIndex: 2, direction: 1, userInitiated: true }),
    3
  );
  assert.equal(pickNextQueueIndex({ ...base, currentIndex: 0, direction: -1, userInitiated: true }), 0);
  assert.equal(
    pickNextQueueIndex({ ...base, repeatMode: 'ALL', currentIndex: 0, direction: -1, userInitiated: true }),
    3
  );

  // Shuffle never picks the song that is already playing (the old code could, with 2 songs)
  for (const queueLength of [2, 3, 7]) {
    for (const r of [0, 0.25, 0.5, 0.999]) {
      const idx = pickNextQueueIndex({
        queueLength,
        currentIndex: 1,
        direction: 1,
        shuffle: true,
        repeatMode: 'OFF',
        userInitiated: true,
        random: () => r,
      });
      assert.notEqual(idx, 1);
      assert.ok(idx >= 0 && idx < queueLength);
    }
  }

  // The playing song was removed from the queue / empty queue
  assert.equal(pickNextQueueIndex({ ...base, currentIndex: -1, direction: 1, userInitiated: false }), 0);
  assert.equal(
    pickNextQueueIndex({ ...base, queueLength: 0, currentIndex: -1, direction: 1, userInitiated: true }),
    -1
  );
  assert.equal(
    pickNextQueueIndex({ ...base, queueLength: 1, currentIndex: 0, direction: 1, userInitiated: false }),
    -1
  );
});

test('Queue rules: add-to-queue order, play-now context and radio top-up keep hand-queued songs', async () => {
  const { insertIntoQueueAfterCurrent, buildPlayNowQueue, mergeRadioIntoQueue } = await import('./queueRules');
  const t = (id: string) => ({ id });
  const ids = (list: Array<{ id: string }>) => list.map((x) => x.id).join(',');

  // Manual picks play right after the current song, in the order they were added, before radio picks
  let queue = [t('now'), t('radio1'), t('radio2')];
  const manual = new Set<string>();
  queue = insertIntoQueueAfterCurrent(queue, 'now', t('a'), manual);
  manual.add('a');
  queue = insertIntoQueueAfterCurrent(queue, 'now', t('b'), manual);
  manual.add('b');
  assert.equal(ids(queue), 'now,a,b,radio1,radio2');
  // Queueing a song that is already further down moves it up instead of duplicating it
  queue = insertIntoQueueAfterCurrent(queue, 'now', t('radio2'), manual);
  assert.equal(ids(queue), 'now,a,b,radio2,radio1');
  assert.equal(insertIntoQueueAfterCurrent(queue, 'now', t('now'), manual), queue);

  // Playing a new song keeps history + manual picks and drops stale automatic picks
  const playNow = buildPlayNowQueue(
    [t('old1'), t('now'), t('a'), t('radio1')],
    'now',
    t('picked'),
    new Set(['a']),
    [t('ctx1'), t('a'), t('ctx2')]
  );
  assert.equal(ids(playNow), 'old1,now,picked,a,ctx1,ctx2');
  // Nothing has been played yet: no history is kept
  assert.equal(ids(buildPlayNowQueue([t('seed1'), t('seed2')], null, t('picked'), new Set())), 'picked');

  // Radio only tops up a queue that is about to run dry, and never duplicates
  const full = [t('now'), t('a'), t('b'), t('c')];
  assert.equal(mergeRadioIntoQueue(full, 'now', [t('r1')]), full);
  const low = [t('played'), t('now'), t('a')];
  assert.equal(ids(mergeRadioIntoQueue(low, 'now', [t('a'), t('r1'), t('now'), t('r2')])), 'played,now,a,r1,r2');
  // The current song must be in the queue for a top-up to make sense
  assert.equal(mergeRadioIntoQueue(low, 'missing', [t('r1')]), low);
});

test('Queue rules: "Play next" goes straight after the current song, ahead of earlier hand-queued songs', async () => {
  const { insertIntoQueueAsNext } = await import('./queueRules');
  const t = (id: string) => ({ id });
  const ids = (list: Array<{ id: string }>) => list.map((x) => x.id).join(',');

  const queue = [t('old'), t('now'), t('a'), t('b'), t('radio1')];
  assert.equal(ids(insertIntoQueueAsNext(queue, 'now', t('x'))), 'old,now,x,a,b,radio1');
  // Already queued further down: moved up, never duplicated
  assert.equal(ids(insertIntoQueueAsNext(queue, 'now', t('radio1'))), 'old,now,radio1,a,b');
  // Already queued earlier (history): moved after the current song
  assert.equal(ids(insertIntoQueueAsNext(queue, 'now', t('old'))), 'now,old,a,b,radio1');
  // The playing song itself: unchanged (same reference)
  assert.equal(insertIntoQueueAsNext(queue, 'now', t('now')), queue);
  // Current song not in the queue: goes to the front
  assert.equal(ids(insertIntoQueueAsNext([t('a')], 'missing', t('x'))), 'x,a');
});

test('Queue rules: radio top-up honours custom thresholds and never drops upcoming songs', async () => {
  const { mergeRadioIntoQueue } = await import('./queueRules');
  const t = (id: string) => ({ id });
  const ids = (list: Array<{ id: string }>) => list.map((x) => x.id).join(',');
  const history = Array.from({ length: 40 }, (_, i) => t(`h${i}`));
  const queue = [...history, t('now'), t('u1'), t('u2')];
  const radio = Array.from({ length: 15 }, (_, i) => t(`r${i}`));
  const merged = mergeRadioIntoQueue(queue, 'now', radio, { minUpcoming: 6, maxAppend: 10, maxHistory: 30 });
  // 30 played songs kept, then the current song, the hand-queued songs and 10 radio picks
  assert.equal(merged.length, 30 + 1 + 2 + 10);
  assert.equal(merged[0].id, 'h10');
  assert.equal(ids(merged.slice(30, 33)), 'now,u1,u2');
  // 6 upcoming songs: nothing appended
  const six = [t('now'), ...Array.from({ length: 6 }, (_, i) => t(`u${i}`))];
  assert.equal(mergeRadioIntoQueue(six, 'now', radio, { minUpcoming: 6 }), six);
});
