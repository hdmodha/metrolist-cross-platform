import { expect, test } from './fixtures/test';
import { RECENT_SEARCHES_KEY } from './fixtures/storage';

test.describe('search', () => {
  test('Enter submits the search, dismisses the on-screen keyboard and puts the query in the URL', async ({ app, page }) => {
    await app.open();
    await app.goTo('Search');
    await expect(app.heading).toHaveText('Search');
    await expect(app.searchInput).toHaveAttribute('enterkeyhint', 'search');
    await app.searchInput.click();
    await app.searchInput.pressSequentially('coldplay yellow', { delay: 10 });
    await app.searchInput.press('Enter');
    await expect(app.searchInput).not.toBeFocused();
    await expect(app.resultRows()).toHaveCount(12);
    await expect(app.resultRows().first()).toContainText('Coldplay Yellow');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
    expect(await app.hash()).toBe('#/search?q=coldplay%20yellow');
  });

  test('result rows request the small cover variant, Now Playing the large one', async ({ app, page }) => {
    const images: string[] = [];
    page.on('request', (r) => {
      if (r.resourceType() === 'image' && r.url().includes('ytimg.com')) images.push(r.url());
    });
    await app.open();
    await app.goTo('Search');
    images.length = 0; // Home's shelf cards (large) are not under test
    await app.search('coldplay yellow');
    await expect(app.resultRows()).toHaveCount(12);
    await expect.poll(() => images.some((u) => u.endsWith('/mqdefault.jpg'))).toBe(true);
    expect(images.filter((u) => u.includes('/hqdefault.jpg') && u.includes('sqp='))).toHaveLength(0);
    await app.resultRows().first().click();
    await app.openNowPlaying();
    await expect.poll(() => images.some((u) => u.includes('/hqdefault.jpg?sqp=fixture&rs=fixture'))).toBe(true);
  });

  test('loading, error with Retry and "no songs found" states are honest (never unrelated songs)', async ({ app, api }) => {
    let mode: 'fail' | 'empty' = 'fail';
    api.search = (query) => (query === 'top hits' ? { body: { tracks: [] } } : mode === 'fail' ? { fail: true } : { body: { tracks: [] } });
    await app.open();
    await app.search('zzzz');
    const alert = app.results.getByRole('alert');
    await expect(alert).toContainText('couldn’t reach YouTube Music');
    await expect(app.resultRows()).toHaveCount(0);
    mode = 'empty';
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(app.results.getByText('No songs found for “zzzz”')).toBeVisible();
    await expect(app.resultRows()).toHaveCount(0);
  });

  test('shows a loading state while a search is running', async ({ app, api }) => {
    api.search = (query) => ({ body: { tracks: [] }, delayMs: query === 'slowpoke' ? 1500 : 0 });
    await app.open();
    await app.search('slowpoke');
    await expect(app.results.getByRole('status')).toContainText('Searching YouTube Music');
    await expect(app.results.getByText('No songs found for')).toBeVisible();
  });

  test('a slow earlier search cannot overwrite the latest results', async ({ app, api }) => {
    api.search = (query) => ({
      body: { tracks: [{ videoId: query === 'slow one' ? 'aaaaaaaaaaa' : 'bbbbbbbbbbb', title: `Result for ${query}`, artist: 'Test', album: '', durationMs: 180000, thumbnailUrl: '' }] },
      delayMs: query === 'slow one' ? 1500 : 50,
    });
    await app.open();
    await app.search('slow one');
    await app.search('fast one');
    await expect(app.resultRows()).toHaveText([/Result for fast one/]);
    await app.page.waitForTimeout(1800); // the slow answer has arrived by now
    await expect(app.resultRows()).toHaveText([/Result for fast one/]);
  });

  test('search-as-you-type is debounced and refining a query never adds history entries', async ({ app, api, page }) => {
    await app.open();
    await app.goTo('Search');
    const before = await page.evaluate(() => history.length);
    await app.searchInput.pressSequentially('daft', { delay: 30 });
    await expect(app.resultRows().first()).toContainText('Daft');
    expect(await app.hash()).toBe('#/search?q=daft');
    await app.searchInput.pressSequentially(' punk', { delay: 30 });
    await expect(app.resultRows().first()).toContainText('Daft Punk');
    expect(await app.hash()).toBe('#/search?q=daft%20punk');
    expect(await page.evaluate(() => history.length), 'one entry for the results, not one per keystroke').toBe(before + 1);
    expect(api.searches.filter((q) => q.startsWith('daf')).length, 'debounced: not one request per keystroke').toBeLessThanOrEqual(3);
  });

  test('Back goes from results to the empty Search page, then to the previous page, then out of the app', async ({ app, page, baseURL }) => {
    await page.goto('about:blank');
    await app.open();
    await app.goTo('Search');
    await app.search('radiohead');
    await expect(app.resultRows().first()).toBeVisible();

    await page.goBack();
    await expect(app.searchInput).toHaveValue('');
    await expect(app.results).toHaveCount(0);
    await expect(app.main.getByRole('heading', { name: 'Browse all' })).toBeVisible();
    expect(await app.hash()).toBe('#/search');

    await page.goBack();
    await expect(app.heading).toHaveText(/Good (morning|afternoon|evening)/);
    await expect(app.tab('Home')).toHaveAttribute('aria-current', 'page');
    expect(page.url().startsWith(baseURL ?? 'http')).toBe(true);

    await page.goBack();
    await expect(page).toHaveURL('about:blank');
  });

  test('clearing the search shows Browse again without leaving a stale history entry', async ({ app, page }) => {
    await app.open();
    await app.goTo('Search');
    const entries = await page.evaluate(() => history.length);
    await app.search('tame impala');
    await expect(app.resultRows().first()).toBeVisible();
    await page.locator('button[aria-label="Clear search"]').click();
    await expect(app.results).toHaveCount(0);
    await expect(app.searchInput).toBeFocused();
    await expect.poll(() => app.hash()).toBe('#/search');
    // Back now leaves the Search page instead of re-showing the cleared results
    expect(await page.evaluate(() => history.length)).toBeGreaterThanOrEqual(entries);
    await page.goBack();
    await expect(app.tab('Home')).toHaveAttribute('aria-current', 'page');
  });

  test('a search link reloads with its results (deep link)', async ({ app, page }) => {
    await app.open({ path: '/#/search?q=arijit%20singh' });
    await expect(app.tab('Search')).toHaveAttribute('aria-current', 'page');
    await expect(app.searchInput).toHaveValue('arijit singh');
    await expect(app.resultRows().first()).toContainText('Arijit Singh');
    await page.reload();
    await expect(app.resultRows().first()).toContainText('Arijit Singh');
  });

  test('recent searches are remembered (newest first), can be removed one by one or cleared', async ({ app, page }) => {
    await app.open();
    await app.search('daft punk');
    await expect(app.resultRows().first()).toBeVisible();
    await app.search('arijit singh');
    await expect(app.resultRows().first()).toContainText('Arijit Singh');
    await app.search('kavinsky');
    await expect(app.resultRows().first()).toContainText('Kavinsky');
    await page.locator('button[aria-label="Clear search"]').click();

    const recent = app.main.locator('section[aria-labelledby="recent-searches"]');
    await expect(recent.getByRole('button', { name: /^(?!Remove)/ })).toHaveText(['Clear all', 'kavinsky', 'arijit singh', 'daft punk']);
    await page.reload();
    await expect(recent.locator('li')).toHaveText(['kavinsky', 'arijit singh', 'daft punk']);

    await recent.getByRole('button', { name: 'Remove “arijit singh” from recent searches' }).click();
    await expect(recent.locator('li')).toHaveText(['kavinsky', 'daft punk']);
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), RECENT_SEARCHES_KEY)) ?? '[]')).toEqual(['kavinsky', 'daft punk']);

    // Tapping one searches again
    await recent.getByRole('button', { name: 'daft punk', exact: true }).click();
    await expect(app.searchInput).toHaveValue('daft punk');
    await expect(app.resultRows().first()).toContainText('Daft Punk');
    await page.goBack();
    await expect(recent.locator('li')).toHaveText(['daft punk', 'kavinsky']);

    await recent.getByRole('button', { name: 'Clear all' }).click();
    await expect(recent).toHaveCount(0);
    await page.reload();
    await expect(app.main.getByRole('heading', { name: 'Browse all' })).toBeVisible();
    await expect(recent).toHaveCount(0);
  });

  test('a Browse tile runs its search', async ({ app, api }) => {
    await app.open();
    await app.goTo('Search');
    await app.main.getByRole('button', { name: 'Lo-fi', exact: true }).click();
    await expect(app.searchInput).toHaveValue('lofi beats');
    await expect(app.resultRows().first()).toContainText('Lofi Beats');
    expect(api.searches).toContain('lofi beats');
    expect(await app.hash()).toBe('#/search?q=lofi%20beats');
  });

  test('"Go to artist" opens Search with the artist’s songs', async ({ app }) => {
    await app.open();
    await app.search('kavinsky nightcall');
    await expect(app.resultRows().first()).toBeVisible();
    await app.chooseFromTrackMenu(app.results, 0, 'Go to artist');
    await expect(app.searchInput).toHaveValue('Kavinsky');
    await expect.poll(() => app.hash()).toBe('#/search?q=Kavinsky');
    await expect(app.resultRows().first()).toHaveText(/Kavinsky/);
  });
});
