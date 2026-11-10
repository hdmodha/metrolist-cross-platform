import { radioPage, fixtureVideoId } from './fixtures/apiFixtures';
import { expect, test } from './fixtures/test';

test.describe('queue', () => {
  test('"Play next" goes ahead of songs queued earlier; "Add to queue" goes after them', async ({ app }) => {
    await app.open();
    const current = await app.searchAndPlayFirst('daft punk');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThanOrEqual(4);

    const queued = await app.chooseFromTrackMenu(app.results, 3, 'Add to queue');
    await expect(app.notice).toContainText(`Added “${queued}” to your queue`);
    const next = await app.chooseFromTrackMenu(app.results, 4, 'Play next');
    await expect(app.notice).toContainText('will play next');
    const queued2 = await app.chooseFromTrackMenu(app.results, 5, 'Add to queue');

    await expect.poll(async () => (await app.upcomingTitles()).slice(0, 3)).toEqual([next, queued, queued2]);
    await expect(app.drawer.locator('li', { hasText: 'Queued' })).toHaveCount(3);
    await expect(app.drawer.locator('li', { hasText: 'Now playing' })).toContainText(current);

    // They really play in that order
    await app.ytDo('endSong');
    await expect(app.heroTitle).toHaveText(next);
    await expect.poll(() => app.ytState()).toBe(1);
    await app.ytDo('endSong');
    await expect(app.heroTitle).toHaveText(queued);
  });

  test('the radio loads its next page when 5 or fewer songs are left and keeps hand-queued songs', async ({ app, api }) => {
    // Every song's first radio page is the same, so the continuation pages are easy to recognize
    const seed = fixtureVideoId('fixed-radio-seed');
    api.recommendations = (request) => {
      const page = request.continuation ? Number(request.continuation.slice(5, request.continuation.indexOf('.'))) : 1;
      return { body: { seedVideoId: seed, ...radioPage(seed, page) } };
    };
    await app.open();
    await app.searchAndPlayFirst('kavinsky nightcall');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBe(10);
    expect(api.radioRequests.filter((r) => r.continuation), 'no next page while more than 5 songs are left').toHaveLength(0);

    // Jump to the 5th radio song: 5 are left
    await app.drawer.locator('[aria-label^="Play "]').nth(4).click();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThan(5);
    const handQueued = await app.chooseFromTrackMenu(app.results, 6, 'Add to queue');
    await expect
      .poll(async () => (await app.queueTitles()).filter((t) => / P2-/.test(t)).length, { message: 'page 2 is appended' })
      .toBe(10);
    expect(api.radioRequests.some((r) => r.continuation?.startsWith('RADIO2.'))).toBe(true);
    const upcoming = await app.upcomingTitles();
    expect(upcoming[0], 'the hand-queued song still plays next').toBe(handQueued);
    expect(upcoming.indexOf(handQueued)).toBeLessThan(upcoming.findIndex((t) => / P2-/.test(t)));
  });

  test('the track menu works with the keyboard and returns focus to its button', async ({ app, page }) => {
    await app.open();
    await expect(app.featured.locator('h2')).toHaveText('Daft Punk Essentials');
    const trigger = app.featured.locator('button[aria-label^="More options for "]').nth(1);
    const title = ((await trigger.getAttribute('aria-label')) ?? '').replace('More options for ', '');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = page.getByRole('menuitem');
    await expect(items.nth(0)).toBeFocused();
    await expect(items).toHaveText(['Play next', 'Add to queue', 'Like', 'Download']);
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.nth(3)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // ArrowDown on the button opens it too; Enter picks an item
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(app.notice).toContainText(`Added “${title}” to your queue`);
    await expect(trigger).toBeFocused();

    // A tap outside closes it
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.mouse.click(5, 300);
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('a track menu near the bottom bar opens above it, fully on screen', async ({ app, page }) => {
    await app.open();
    const rowTrigger = app.libraryRows.last().locator('button[aria-label^="More options for "]');
    await rowTrigger.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await rowTrigger.click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect.poll(async () => (await menu.evaluate((el) => getComputedStyle(el).opacity))).toBe('1');
    const box = await menu.boundingBox();
    const footerTop = await app.footer.evaluate((el) => el.getBoundingClientRect().top);
    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(footerTop + 0.5);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 0.5);
  });
});
