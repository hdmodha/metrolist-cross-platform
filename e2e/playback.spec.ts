import { expect, test, type MetrolistApp } from './fixtures/test';

/** Autoplay Radio off: the queue holds exactly what the listener picked. */
async function radioOff(app: MetrolistApp): Promise<void> {
  await app.page.locator('button[aria-label="Autoplay Radio on"]').click();
  await expect(app.page.locator('button[aria-label="Autoplay Radio off"]')).toBeVisible();
}

test.describe('playback', () => {
  test('play, pause and seek control the stream', async ({ app }) => {
    await app.open();
    const title = await app.searchAndPlayFirst('coldplay yellow');
    await expect(app.heroTitle).toHaveText(title);
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
    await app.resultCards().first().click();
    const prompt = app.page.getByText('Tap the player below to start playback');
    await expect(prompt).toBeVisible({ timeout: 12_000 });
    expect(await app.seekValue()).toBe(0);
    await app.ytDo('userTap');
    await expect(prompt).toBeHidden();
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
    await expect(app.heroTitle).toHaveText(first);
    await expect.poll(() => app.ytState()).toBe(1);
    await app.ytDo('endSong');
    await expect(app.heroTitle).toHaveText(second);
  });

  test('Next and Previous move through the queue; Previous mid-song restarts it', async ({ app }) => {
    await app.open();
    const song = await app.searchAndPlayFirst('daft punk');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThanOrEqual(1);
    const [next] = await app.upcomingTitles();
    await app.nextButton.click();
    await expect(app.heroTitle).toHaveText(next);
    await app.previousButton.click();
    await expect(app.heroTitle).toHaveText(song);
    await expect.poll(() => app.ytState()).toBe(1);
    await app.ytDo('seekTo', '40');
    await expect.poll(() => app.seekValue()).toBeGreaterThan(39_000);
    await app.previousButton.click();
    await expect(app.heroTitle).toHaveText(song);
    await expect.poll(async () => (await app.yt())?.time ?? 99).toBeLessThan(3);
  });

  test('repeat off stops at the end of the queue, repeat all wraps, repeat one replays', async ({ app }) => {
    await app.open();
    await radioOff(app);
    const song = await app.searchAndPlayFirst('nightcall');
    await app.openQueue();
    const repeat = app.drawer.getByRole('button', { name: /^Repeat/ });

    await expect(repeat).toHaveText('Repeat off');
    await app.ytDo('endSong');
    await expect(app.playButton).toBeVisible();
    await expect(app.heroTitle).toHaveText(song);

    await app.playButton.click();
    await repeat.click();
    await expect(repeat).toHaveText('Repeat all');
    await expect.poll(() => app.ytState()).toBe(1);
    await app.ytDo('endSong');
    await expect.poll(async () => (await app.yt())?.time ?? 99).toBeLessThan(5);
    await expect(app.pauseButton).toBeVisible();

    await repeat.click();
    await expect(repeat).toHaveText('Repeat one');
    await app.ytDo('endSong');
    await expect.poll(async () => (await app.yt())?.time ?? 99).toBeLessThan(5);
    await expect(app.heroTitle).toHaveText(song);
    await expect.poll(() => app.ytState()).toBe(1);
  });

  test('shuffle never repeats the current song on Next and visits several songs', async ({ app }) => {
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThanOrEqual(5);
    await app.drawer.getByRole('button', { name: 'Shuffle' }).click();
    const seen = new Set<string>();
    let previous = await app.heroTitle.textContent();
    for (let i = 0; i < 4; i++) {
      await app.nextButton.click();
      await expect(app.heroTitle).not.toHaveText(previous ?? '');
      previous = await app.heroTitle.textContent();
      seen.add(previous ?? '');
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });

  test('library songs play, continue through the list and stop at the end of the queue', async ({ app }) => {
    await app.open();
    const broken = await app.page.evaluate(() =>
      Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0 && i.src.includes(location.host)).map((i) => i.src)
    );
    expect(broken, 'built-in artwork loads').toEqual([]);
    await radioOff(app);
    const count = await app.libraryRows.count();
    const last = (await app.libraryRows.nth(count - 1).locator('.font-semibold').textContent()) ?? '';
    const beforeLast = (await app.libraryRows.nth(count - 2).locator('.font-semibold').textContent()) ?? '';
    await app.libraryRows.nth(count - 2).click();
    await expect(app.heroTitle).toHaveText(beforeLast);
    await expect.poll(() => app.seekValue()).toBeGreaterThan(0);

    const end = async () => app.seekBar.fill(String(Number(await app.seekBar.getAttribute('max')) - 2000)); // a multiple of the 1 s step
    await end();
    await expect(app.heroTitle).toHaveText(last);
    await end();
    await expect(app.playButton).toBeVisible();
    await expect(app.heroTitle).toHaveText(last);
  });

  test('Space toggles playback and the arrow keys seek by 5 seconds', async ({ app }) => {
    await app.open();
    await app.heroTitle.click();
    await app.page.keyboard.press('Space');
    await expect(app.pauseButton).toBeVisible();
    await app.page.keyboard.press('Space');
    await expect(app.playButton).toBeVisible();
    const before = await app.seekValue();
    await app.page.keyboard.press('ArrowRight');
    await expect.poll(() => app.seekValue()).toBe(before + 5000);
    await app.page.keyboard.press('ArrowLeft');
    await expect.poll(() => app.seekValue()).toBe(before);
    // Never while typing in the search box
    await app.searchInput.click();
    await app.page.keyboard.press('Space');
    await expect(app.playButton).toBeVisible();
  });
});
