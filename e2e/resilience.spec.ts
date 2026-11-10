import { expect, test } from './fixtures/test';

const YOUTUBE_API = 'https://www.youtube.com/iframe_api';

test.describe('resilience', () => {
  test('an unplayable upload is replaced by another upload of the same song', async ({ app }) => {
    await app.open();
    const song = await app.searchAndPlayFirst('goo goo dolls iris');
    const original = (await app.yt())?.videoId ?? '';
    await app.ytDo('reloadSameVideo', original); // YouTube now refuses this upload (error 150)
    await expect.poll(async () => (await app.yt())?.videoId).not.toBe(original);
    await expect.poll(() => app.ytState()).toBe(1);
    await expect(app.heroTitle).toHaveText(song);
  });

  test('songs that cannot be played are skipped, and three failures in a row stop playback', async ({ app }) => {
    await app.open({ yt: { errorIds: ['*'] } });
    const first = (await (async () => {
      await app.search('broken uploads');
      const card = app.resultCards().first();
      const title = await card.locator('.font-semibold').textContent();
      await card.click();
      return title ?? '';
    })());
    await expect(app.notice).toContainText('Several songs in a row could not be played', { timeout: 20_000 });
    await expect(app.playButton).toBeVisible();
    await expect(app.heroTitle).not.toHaveText(first);
  });

  test('YouTube unreachable: the app waits and retries, then resumes on its own when it is back', async ({ app, page }) => {
    await page.route(YOUTUBE_API, (route) => route.abort());
    await app.open();
    await app.search('kavinsky nightcall');
    await app.resultCards().first().click();
    await expect(app.waitingBanner).toBeVisible();
    await expect(app.pauseButton, 'the play intent is kept').toBeVisible();
    expect(await app.yt()).toBeNull();

    await page.unroute(YOUTUBE_API); // falls back to the fixture's fake player
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => app.ytState()).toBe(1);
    await expect(app.waitingBanner).toBeHidden();
  });

  test('YouTube unreachable for good: after the retries run out playback stops with a message', async ({ app, page }) => {
    let scriptLoads = 0;
    await page.route(YOUTUBE_API, (route) => {
      scriptLoads++;
      return route.abort();
    });
    await page.clock.install();
    await app.open();
    await app.search('kavinsky nightcall');
    await app.resultCards().first().click();
    await expect(app.waitingBanner).toBeVisible();
    // Back-off 3 s, 6 s, 12 s, 24 s, 30 s, then give up
    for (let i = 0; i < 8 && !(await app.playButton.isVisible()); i++) {
      await page.clock.fastForward(31_000);
      await expect.poll(() => scriptLoads).toBeGreaterThanOrEqual(Math.min(i + 2, 6));
    }
    await expect(app.playButton).toBeVisible();
    await expect(app.notice).toContainText('Can’t reach YouTube right now');
    expect(scriptLoads, 'each retry re-created the player (1 + 5 attempts)').toBe(6);
  });

  test('a connectivity blip while a song plays changes nothing (same player, no banner)', async ({ app, context, page }) => {
    await app.open();
    await app.searchAndPlayFirst('coldplay yellow');
    const players = await app.ytInstanceCount();
    await context.setOffline(true);
    await page.waitForTimeout(1500); // proving that nothing happens needs real time
    await expect(app.waitingBanner).toBeHidden();
    await expect(app.pauseButton).toBeVisible();
    expect(await app.ytState()).toBe(1);
    await context.setOffline(false);
    await page.waitForTimeout(1000);
    expect(await app.ytInstanceCount(), 'the playing stream is never re-created').toBe(players);
    expect(await app.ytState()).toBe(1);
    await expect(app.waitingBanner).toBeHidden();
  });

  test('a stream stuck buffering while offline waits for the network and resumes when it is back', async ({ app, context, page }) => {
    await page.clock.install();
    await app.open();
    await app.searchAndPlayFirst('coldplay yellow');
    const players = await app.ytInstanceCount();
    await context.setOffline(true);
    await app.ytDo('stall');
    await page.clock.fastForward(5_000);
    await expect(app.waitingBanner, 'a short stall is not a network problem yet').toBeHidden();
    await page.clock.fastForward(4_000);
    await expect(app.waitingBanner).toBeVisible();
    await expect(app.pauseButton).toBeVisible();
    await context.setOffline(false);
    await expect.poll(() => app.ytInstanceCount()).toBe(players + 1);
    await expect.poll(() => app.ytState()).toBe(1);
    await expect(app.waitingBanner).toBeHidden();
  });
});
