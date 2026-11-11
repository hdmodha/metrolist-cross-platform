import { fixtureVideoId } from './fixtures/apiFixtures';
import { defaultSearch, expect, test } from './fixtures/test';

const YOUTUBE_API = 'https://www.youtube.com/iframe_api';

test.describe('resilience', () => {
  test('an unplayable upload is replaced by another upload of the same song', async ({ app }) => {
    await app.open();
    const song = await app.searchAndPlayFirst('goo goo dolls iris');
    const original = (await app.yt())?.videoId ?? '';
    await app.ytDo('reloadSameVideo', original); // YouTube now refuses this upload (error 150)
    await expect.poll(async () => (await app.yt())?.videoId).not.toBe(original);
    await expect.poll(() => app.ytState()).toBe(1);
    await expect(app.currentTitle).toHaveText(song);
  });

  test('the next song plays even when it is the very upload the previous song fell back to', async ({ app }) => {
    await app.open();
    const song = await app.searchAndPlayFirst('goo goo dolls iris');
    const original = (await app.yt())?.videoId ?? '';
    // Queue the song whose own upload will become the alternate of the playing one
    await app.search('Goo Goo Goo Dolls Iris');
    await expect(app.resultRows().first()).toContainText('Goo Goo Goo Dolls Iris');
    const next = await app.chooseFromTrackMenu(app.results, 0, 'Add to queue');
    expect(next).not.toBe(song);
    await app.ytDo('reloadSameVideo', original);
    await expect.poll(async () => (await app.yt())?.videoId).toBe(fixtureVideoId('search:goo goo goo dolls iris:0'));
    await expect.poll(() => app.ytState()).toBe(1);

    await app.ytDo('endSong');
    await expect(app.currentTitle).toHaveText(next);
    await expect.poll(() => app.ytState(), { message: 'the same video is restarted, not left ended' }).toBe(1);
  });

  test('songs that cannot be played are skipped, and three failures in a row stop playback', async ({ app }) => {
    await app.open({ yt: { errorIds: ['*'] } });
    await app.search('broken uploads');
    const first = await app.titleOf(app.resultRows().first());
    await app.resultRows().first().click();
    await expect(app.notice).toContainText('Several songs in a row could not be played', { timeout: 20_000 });
    await expect(app.playButton).toBeVisible();
    await expect(app.currentTitle).not.toHaveText(first);
  });

  test('an upcoming song its owner keeps off other apps gets another upload before it is reached', async ({ app, api }) => {
    const blocked = fixtureVideoId('search:queen bohemian:2');
    const alternate = fixtureVideoId('search:queen queen bohemian part 3:0');
    api.embeddable = (id) => id !== blocked;
    await app.open();
    await app.searchAndPlayFirst('queen bohemian');
    const queued = await app.chooseFromTrackMenu(app.results, 2, 'Add to queue');
    expect(queued).toBe('Queen Bohemian Part 3');
    // Checked as soon as it is queued, and replaced by the best-matching other upload
    await expect.poll(() => api.embeddableChecks).toContain(blocked);
    await expect.poll(() => api.searches).toContain('Queen Queen Bohemian Part 3');
    await expect.poll(() => api.embeddableChecks).toContain(alternate);

    await app.ytDo('endSong');
    await expect.poll(async () => (await app.yt())?.videoId).toBe(alternate);
    await expect.poll(() => app.ytState()).toBe(1);
    await expect(app.currentTitle).toHaveText(queued);
    expect(await app.ytLoadedVideoIds(), 'the blocked upload is never loaded').not.toContain(blocked);
  });

  test('an upcoming song without another upload is skipped without being loaded, with one notice', async ({ app, api }) => {
    const blocked = fixtureVideoId('search:queen bohemian:2');
    api.embeddable = (id) => id !== blocked;
    api.search = (query) => (query === 'Queen Queen Bohemian Part 3' ? { body: { tracks: [] } } : defaultSearch(query));
    await app.open();
    await app.searchAndPlayFirst('queen bohemian');
    const queued = await app.chooseFromTrackMenu(app.results, 2, 'Add to queue');
    await expect.poll(() => api.searches).toContain('Queen Queen Bohemian Part 3');

    await app.ytDo('endSong');
    await expect(app.notice).toHaveText(`“${queued}” can’t be played outside YouTube: its owner turned that off. Skipped.`);
    await expect(app.currentTitle).not.toHaveText(queued);
    await expect.poll(() => app.ytState()).toBe(1);
    expect(await app.ytLoadedVideoIds()).not.toContain(blocked);
  });

  test('a search result found to be blocked while it starts is replaced at play time', async ({ app, api }) => {
    const blocked = fixtureVideoId('search:daft punk one more time:0');
    const alternate = fixtureVideoId('search:daft daft punk one more time:0');
    api.embeddable = (id) => id !== blocked;
    await app.open();
    const song = await app.searchAndPlayFirst('daft punk one more time');
    await expect.poll(async () => (await app.yt())?.videoId).toBe(alternate);
    await expect.poll(() => app.ytState()).toBe(1);
    await expect(app.currentTitle).toHaveText(song);
  });

  test('YouTube unreachable: the app waits and retries, then resumes on its own when it is back', async ({ app, page }) => {
    await page.route(YOUTUBE_API, (route) => route.abort());
    await app.open();
    await app.search('kavinsky nightcall');
    await app.resultRows().first().click();
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
    await app.resultRows().first().click();
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
