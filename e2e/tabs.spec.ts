/**
 * "State in between the screens": every tab remembers where it was, search results come back
 * without a request, and scroll positions (page + Home shelves) are restored. Runs on every device
 * class: the bottom tabs (< 1024 px) and the desktop sidebar.
 */
import type { Page } from '@playwright/test';
import { expect, test, type MetrolistApp } from './fixtures/test';
import { searchResultsFor } from './fixtures/apiFixtures';
import { songs, v2Storage } from './fixtures/storage';

const GREETING = /^Good (morning|afternoon|evening)$/;

/** 20 results (the page shows at most 20), so the results page scrolls on every screen. */
function manyResults(query: string) {
  return { body: { tracks: [...searchResultsFor(query), ...searchResultsFor(`${query} more`)].slice(0, 20) } };
}

/** 30 songs (enough to scroll Liked Songs and Recently played everywhere). */
const MANY = [...songs('tabs one', 12), ...songs('tabs two', 12), ...songs('tabs three', 6)];

/** Two frames: scroll events (and the app's recording of them) have run. */
function settle(page: Page): Promise<void> {
  return page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));

/** Scrolls the page to `wanted` (or as far as it goes) and returns where it ended up. */
async function scrollPageTo(page: Page, wanted: number): Promise<number> {
  await page.evaluate((y) => window.scrollTo(0, y), wanted);
  await settle(page);
  const y = await scrollY(page);
  expect(y, 'the page must be long enough to scroll').toBeGreaterThan(100);
  return y;
}

async function expectScrollY(page: Page, y: number): Promise<void> {
  await expect.poll(() => scrollY(page)).toBeGreaterThanOrEqual(y - 2);
  expect(Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(2);
}

/** Records whether the search spinner ever appears from now on. */
async function watchForSpinner(page: Page): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    const w = window as unknown as { __sawSpinner: boolean };
    w.__sawSpinner = false;
    const seen = () => {
      if (document.body.textContent?.includes('Searching YouTube Music')) w.__sawSpinner = true;
    };
    new MutationObserver(seen).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { __sawSpinner: boolean }).__sawSpinner);
}

async function openLikedSongs(app: MetrolistApp): Promise<void> {
  await app.openCollection('Liked Songs');
  await expect(app.main.locator('.song-title')).toHaveCount(MANY.length);
}

test.describe('tabs remember where you were', () => {
  test('Search keeps its query, its results (no new request, no spinner) and its scroll offset', async ({ app, api, page }) => {
    api.search = manyResults;
    await app.open();
    await app.search('tab memory');
    await expect(app.resultRows()).toHaveCount(20);
    const y = await scrollPageTo(page, 500);
    const requests = api.searches.length;

    await app.goTo('Home');
    await expect(app.heading).toHaveText(GREETING);
    await expect.poll(() => scrollY(page), 'a page the listener has not scrolled starts at the top').toBe(0);
    const sawSpinner = await watchForSpinner(page);
    await app.goTo('Search');
    await expect(app.tab('Search')).toHaveAttribute('aria-current', 'page');
    expect(await app.hash()).toBe('#/search?q=tab%20memory');
    await expect(app.searchInput).toHaveValue('tab memory');
    await expect(app.resultRows()).toHaveCount(20);
    await expectScrollY(page, y);
    expect(await sawSpinner(), 'results come back without a loading state').toBe(false);
    expect(api.searches.length, 'no new search request').toBe(requests);

    // Typing, a new query and its results still work as before
    await app.searchInput.fill('another query');
    await app.searchInput.press('Enter');
    await expect(app.resultRows().first()).toContainText('Another Query');
    expect(api.searches).toContain('another query');
  });

  test('"No songs found" comes back too, without a new request', async ({ app, api }) => {
    api.search = (query) => (query === 'nothing at all' ? { body: { tracks: [] } } : manyResults(query));
    await app.open();
    await app.search('nothing at all');
    await expect(app.results.getByText('No songs found for “nothing at all”')).toBeVisible();
    const requests = api.searches.length;
    await app.goTo('Library');
    await app.goTo('Search');
    await expect(app.results.getByText('No songs found for “nothing at all”')).toBeVisible();
    expect(api.searches.length).toBe(requests);
  });

  test('Library keeps Liked Songs and its scroll offset across a tab switch (and the desktop shortcut)', async ({ app, page }) => {
    await app.open({ storage: v2Storage({ liked: MANY }) });
    await openLikedSongs(app);
    const y = await scrollPageTo(page, 700);

    await app.goTo('Home');
    await expect(app.heading).toHaveText(GREETING);
    await app.goTo('Library');
    await expect(app.heading).toHaveText('Liked Songs');
    expect(await app.hash()).toBe('#/library/liked');
    await expectScrollY(page, y);
    if (!app.isDesktop) await expect(app.tab('Library')).toHaveAttribute('aria-current', 'page');

    if (app.isDesktop) {
      // The sidebar's Liked Songs shortcut returns to the page where it was left, too
      await app.goTo('Search');
      await page.getByRole('navigation', { name: 'Your Library' }).getByRole('link', { name: /Liked Songs/ }).click();
      await expect(app.heading).toHaveText('Liked Songs');
      await expectScrollY(page, y);
    }

    // A link inside the app (the Library page's "Liked Songs" entry) is a fresh visit: the top
    await app.goToRoot('Library');
    await app.main.getByRole('link', { name: /^Liked Songs/ }).click();
    await expect(app.heading).toHaveText('Liked Songs');
    await expect.poll(() => scrollY(page)).toBe(0);
  });

  test('re-tapping the current tab goes to its root at the top; Search also focuses the box', async ({ app, page }) => {
    await app.open({ storage: v2Storage({ liked: MANY, recent: MANY }) });
    await openLikedSongs(app);
    await scrollPageTo(page, 600);
    await app.tab('Library').click();
    await expect(app.heading).toHaveText('Your Library');
    await expect(app.tab('Library')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => scrollY(page)).toBe(0);
    expect(await app.hash()).toBe('#/library');

    // At the root: the top, nothing else
    await scrollPageTo(page, 600);
    const entries = await page.evaluate(() => history.length);
    await app.tab('Library').click();
    await expect.poll(() => scrollY(page)).toBe(0);
    expect(await app.hash()).toBe('#/library');
    expect(await page.evaluate(() => history.length)).toBe(entries);

    // The tab now remembers its root
    await app.goTo('Home');
    await app.goTo('Library');
    await expect(app.heading).toHaveText('Your Library');

    // Search: results → re-tap → the empty Search page with the box focused
    await app.search('retap search');
    await expect(app.resultRows().first()).toBeVisible();
    await app.searchInput.blur();
    await app.tab('Search').click();
    await expect.poll(() => app.hash()).toBe('#/search');
    await expect(app.searchInput).toHaveValue('');
    await expect(app.searchInput).toBeFocused();
    await expect(app.main.getByRole('heading', { name: 'Browse all' })).toBeVisible();
    // ...and pressing it again on the empty page keeps the box focused
    await app.searchInput.blur();
    await app.tab('Search').click();
    await expect(app.searchInput).toBeFocused();
    expect(await app.hash()).toBe('#/search');
  });

  test('the "Back to Your Library" arrow returns to the Library where it was', async ({ app, page }) => {
    await app.open({ storage: v2Storage({ liked: songs('arrow liked', 3), recent: MANY }) });
    await app.goTo('Library');
    await expect(app.main.locator('.song-title')).toHaveCount(MANY.length);
    const y = await scrollPageTo(page, 300);
    // The Liked Songs entry (scrolled out of view by now)
    await app.main.locator('a[href="#/library/liked"]').evaluate((el: HTMLElement) => el.click());
    await expect(app.heading).toHaveText('Liked Songs');
    await expect.poll(() => scrollY(page), 'a link is a fresh visit').toBe(0);
    const arrow = app.main.getByRole('link', { name: 'Back to Your Library' });
    test.skip(!(await arrow.isVisible()), 'the arrow is shown below 1024 px, not on landscape phones');
    await arrow.click();
    await expect(app.heading).toHaveText('Your Library');
    await expectScrollY(page, y);
  });

  test('Back after a tab switch returns to the page at its scroll offset; Forward too', async ({ app, page }) => {
    await page.goto('about:blank');
    await app.open({ storage: v2Storage({ recent: MANY }) });
    await app.goTo('Library');
    await expect(app.main.locator('.song-title')).toHaveCount(MANY.length);
    const y = await scrollPageTo(page, 650);

    await app.goTo('Home');
    await expect(app.heading).toHaveText(GREETING);
    await page.goBack();
    await expect(app.heading).toHaveText('Your Library');
    await expect(app.tab('Library')).toHaveAttribute('aria-current', 'page');
    await expectScrollY(page, y);

    await page.goForward();
    await expect(app.heading).toHaveText(GREETING);
    await expect(app.tab('Home')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => scrollY(page)).toBe(0);

    // Back twice more: Library, then Home (the start), then out of the app
    await page.goBack();
    await expect(app.heading).toHaveText('Your Library');
    await page.goBack();
    await expect(app.heading).toHaveText(GREETING);
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
  });

  test('Home keeps the horizontal offset of its shelves', async ({ app, page }) => {
    await app.open({ storage: v2Storage({ recent: songs('shelf songs', 12) }) });
    const shelf = page.locator('[data-scroll-memory="recent"]');
    await expect(app.songButtons(shelf)).toHaveCount(12);
    await shelf.evaluate((el) => {
      el.scrollLeft = 400;
    });
    await settle(page);
    const x = await shelf.evaluate((el) => Math.round(el.scrollLeft));
    expect(x, 'the shelf must scroll').toBeGreaterThan(50);

    await app.goTo('Library');
    await app.goTo('Home');
    await expect(app.songButtons(shelf)).toHaveCount(12);
    await expect.poll(() => shelf.evaluate((el) => Math.round(el.scrollLeft))).toBeGreaterThanOrEqual(x - 2);
    expect(Math.abs((await shelf.evaluate((el) => Math.round(el.scrollLeft))) - x)).toBeLessThanOrEqual(2);
  });

  test('a reload comes back to the same page, scroll offset and tab memory', async ({ app, page }) => {
    await app.open({ storage: v2Storage({ liked: MANY }) });
    await app.search('before reload');
    await expect(app.resultRows().first()).toBeVisible();
    await openLikedSongs(app);
    const y = await scrollPageTo(page, 700);

    await page.reload();
    await expect(app.heading).toHaveText('Liked Songs');
    await expectScrollY(page, y);
    await app.goTo('Search');
    await expect(app.searchInput).toHaveValue('before reload');
    await expect(app.resultRows().first()).toContainText('Before Reload');
  });

  test('a restore never fights the listener: scrolling before late results arrive wins', async ({ app, api, page }) => {
    let delayMs = 0;
    api.search = (query) => ({ ...manyResults(query), delayMs });
    await app.open();
    await app.search('slow results');
    await expect(app.resultRows()).toHaveCount(20);
    await scrollPageTo(page, 600);

    // After a reload the results take a while; the listener touches the page meanwhile
    delayMs = 1500;
    await page.reload();
    await expect(app.searchInput).toHaveValue('slow results');
    await app.heading.click();
    await expect(app.resultRows()).toHaveCount(20);
    await page.waitForTimeout(300); // give a (wrong) restore the chance to run
    expect(await scrollY(page)).toBe(0);
  });
});
