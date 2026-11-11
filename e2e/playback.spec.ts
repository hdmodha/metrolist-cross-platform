import { expect, test } from './fixtures/test';
import { songs, v2Storage } from './fixtures/storage';

test.describe('playback', () => {
  test('play, pause and seek control the stream', async ({ app }) => {
    await app.open();
    const title = await app.searchAndPlayFirst('coldplay yellow');
    await expect(app.currentTitle).toHaveText(title);
    await app.showControls();
    await expect.poll(() => app.seekValue()).toBeGreaterThanOrEqual(1000);

    await app.pauseButton.click();
    await expect.poll(() => app.ytState()).toBe(2);
    const frozen = await app.seekValue();
    await app.page.waitForTimeout(1200); // proving that nothing moves needs real time
    expect(await app.seekValue()).toBe(frozen);

    await app.playButton.click();
    await expect.poll(() => app.ytState()).toBe(1);
    await app.seekBar.fill('120000');
    await expect.poll(async () => (await app.yt())?.time ?? 0).toBeGreaterThanOrEqual(119);
    expect((await app.yt())?.time ?? 0).toBeLessThan(126);
  });

  test('blocked autoplay reveals a "tap to start" prompt and the progress never runs without audio', async ({ app }) => {
    await app.open({ yt: { blocked: true } });
    await app.search('kavinsky nightcall');
    await app.resultRows().first().click();
    const prompt = app.page.getByText('Tap the player below to start playback');
    await expect(prompt).toBeVisible({ timeout: 12_000 });
    await app.showControls();
    expect(await app.seekValue()).toBe(0);
    await expect(prompt, 'the prompt stays reachable above Now Playing').toBeVisible();
    await app.ytDo('userTap');
    await expect(prompt).toBeHidden();
    await expect.poll(() => app.ytState()).toBe(1);
  });

  test('a pause while the player is still getting ready is kept: autoplay does not start the song anyway', async ({ app, page }) => {
    await app.open({ yt: { readyDelayMs: 1500 } });
    await app.search('slow network song');
    await app.resultRows().first().click();
    await app.showControls();
    await app.pauseButton.click();
    await expect(app.playButton).toBeVisible();
    await page.waitForTimeout(2500); // the player becomes ready (and would autoplay) meanwhile
    await expect(app.playButton).toBeVisible();
    expect(await app.ytState()).not.toBe(1);
    await app.playButton.click();
    await expect.poll(() => app.ytState()).toBe(1);
  });

  test('a pause from outside the app (headset, OS media key) is reflected in the UI', async ({ app }) => {
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await app.ytDo('externalPause');
    await expect(app.playButton).toBeVisible();
  });

  test('when a song ends the next song in the queue plays', async ({ app }) => {
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThanOrEqual(3);
    const [first, second] = await app.upcomingTitles();
    await app.ytDo('endSong');
    await expect(app.currentTitle).toHaveText(first);
    await expect.poll(() => app.ytState()).toBe(1);
    await app.ytDo('endSong');
    await expect(app.currentTitle).toHaveText(second);
  });

  test('Next and Previous move through the queue; Previous mid-song restarts it', async ({ app }) => {
    await app.open();
    const song = await app.searchAndPlayFirst('daft punk');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThanOrEqual(1);
    const [next] = await app.upcomingTitles();
    await app.closeQueue();
    await app.showControls();
    await app.nextButton.click();
    await expect(app.currentTitle).toHaveText(next);
    await app.previousButton.click();
    await expect(app.currentTitle).toHaveText(song);
    await expect.poll(() => app.ytState()).toBe(1);
    await app.ytDo('seekTo', '40');
    await expect.poll(() => app.seekValue()).toBeGreaterThan(39_000);
    await app.previousButton.click();
    await expect(app.currentTitle).toHaveText(song);
    await expect.poll(async () => (await app.yt())?.time ?? 99).toBeLessThan(3);
  });

  test('repeat off stops at the end of the queue, repeat all wraps, repeat one replays', async ({ app }) => {
    await app.open({ storage: v2Storage({ autoplayRadio: false }) });
    const song = await app.searchAndPlayFirst('nightcall');
    await app.showControls();
    const repeat = app.repeatButton;

    await expect(repeat).toHaveAttribute('aria-label', 'Repeat: off');
    await app.ytDo('endSong');
    await expect(app.playButton).toBeVisible();
    await expect(app.currentTitle).toHaveText(song);

    await app.playButton.click();
    await repeat.click();
    await expect(repeat).toHaveAttribute('aria-label', 'Repeat: all');
    await expect.poll(() => app.ytState()).toBe(1);
    await app.ytDo('endSong');
    await expect.poll(async () => (await app.yt())?.time ?? 99).toBeLessThan(5);
    await expect(app.pauseButton).toBeVisible();

    await repeat.click();
    await expect(repeat).toHaveAttribute('aria-label', 'Repeat: one');
    await app.ytDo('endSong');
    await expect.poll(async () => (await app.yt())?.time ?? 99).toBeLessThan(5);
    await expect(app.currentTitle).toHaveText(song);
    await expect.poll(() => app.ytState()).toBe(1);
    await repeat.click();
    await expect(repeat).toHaveAttribute('aria-label', 'Repeat: off');
  });

  test('shuffle never repeats the current song on Next and visits several songs', async ({ app }) => {
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThanOrEqual(5);
    await app.closeQueue();
    await app.showControls();
    await app.shuffleButton.click();
    await expect(app.shuffleButton).toHaveAttribute('aria-pressed', 'true');
    const seen = new Set<string>();
    let previous = await app.currentTitle.textContent();
    for (let i = 0; i < 4; i++) {
      await app.nextButton.click();
      await expect(app.currentTitle).not.toHaveText(previous ?? '');
      previous = await app.currentTitle.textContent();
      seen.add(previous ?? '');
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  test('list songs play, continue through the list and stop at the end of the queue', async ({ app }) => {
    const liked = songs('three liked', 3);
    await app.open({ storage: v2Storage({ liked, autoplayRadio: false }) });
    await app.openCollection('Liked Songs');
    await app.songButtons(app.main.getByRole('list', { name: 'Liked Songs' })).nth(1).click();
    await expect.poll(() => app.ytState()).toBe(1);
    await expect(app.currentTitle).toHaveText(liked[1].title);
    // The playing row is highlighted
    await expect(app.main.locator('button[aria-current="true"] .song-title')).toHaveText(liked[1].title);
    await expect(app.main.locator('button[aria-current="true"]')).toHaveAttribute('aria-label', `Pause ${liked[1].title} by ${liked[1].artist}`);

    await app.ytDo('endSong');
    await expect(app.currentTitle).toHaveText(liked[2].title);
    await expect.poll(() => app.ytState()).toBe(1);
    await app.ytDo('endSong');
    await expect(app.playButton).toBeVisible();
    await expect(app.currentTitle).toHaveText(liked[2].title);
  });

  test('Space toggles playback and the arrow keys seek by 5 seconds (never while typing)', async ({ app, page }) => {
    const queue = songs('keyboard', 2);
    await app.open({ storage: v2Storage({ queue, recent: queue }) });
    await app.showControls();
    await page.locator('[data-current-title]:visible').last().click({ force: true });
    if (!app.isDesktop) await expect(app.nowPlaying, 'tapping the title keeps Now Playing open').toBeVisible();
    await page.keyboard.press('Space');
    await expect(app.pauseButton).toBeVisible();
    await page.keyboard.press('Space');
    await expect(app.playButton).toBeVisible();
    const before = await app.seekValue();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => app.seekValue()).toBe(before + 5000);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => app.seekValue()).toBe(before);

    await app.closeNowPlaying();
    await app.goTo('Search');
    await app.searchInput.click();
    await page.keyboard.press('Space');
    await expect(app.playButton).toBeVisible();
  });
});
