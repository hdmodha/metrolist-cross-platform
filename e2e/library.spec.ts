/** Liked Songs, Downloads and the Library page. */
import { expect, test } from './fixtures/test';
import { songs, v2Storage } from './fixtures/storage';

test.describe('library', () => {
  test('liking and downloading from the menu and the heart fill the right pages, newest first', async ({ app, page }) => {
    await app.open();
    await app.search('daft punk');
    await expect(app.resultRows()).toHaveCount(12);
    const first = await app.chooseFromTrackMenu(app.results, 1, 'Like');
    await expect(app.notice).toContainText('Added to Liked Songs');
    const second = await app.chooseFromTrackMenu(app.results, 4, 'Like');
    const downloaded = await app.chooseFromTrackMenu(app.results, 2, 'Download');
    await expect(app.notice).toContainText('Added to Downloads');
    // The menu now offers the opposite action
    await app.results.locator('button[aria-label^="More options for "]').nth(1).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Play next', 'Add to queue', 'Unlike', 'Download', 'Go to artist']);
    await page.keyboard.press('Escape');

    // The heart on the player likes the playing song
    const playing = await app.titleOf(app.resultRows().nth(6));
    await app.resultRows().nth(6).click();
    await app.showControls();
    await page.locator('button[aria-label="Save to Liked Songs"]:visible').last().click();
    await expect(page.locator('button[aria-label="Remove from Liked Songs"]:visible').last()).toBeVisible();
    await app.closeNowPlaying();

    await app.openCollection('Liked Songs');
    await expect.poll(() => app.titlesIn(app.main)).toEqual([playing, second, first]);
    await expect(app.main).toContainText('3 songs');
    await app.openCollection('Downloads');
    await expect.poll(() => app.titlesIn(app.main)).toEqual([downloaded]);

    // Unliking from the menu removes it
    await app.openCollection('Liked Songs');
    await app.chooseFromTrackMenu(app.main, 1, 'Unlike');
    await expect.poll(() => app.titlesIn(app.main)).toEqual([playing, first]);
    await expect(app.notice).toContainText('Removed from Liked Songs');

    if (app.isDesktop) {
      const shortcuts = page.getByRole('navigation', { name: 'Your Library' });
      await expect(shortcuts.getByRole('link', { name: /Liked Songs/ })).toContainText('2 songs');
      await expect(shortcuts.getByRole('link', { name: /Downloads/ })).toContainText('1 song');
    }
  });

  test('Play and Shuffle on Liked Songs', async ({ app, page }) => {
    const liked = songs('liked mix', 6);
    await app.open({ storage: v2Storage({ liked, autoplayRadio: false }) });
    await app.openCollection('Liked Songs');
    await app.main.getByRole('button', { name: 'Play Liked Songs' }).click();
    await expect.poll(() => app.ytState()).toBe(1);
    await expect(app.currentTitle).toHaveText(liked[0].title);
    await expect(app.main.getByRole('button', { name: 'Pause Liked Songs' })).toBeVisible();
    await app.openQueue();
    await expect.poll(() => app.upcomingTitles()).toEqual(liked.slice(1).map((t) => t.title));
    await expect(app.nowPlaying).toContainText('Liked Songs');
    await app.closeNowPlaying();

    await app.main.getByRole('button', { name: 'Pause Liked Songs' }).click();
    await expect.poll(() => app.ytState()).toBe(2);

    await app.main.getByRole('button', { name: 'Shuffle Liked Songs' }).click();
    await expect.poll(() => app.ytState()).toBe(1);
    await app.showControls();
    await expect(app.shuffleButton).toHaveAttribute('aria-pressed', 'true');
    await app.openQueue();
    const queue = await app.queueTitles();
    const titles = liked.map((t) => t.title);
    expect(queue.length, 'the whole list is queued (a song that just played stays in the history)').toBeGreaterThanOrEqual(liked.length - 1);
    for (const title of queue) expect(titles).toContain(title);
    await expect(page.locator('[data-current-title]:visible').last()).toHaveText(queue[0]);
  });

  test('Downloads explains that its songs still need a connection; empty pages point to Search', async ({ app }) => {
    await app.open();
    await app.openCollection('Downloads');
    await expect(app.main).toContainText('Songs in Downloads still need an internet connection to play.');
    await expect(app.main.getByText('Songs you download will appear here')).toBeVisible();
    await app.main.getByRole('button', { name: 'Find songs' }).click();
    await expect(app.heading).toHaveText('Search');

    await app.openCollection('Liked Songs');
    await expect(app.main.getByText('Songs you like will appear here')).toBeVisible();
    await expect(app.main).not.toContainText('internet connection');
    await expect(app.main.getByRole('button', { name: 'Play Liked Songs' })).toHaveCount(0);
  });

  test('Library lists recently played songs; a row plays and continues through the list', async ({ app }) => {
    const recent = songs('recent picks', 4);
    await app.open({ storage: v2Storage({ recent, autoplayRadio: false }) });
    await app.goTo('Library');
    const list = app.main.getByRole('list', { name: 'Recently played' });
    await expect.poll(() => app.titlesIn(list)).toEqual(recent.map((t) => t.title));
    await app.songButtons(list).nth(1).click();
    await expect.poll(() => app.ytState()).toBe(1);
    await expect(app.currentTitle).toHaveText(recent[1].title);
    await app.openQueue();
    await expect.poll(() => app.upcomingTitles()).toEqual([recent[2].title, recent[3].title]);
  });
});
