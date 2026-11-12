import { expect, test, type MetrolistApp } from './fixtures/test';

const YOUTUBE_API = 'https://www.youtube.com/iframe_api';

async function openDebugLog(app: MetrolistApp) {
  await app.page.evaluate(() => {
    location.hash = '#/debug';
  });
  await expect(app.heading).toHaveText('Debug log');
  return app.main.getByRole('list', { name: 'Debug log entries' });
}

test.describe('timing lines in the debug log', () => {
  test('start-up, search and time-to-sound lines', async ({ app }) => {
    await app.open();
    await app.searchAndPlayFirst('coldplay yellow');
    const log = await openDebugLog(app);
    await expect(log).toContainText(/start-up: app ready in \d+ ms/);
    await expect(log).toContainText(/search: \d+ results in \d+ ms/);
    await expect(log).toContainText(/time to sound: \d+ ms \(new song\)/);
  });
});

test.describe('early YouTube API load', () => {
  test('a fresh install requests the API script before any song is played', async ({ app, page }) => {
    let loads = 0;
    await page.route(YOUTUBE_API, (route) => {
      loads++;
      return route.fallback();
    });
    await app.open();
    await expect.poll(() => loads).toBeGreaterThanOrEqual(1);
    expect(await app.yt(), 'no player is created by the warm-up').toBeNull();
    await app.searchAndPlayFirst('coldplay yellow');
    expect(loads, 'the loaded API is reused').toBe(1);
  });

  test('a failed warm-up is silent and the first play behaves like an API failure today', async ({ app, page }) => {
    let loads = 0;
    await page.route(YOUTUBE_API, (route) => {
      loads++;
      return route.abort();
    });
    await app.open();
    await expect.poll(() => loads).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(300);
    await expect(app.waitingBanner).toBeHidden();
    await expect(app.notice).toBeHidden();

    await app.search('kavinsky nightcall');
    await app.resultRows().first().click();
    await expect(app.waitingBanner).toBeVisible();
    await expect(app.pauseButton, 'the play intent is kept').toBeVisible();
    expect(loads, 'the bridge tried again').toBeGreaterThanOrEqual(2);

    await page.unroute(YOUTUBE_API);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => app.ytState()).toBe(1);
    await expect(app.waitingBanner).toBeHidden();
  });
});
