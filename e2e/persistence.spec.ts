import { expect, test } from './fixtures/test';
import { V1_KEY, V2_KEY, songs, v1Storage } from './fixtures/storage';

test.describe('persistence', () => {
  test('likes, downloads, history and player preferences survive a restart', async ({ app, page }) => {
    await app.open();
    const liked = await app.searchAndPlayFirst('daft punk one more time');
    await app.showControls();
    await page.locator('button[aria-label="Save to Liked Songs"]:visible').last().click();
    await expect(page.locator('button[aria-label="Remove from Liked Songs"]:visible').last()).toBeVisible();
    await app.shuffleButton.click();
    await app.repeatButton.click();
    await app.openQueue();
    await app.autoplaySwitch.click();
    await app.closeNowPlaying();
    const downloaded = await app.chooseFromTrackMenu(app.results, 3, 'Download');

    await page.reload();
    await expect(app.main).toBeVisible();
    await app.showControls();
    await expect(app.shuffleButton).toHaveAttribute('aria-pressed', 'true');
    await expect(app.repeatButton).toHaveAttribute('aria-label', 'Repeat: all');
    await app.openQueue();
    await expect(app.autoplaySwitch).toHaveAttribute('aria-checked', 'false');
    await app.closeNowPlaying();

    await app.openCollection('Liked Songs');
    await expect.poll(() => app.titlesIn(app.main)).toEqual([liked]);
    await app.openCollection('Downloads');
    await expect.poll(() => app.titlesIn(app.main)).toEqual([downloaded]);
    await app.goTo('Library');
    await expect.poll(() => app.titlesIn(app.main.getByRole('list', { name: 'Recently played' }))).toEqual([liked]);
  });

  test('the queue, the song and the position are restored after a restart, paused; Play resumes there', async ({ app, page }) => {
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await app.chooseFromTrackMenu(app.results, 2, 'Play next');
    await app.showControls();
    await app.seekBar.fill('90000');
    await expect.poll(async () => (await app.yt())?.time ?? 0).toBeGreaterThanOrEqual(89);
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThan(5);
    const queueBefore = await app.queueTitles();
    await app.closeQueue();
    await app.pauseButton.click(); // saves at once (playing saves at most every 5 s)

    await page.reload();
    await expect(app.main).toBeVisible();
    await expect(app.currentTitle).toHaveText(queueBefore[0]);
    await expect(app.playButton).toBeVisible();
    await app.openQueue();
    expect(await app.queueTitles()).toEqual(queueBefore);
    await app.closeQueue();
    await app.showControls();
    await expect.poll(() => app.seekValue()).toBeGreaterThanOrEqual(89_000);
    expect(await app.seekValue()).toBeLessThanOrEqual(92_000);
    await expect.poll(async () => (await app.yt())?.time ?? 0).toBeGreaterThanOrEqual(89);
    expect(await app.ytState()).not.toBe(1);

    await app.playButton.click();
    await expect.poll(() => app.ytState()).toBe(1);
    const time = (await app.yt())?.time ?? 0;
    expect(time).toBeGreaterThanOrEqual(89);
    expect(time).toBeLessThan(95);
  });

  test('saved data from the previous version appears as Liked Songs and Downloads after the upgrade', async ({ app, page }) => {
    const [a, b, c, d] = songs('old library', 4);
    await app.open({
      storage: v1Storage([
        { ...a, liked: true },
        { ...b, cachedOffline: true },
        { ...c, liked: true, cachedOffline: true },
        { ...d },
      ]),
    });
    // The old demo song that was playing is gone: nothing is loaded
    await expect(page.locator('[data-current-title]')).toHaveCount(0);
    await expect(app.main).not.toContainText('Night Prism');

    await app.openCollection('Liked Songs');
    await expect.poll(() => app.titlesIn(app.main)).toEqual([a.title, c.title]);
    await app.openCollection('Downloads');
    await expect.poll(() => app.titlesIn(app.main)).toEqual([b.title, c.title]);
    await app.goTo('Home');
    const recent = app.main.locator('section', { has: page.getByRole('heading', { name: 'Recently played' }) });
    await expect.poll(() => app.titlesIn(recent)).toEqual([a.title, b.title, c.title, d.title]);

    // Migrated once: v2 is stored, v1 is gone, and a reload still shows the library
    expect(await page.evaluate(([v1, v2]) => [!!localStorage.getItem(v1), !!localStorage.getItem(v2)], [V1_KEY, V2_KEY])).toEqual([false, true]);
    await page.reload();
    await app.openCollection('Liked Songs');
    await expect.poll(() => app.titlesIn(app.main)).toEqual([a.title, c.title]);
  });

  test('corrupt saved data starts the app like a fresh install', async ({ app, page }) => {
    await app.open({ storage: { [V2_KEY]: '{"tracks": [1, 2', [V1_KEY]: 'nonsense' } });
    await expect(app.heading).toHaveText(/^Good /);
    await expect(page.locator('[data-current-title]')).toHaveCount(0);
    await app.searchAndPlayFirst('still works');
  });

  test('the app is installable: the manifest and its icons load', async ({ app, page, request }) => {
    await app.open();
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();
    const response = await request.get(href ?? '');
    expect(response.status()).toBe(200);
    const manifest = (await response.json()) as { name?: string; start_url?: string; display?: string; icons?: Array<{ src: string }> };
    expect(manifest.name).toBeTruthy();
    expect(manifest.icons?.length).toBeGreaterThan(0);
    for (const icon of manifest.icons ?? []) {
      expect((await request.get(new URL(icon.src, new URL(href ?? '', page.url())).href)).status(), icon.src).toBe(200);
    }
    for (const sel of ['link[rel="icon"]', 'link[rel="apple-touch-icon"]']) {
      const iconHref = await page.locator(sel).getAttribute('href');
      expect((await request.get(iconHref ?? '')).status(), sel).toBe(200);
    }
  });
});
