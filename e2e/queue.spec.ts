import { radioPage, fixtureVideoId } from './fixtures/apiFixtures';
import { expect, test } from './fixtures/test';
import { v2Storage } from './fixtures/storage';

test.describe('queue', () => {
  test('"Play next" goes ahead of songs queued earlier; "Add to queue" goes after them', async ({ app }) => {
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThanOrEqual(4);
    await app.closeNowPlaying();

    const queued = await app.chooseFromTrackMenu(app.results, 3, 'Add to queue');
    await expect(app.notice).toContainText(`Added “${queued}” to your queue`);
    const next = await app.chooseFromTrackMenu(app.results, 4, 'Play next');
    await expect(app.notice).toContainText('will play next');
    const queued2 = await app.chooseFromTrackMenu(app.results, 5, 'Add to queue');

    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).slice(0, 3)).toEqual([next, queued, queued2]);

    // They really play in that order
    await app.ytDo('endSong');
    await expect(app.currentTitle).toHaveText(next);
    await expect.poll(() => app.ytState()).toBe(1);
    await app.ytDo('endSong');
    await expect(app.currentTitle).toHaveText(queued);
  });

  test('the queue can be reordered, trimmed and cleared; a queued song plays when tapped', async ({ app }) => {
    await app.open();
    const current = await app.searchAndPlayFirst('daft punk');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThanOrEqual(4);
    const [a, b, c] = await app.upcomingTitles();
    expect((await app.queueTitles())[0]).toBe(current);

    await app.queue.getByRole('button', { name: `Move ${b} up in queue` }).click();
    await expect.poll(async () => (await app.upcomingTitles()).slice(0, 3)).toEqual([b, a, c]);
    await expect(app.queue.getByRole('button', { name: `Move ${b} up in queue` }), 'the first upcoming song cannot jump the current one').toBeDisabled();
    await app.queue.getByRole('button', { name: `Remove ${a} from queue` }).click();
    await expect.poll(async () => (await app.upcomingTitles()).slice(0, 2)).toEqual([b, c]);

    await app.queue.getByRole('button', { name: `Play ${c} by`, exact: false }).click();
    await expect(app.currentTitle).toHaveText(c);
    await expect.poll(() => app.ytState()).toBe(1);

    await app.queue.getByRole('button', { name: 'Clear upcoming songs' }).click();
    await expect.poll(() => app.upcomingTitles()).toEqual([]);
    await expect(app.queue).toContainText('Nothing is queued');
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
    await app.queue.locator('ul[aria-label="Next up"] button[aria-label^="Play "]').nth(4).click();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThan(5);
    await app.closeNowPlaying();
    const handQueued = await app.chooseFromTrackMenu(app.results, 6, 'Add to queue');
    await app.openQueue();
    await expect
      .poll(async () => (await app.upcomingTitles()).filter((t) => / P2-/.test(t)).length, { message: 'page 2 is appended' })
      .toBe(10);
    expect(api.radioRequests.some((r) => r.continuation?.startsWith('RADIO2.'))).toBe(true);
    const upcoming = await app.upcomingTitles();
    expect(upcoming[0], 'the hand-queued song still plays next').toBe(handQueued);
    expect(upcoming.indexOf(handQueued)).toBeLessThan(upcoming.findIndex((t) => / P2-/.test(t)));
  });

  test('"Autoplay similar songs" off: the queue holds only what the listener picked', async ({ app, api }) => {
    await app.open({ storage: v2Storage({ autoplayRadio: false }) });
    await app.searchAndPlayFirst('nightcall');
    await app.openQueue();
    await expect(app.autoplaySwitch).toHaveAttribute('aria-checked', 'false');
    await app.page.waitForTimeout(500); // the recommendations answer arrives in this time
    expect(await app.upcomingTitles()).toEqual([]);
    await expect(app.queue).toContainText('Playback stops after this song');
    await app.autoplaySwitch.click();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBe(10);
    expect(api.radioRequests.length).toBeGreaterThan(0);
  });

  test('the track menu works with the keyboard and returns focus to its button', async ({ app, page }) => {
    await app.open();
    await app.search('daft punk');
    const trigger = app.results.locator('button[aria-label^="More options for "]').nth(1);
    const title = ((await trigger.getAttribute('aria-label')) ?? '').replace('More options for ', '');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = page.getByRole('menuitem');
    await expect(items.nth(0)).toBeFocused();
    await expect(items).toHaveText(['Play next', 'Add to queue', 'Like', 'Download', 'Go to artist']);
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.nth(4)).toBeFocused();
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

  test('a track menu near the docked player opens above it, fully on screen', async ({ app, page }) => {
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const chromeTop = await page.evaluate(() =>
      Math.min(...[...document.querySelectorAll('[data-chrome="bottom"]')].map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top))
    );
    // The lowest menu button that is above the docked player
    const triggers = app.results.locator('button[aria-label^="More options for "]');
    let index = (await triggers.count()) - 1;
    while (index > 0 && ((await triggers.nth(index).boundingBox())?.y ?? 0) + 40 > chromeTop) index--;
    await triggers.nth(index).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect.poll(async () => menu.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    const box = await menu.boundingBox();
    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(chromeTop + 0.5);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 0.5);
  });
});
