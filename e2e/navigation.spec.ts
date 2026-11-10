/** Pages, tabs, deep links and the Home sections. */
import { expect, test } from './fixtures/test';
import { songs, v2Storage } from './fixtures/storage';

const GREETING = /^Good (morning|afternoon|evening)$/;

test.describe('navigation', () => {
  test('a fresh install: nothing loaded, no mini player, an empty Library', async ({ app, page }) => {
    await app.open();
    await expect(app.heading).toHaveText(GREETING);
    await expect(page.locator('[data-current-title]')).toHaveCount(0);
    await expect(page.locator('button[aria-label="Open Now Playing"]')).toHaveCount(0);
    await expect(app.playerBar).toHaveCount(0);
    await expect(app.main.getByRole('heading', { name: 'Recently played' })).toHaveCount(0);
    await expect(app.main.getByRole('heading', { name: 'Popular right now' })).toBeVisible();
    await expect(app.songButtons(app.main).first()).toContainText('Top Hits');

    await app.goTo('Library');
    await expect(app.heading).toHaveText('Your Library');
    await expect(app.main.getByRole('link', { name: /^Liked Songs/ })).toContainText('0 songs');
    await expect(app.main.getByRole('link', { name: /^Downloads/ })).toContainText('0 songs');
    await expect(app.main.getByText('Nothing played yet')).toBeVisible();
    await app.main.getByRole('button', { name: 'Find something to play' }).click();
    await expect(app.heading).toHaveText('Search');
  });

  test('tabs switch pages, mark the current one and change the URL; one h1 per page', async ({ app, page }) => {
    await app.open();
    const pages = [
      { tab: 'Search', hash: '#/search', h1: 'Search' },
      { tab: 'Library', hash: '#/library', h1: 'Your Library' },
      { tab: 'Home', hash: '#/', h1: GREETING },
    ] as const;
    for (const { tab, hash, h1 } of pages) {
      await app.goTo(tab);
      expect(await app.hash()).toBe(hash);
      await expect(app.heading).toHaveText(h1);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(app.nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(app.tab(tab)).toHaveAttribute('aria-current', 'page');
    }
    // The landmarks are labelled
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(app.nav).toHaveCount(1);
  });

  test('Library pages are deep-linkable and survive a reload; Back returns to the Library', async ({ app, page }) => {
    const liked = songs('deep link', 3);
    await app.open({ storage: v2Storage({ liked }) });
    await app.openCollection('Liked Songs');
    expect(await app.hash()).toBe('#/library/liked');
    await expect(app.titlesIn(app.main)).resolves.toEqual(liked.map((t) => t.title));
    await page.reload();
    await expect(app.heading).toHaveText('Liked Songs');
    if (app.isDesktop) {
      await expect(page.getByRole('navigation', { name: 'Your Library' }).getByRole('link', { name: /Liked Songs/ })).toHaveAttribute('aria-current', 'page');
    } else {
      await expect(app.tab('Library')).toHaveAttribute('aria-current', 'page');
    }
    await page.goBack();
    await expect(app.heading).toHaveText('Your Library');

    await page.goto('/#/library/downloads');
    await expect(app.heading).toHaveText('Downloads');
  });

  test('unknown routes fall back to Home', async ({ app }) => {
    await app.open({ path: '/#/no/such/page' });
    await expect(app.heading).toHaveText(GREETING);
    await expect(app.tab('Home')).toHaveAttribute('aria-current', 'page');
  });

  test('Back from Home with nothing open leaves the app', async ({ app, page }) => {
    await page.goto('about:blank');
    await app.open();
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
  });

  test('Home: "Recently played" appears after playing; recommendations follow the last song', async ({ app, api }) => {
    await app.open();
    const title = await app.searchAndPlayFirst('kavinsky nightcall');
    await app.goTo('Home');
    const recent = app.main.locator('section', { has: app.page.getByRole('heading', { name: 'Recently played' }) });
    await expect(recent).toBeVisible();
    await expect.poll(() => app.titlesIn(recent)).toEqual([title]);
    // The playing song is highlighted (accent colour + bars) and its card toggles it
    await expect(recent.locator('button[aria-current="true"]')).toHaveCount(1);
    await expect(recent.locator('.playing-bars')).toHaveCount(1);

    const shelf = app.main.locator('section', { hasText: 'Because you listened to' });
    await expect(shelf.locator('h2')).toHaveText(title);
    await expect(app.main.getByRole('heading', { name: 'Popular right now' })).toHaveCount(0);
    await expect(app.songButtons(shelf)).toHaveCount(10);
    expect(api.radioRequests.length).toBeGreaterThan(0);
    // A recommendation plays at once
    const pick = await app.titleOf(app.songButtons(shelf).nth(2));
    await app.songButtons(shelf).nth(2).click();
    await expect(app.currentTitle).toHaveText(pick);
  });

  test('an artist card opens Search with that artist', async ({ app }) => {
    await app.open();
    const artists = app.main.locator('section', { has: app.page.getByRole('heading', { name: 'Artists' }) });
    await artists.getByRole('link', { name: /Arijit Singh/ }).click();
    await expect(app.heading).toHaveText('Search');
    await expect(app.searchInput).toHaveValue('Arijit Singh');
    await expect(app.resultRows().first()).toContainText('Arijit Singh');
  });

  test('offline on a fresh install: "Popular right now" falls back to built-in picks', async ({ app, api }) => {
    api.search = () => ({ fail: true });
    await app.open();
    const shelf = app.main.locator('section', { has: app.page.getByRole('heading', { name: 'Popular right now' }) });
    await expect(app.songButtons(shelf).first()).toBeVisible();
    await expect(shelf).toContainText('Blinding Lights');
  });
});
