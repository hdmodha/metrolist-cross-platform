/**
 * Motion: the rest of the suite runs with `reducedMotion: 'reduce'` (see playwright.config.ts), so this
 * spec turns animation back on and checks that elements animate out and unmount, that the page
 * wrapper keeps no transform, that covers fade in, and that reduced motion removes the wait.
 */
import { expect, test, type MetrolistApp } from './fixtures/test';

async function playSomething(app: MetrolistApp): Promise<void> {
  await app.open();
  await app.searchAndPlayFirst('daft punk');
}

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('Now Playing slides in, and is gone once the exit animation has finished', async ({ app }) => {
    await playSomething(app);
    await app.openNowPlaying();
    await expect(app.nowPlaying).toBeVisible();
    await expect(app.nowPlaying).toHaveAttribute('data-state', 'open');
    await app.nowPlaying.getByRole('button', { name: 'Close Now Playing' }).click();
    // The real state is closed at once (inert), the element leaves after its animation
    await expect(app.nowPlaying).toHaveCount(0);
    await expect(app.page.locator('.scrim')).toHaveCount(0);
    await expect(app.page.locator('button[aria-label="Open Now Playing"]:visible')).toBeVisible();
  });

  test('the queue sheet animates out and unmounts', async ({ app }) => {
    await playSomething(app);
    await app.openQueue();
    await expect(app.queue).toHaveAttribute('data-state', 'open');
    await app.queue.getByRole('button', { name: 'Close queue' }).click();
    await expect(app.queue).toHaveCount(0);
  });

  test('a page change ends with a page wrapper that has no transform', async ({ app }) => {
    await app.open();
    await app.goTo('Library');
    const wrapper = app.main.locator('[data-page-transition]');
    await expect(wrapper).toHaveCount(1);
    await expect.poll(() => wrapper.evaluate((el) => el.getAnimations().length)).toBe(0);
    expect(await wrapper.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    await expect(app.heading).toHaveText('Your Library');
  });

  test('covers fade in once loaded', async ({ app }) => {
    await app.open();
    await app.search('daft punk');
    await expect(app.resultRows().first()).toBeVisible();
    const cover = app.results.locator('.art > img').first();
    await expect(cover).toHaveAttribute('data-loaded', '');
    await expect(cover).toHaveCSS('opacity', '1');
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('closing Now Playing removes the dialog without waiting', async ({ app }) => {
    await playSomething(app);
    await app.openNowPlaying();
    await app.nowPlaying.getByRole('button', { name: 'Close Now Playing' }).click();
    await expect(app.nowPlaying).toHaveCount(0, { timeout: 250 });
  });
});
