import { expect, test } from './fixtures/test';

test.describe('search', () => {
  test('Enter submits the search and dismisses the on-screen keyboard', async ({ app, page }) => {
    await app.open();
    await expect(app.searchInput).toHaveAttribute('enterkeyhint', 'search');
    await app.searchInput.click();
    await app.searchInput.pressSequentially('coldplay yellow', { delay: 10 });
    await app.searchInput.press('Enter');
    await expect(app.searchInput).not.toBeFocused();
    await expect(app.results.locator('h2')).toContainText('coldplay yellow');
    await expect(app.resultCards()).toHaveCount(12);
    await expect(app.resultCards().first()).toContainText('Coldplay Yellow');
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT');
  });

  test('loading, error with Retry and "no songs found" states are honest (never unrelated songs)', async ({ app, api }) => {
    let mode: 'slow-fail' | 'empty' = 'slow-fail';
    api.search = (query) => {
      if (query === 'Daft Punk') return { body: { tracks: [] } };
      return mode === 'slow-fail' ? { fail: true } : { body: { tracks: [] } };
    };
    await app.open();
    await app.search('zzzz');
    const alert = app.results.getByRole('alert');
    await expect(alert).toContainText('couldn’t reach YouTube Music');
    await expect(app.resultCards()).toHaveCount(0);
    mode = 'empty';
    await alert.getByRole('button', { name: 'Retry' }).click();
    await expect(app.results.getByText('No songs found for')).toBeVisible();
    await expect(app.resultCards()).toHaveCount(0);
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
    await expect(app.resultCards()).toHaveText([/Result for fast one/]);
    await app.page.waitForTimeout(1800); // the slow answer has arrived by now
    await expect(app.resultCards()).toHaveText([/Result for fast one/]);
  });

  test('clearing the search brings back the artist shelf', async ({ app }) => {
    await app.open();
    await app.search('radiohead');
    await expect(app.resultCards().first()).toBeVisible();
    await app.page.locator('button[aria-label="Clear search"]').click();
    await expect(app.results).toHaveCount(0);
    await expect(app.featured).toBeVisible();
  });

  test('Back clears the search instead of leaving the app; Back without a search leaves', async ({ app, page, baseURL }) => {
    await page.goto('about:blank');
    await app.open();
    await app.search('radiohead');
    await expect(app.resultCards().first()).toBeVisible();
    await page.goBack();
    await expect(app.searchInput).toHaveValue('');
    await expect(app.featured).toBeVisible();
    expect(page.url().startsWith(baseURL ?? 'http')).toBe(true);
    // Clearing with the X button must not leave a history entry behind either
    await app.search('tame impala');
    await page.locator('button[aria-label="Clear search"]').click();
    await expect(app.results).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
  });
});
