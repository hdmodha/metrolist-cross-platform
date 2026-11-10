/** The mini player / player bar and the full-screen Now Playing view. */
import { expect, test, type MetrolistApp } from './fixtures/test';

async function playSomething(app: MetrolistApp): Promise<string> {
  await app.open();
  return app.searchAndPlayFirst('daft punk');
}

/** Dispatches a touch drag on `selector` (pointer events, like a finger). */
async function swipe(app: MetrolistApp, selector: string, dy: number, durationMs: number): Promise<void> {
  await app.page.evaluate(
    async ({ selector, dy, durationMs }) => {
      const el = document.querySelector(selector) as HTMLElement;
      const box = el.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + Math.min(40, box.height / 2);
      const fire = (target: EventTarget, type: string, clientY: number) =>
        target.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY, bubbles: true, cancelable: true }));
      fire(el, 'pointerdown', y);
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        await new Promise((resolve) => setTimeout(resolve, durationMs / steps));
        fire(el, 'pointermove', y + (dy * i) / steps);
      }
      fire(el, 'pointerup', y + dy);
    },
    { selector, dy, durationMs }
  );
}

test.describe('Now Playing', () => {
  test('the docked player opens Now Playing; it is a labelled modal dialog that takes focus', async ({ app, page }) => {
    const title = await playSomething(app);
    await expect(app.currentTitle).toHaveText(title);
    if (app.isDesktop) {
      await expect(app.playerBar).toBeVisible();
    } else {
      await expect(app.miniPlayer).toBeVisible();
      await expect(app.miniPlayer.locator('[data-current-title]')).toHaveText(title);
    }

    await page.locator('button[aria-label="Open Now Playing"]:visible').click();
    await expect(app.nowPlaying).toBeVisible();
    await expect(app.nowPlaying).toHaveAttribute('aria-modal', 'true');
    await expect(app.nowPlaying.getByRole('button', { name: 'Close Now Playing' })).toBeFocused();
    await expect(app.nowPlaying.locator('[data-current-title]')).toHaveText(title);
    await expect(app.nowPlaying).toContainText('Playing from');
    await expect(app.nowPlaying).toContainText('Search');
    // The page behind is inert while the dialog is open
    expect(await page.evaluate(() => (document.querySelector('main')?.closest('[inert]') ? 'inert' : 'live'))).toBe('inert');

    await app.nowPlaying.getByRole('button', { name: 'Close Now Playing' }).click();
    await expect(app.nowPlaying).toHaveCount(0);
    await expect(page.locator('button[aria-label="Open Now Playing"]:visible')).toBeFocused();
  });

  test('a tap on the mini player’s buttons does not open Now Playing', async ({ app, page }) => {
    test.skip(app.isDesktop, 'phones and tablets');
    await playSomething(app);
    await app.miniPlayer.getByRole('button', { name: 'Pause Playback' }).click();
    await expect.poll(() => app.ytState()).toBe(2);
    await app.miniPlayer.getByRole('button', { name: 'Save to Liked Songs' }).click();
    await expect(app.miniPlayer.getByRole('button', { name: 'Remove from Liked Songs' })).toBeVisible();
    await expect(app.nowPlaying).toHaveCount(0);
    // Tapping the song itself does
    await app.miniPlayer.locator('[data-current-title]').click({ force: true });
    await expect(app.nowPlaying).toBeVisible();
    await expect(page.locator('[role="dialog"] button[aria-label="Start Playback"]')).toBeVisible();
  });

  test('Escape closes it', async ({ app, page }) => {
    await playSomething(app);
    await app.openNowPlaying();
    await page.keyboard.press('Escape');
    await expect(app.nowPlaying).toHaveCount(0);
  });

  test('Back closes it; the chevron leaves no stale history entry behind', async ({ app, page }) => {
    await playSomething(app);
    const hash = await app.hash();
    const entries = await page.evaluate(() => history.length);
    await app.openNowPlaying();
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
    expect(await app.hash(), 'same page underneath').toBe(hash);
    await page.goBack();
    await expect(app.nowPlaying).toHaveCount(0);
    expect(await app.hash()).toBe(hash);

    // Forward re-opens it; the chevron then removes the entry again
    await page.goForward();
    await expect(app.nowPlaying).toBeVisible();
    await app.closeNowPlaying();
    await expect.poll(() => page.evaluate(() => (history.state as { nowPlaying?: boolean } | null)?.nowPlaying ?? false)).toBe(false);
    // Back now goes to the previous page (empty Search), not to a dead Now Playing entry
    await page.goBack();
    await expect(app.nowPlaying).toHaveCount(0);
    expect(await app.hash()).toBe('#/search');
  });

  test('a downward swipe closes it; a short drag or scrolling the queue does not', async ({ app }) => {
    test.skip(app.isDesktop, 'touch screens');
    await playSomething(app);
    await app.openNowPlaying();
    const art = '[role="dialog"] .art-box';
    await swipe(app, art, 60, 400);
    await expect(app.nowPlaying).toBeVisible();
    await expect.poll(() => app.nowPlaying.evaluate((el) => (el as HTMLElement).style.transform)).toBe('');

    await app.openQueue();
    await swipe(app, '[role="dialog"] section[aria-label="Queue"] ul', 300, 300);
    await expect(app.nowPlaying).toBeVisible();
    await app.queue.getByRole('button', { name: 'Close queue' }).click();

    await swipe(app, art, 200, 250);
    await expect(app.nowPlaying).toHaveCount(0);
    await expect(app.miniPlayer).toBeVisible();

    // A fast flick is enough too
    await app.openNowPlaying();
    await swipe(app, art, 70, 60);
    await expect(app.nowPlaying).toHaveCount(0);
  });

  test('the ⋮ menu acts on the playing song; "Go to artist" closes Now Playing and opens Search', async ({ app, page }) => {
    await playSomething(app);
    await app.openNowPlaying();
    const items = await (async () => {
      await app.nowPlaying.locator('button[aria-label^="More options for "]').click();
      return page.getByRole('menuitem').allTextContents();
    })();
    expect(items).toEqual(['Play next', 'Add to queue', 'Like', 'Download', 'Go to artist']);
    await page.getByRole('menuitem', { name: 'Go to artist' }).click();
    await expect(app.nowPlaying).toHaveCount(0);
    await expect(app.searchInput).toHaveValue('Daft');
    expect(await app.hash()).toBe('#/search?q=Daft');
    // Back returns to where Now Playing was opened from (its entry was replaced, not stacked on)
    await page.goBack();
    expect(await app.hash()).toBe('#/search?q=daft%20punk');
    await expect(app.nowPlaying).toHaveCount(0);
  });
});
