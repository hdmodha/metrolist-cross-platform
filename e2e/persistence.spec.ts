import { expect, test } from './fixtures/test';

test.describe('persistence', () => {
  test('likes, the library and player preferences survive a restart', async ({ app, page }) => {
    await app.open();
    const liked = await app.searchAndPlayFirst('daft punk one more time');
    await page.locator('button[aria-label="Save to Liked Songs"]').click();
    await expect(page.locator('button[aria-label="Remove from Liked Songs"]')).toBeVisible();
    await app.openQueue();
    await app.drawer.getByRole('button', { name: 'Shuffle' }).click();
    await app.drawer.getByRole('button', { name: /^Repeat/ }).click();
    await page.locator('button[aria-label="Autoplay Radio on"]').click();

    await page.reload();
    await expect(app.footer).toBeVisible();
    await expect(page.locator('button[aria-label="Autoplay Radio off"]')).toBeVisible();
    await app.openQueue();
    await expect(app.drawer.getByRole('button', { name: 'Shuffle' })).toHaveAttribute('aria-pressed', 'true');
    await expect(app.drawer.getByRole('button', { name: /^Repeat/ })).toHaveText('Repeat all');
    const filters = page.getByRole('navigation', { name: 'Primary Library Filter Navigation' });
    await filters.getByRole('button', { name: /Liked/ }).click();
    await expect(app.libraryRows.locator('.font-semibold')).toHaveText([liked, /.+/, /.+/, /.+/]);
    // Played songs are listed first in the library
    await filters.getByRole('button', { name: /Home/ }).click();
    await expect(app.libraryRows.first().locator('.font-semibold')).toHaveText(liked);
  });

  test('the queue, the song and the position are restored after a restart, paused; Play resumes there', async ({ app, page }) => {
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await app.chooseFromTrackMenu(app.results, 2, 'Play next');
    await app.seekBar.fill('90000');
    await expect.poll(async () => (await app.yt())?.time ?? 0).toBeGreaterThanOrEqual(89);
    await app.openQueue();
    await expect.poll(async () => (await app.queueTitles()).length).toBeGreaterThan(5);
    const queueBefore = await app.queueTitles();
    const songBefore = await app.heroTitle.textContent();
    await app.pauseButton.click(); // saves at once (playing saves at most every 5 s)

    await page.reload();
    await expect(app.footer).toBeVisible();
    await app.openQueue();
    await expect(app.heroTitle).toHaveText(songBefore ?? '');
    expect(await app.queueTitles()).toEqual(queueBefore);
    await expect(app.playButton).toBeVisible();
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
