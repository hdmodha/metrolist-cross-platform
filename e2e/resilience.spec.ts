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

  test('a late error of the previous song (it arrives after the switch) leaves the new song alone', async ({ app, api, page }) => {
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThanOrEqual(1);
    const [next] = await app.upcomingTitles();
    await app.closeQueue();
    const searchesBefore = api.searches.length;
    // The player still reports the old video when its error 150 arrives, after the switch to `next`
    await page.evaluate(() => {
      (window as unknown as { __yt: { lateErrorOnSwitch: boolean } }).__yt.lateErrorOnSwitch = true;
    });
    await app.showControls();
    await app.nextButton.click();
    await expect(app.currentTitle).toHaveText(next);
    await expect.poll(() => app.ytState()).toBe(1);
    const playing = (await app.yt())?.videoId;
    await page.waitForTimeout(1200);
    expect((await app.yt())?.videoId, 'the new song keeps its own upload').toBe(playing);
    expect(api.searches.slice(searchesBefore), 'no other upload is searched for').toEqual([]);
    await expect(app.currentTitle).toHaveText(next);
    await expect(app.notice).toHaveCount(0);
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

  test('a song found unplayable shows as unavailable in the search results; a tap explains it and does not start it', async ({ app, api }) => {
    const blocked = fixtureVideoId('search:queen bohemian:2');
    api.embeddable = (id) => id !== blocked;
    api.search = (query) => (query === 'Queen Queen Bohemian Part 3' ? { body: { tracks: [] } } : defaultSearch(query));
    await app.open();
    await app.searchAndPlayFirst('queen bohemian');
    const queued = await app.chooseFromTrackMenu(app.results, 2, 'Add to queue');
    await expect.poll(() => api.searches).toContain('Queen Queen Bohemian Part 3');

    const row = app.resultRows().nth(2);
    await expect(row).toContainText('Unavailable');
    await expect(row).toHaveAttribute('aria-label', /Unavailable: Its owner doesn’t allow playback outside YouTube/);
    await expect(row.locator('.song-title')).toHaveText(queued);
    await expect(app.resultRows().nth(1)).not.toContainText('Unavailable');
    expect(await row.locator('span.opacity-50').count(), 'the song is dimmed').toBeGreaterThan(0);

    const playing = await app.currentTitle.textContent();
    await row.click();
    await expect(app.notice).toHaveText(`“${queued}” can’t be played outside YouTube: its owner turned that off.`);
    await expect(app.currentTitle).toHaveText(playing ?? '');
    expect(await app.ytLoadedVideoIds()).not.toContain(blocked);

    // The queue marks it too (it will be jumped over)
    await app.openQueue();
    const queuedRow = app.queue.locator('ul[aria-label="Next up"] li').filter({ hasText: queued });
    await expect(queuedRow).toContainText('Unavailable');
    await expect(queuedRow.getByRole('button', { name: /Unavailable: Its owner doesn’t allow playback outside YouTube/ })).toBeVisible();
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
    // The idle warm-up of the API script loads it once before any play: let it run, then count from the play
    await page.clock.runFor(4000);
    await expect.poll(() => scriptLoads).toBe(1);
    scriptLoads = 0;
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
