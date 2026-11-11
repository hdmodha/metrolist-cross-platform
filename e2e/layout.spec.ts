/** Layout and accessibility on every device class (runs in all five projects). */
import { expect, test, type MetrolistApp } from './fixtures/test';
import { songs, v2Storage } from './fixtures/storage';

/** Horizontal overflow of the page, plus up to 3 elements that stick out unclipped. */
async function overflow(app: MetrolistApp): Promise<{ overflow: number; offenders: string[] }> {
  return app.page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    // Sticking out is only a problem when no on-screen ancestor clips it (truncated text, scrollers)
    const clipped = (el: HTMLElement) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible' && p.getBoundingClientRect().right <= width + 1) return true;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.right > width + 1 && !el.closest('[data-fake-yt], [aria-hidden="true"]') && !clipped(el);
      })
      .slice(0, 3)
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`);
    return { overflow: document.documentElement.scrollWidth - width, offenders };
  });
}

async function expectNoOverflow(app: MetrolistApp, where: string): Promise<void> {
  const m = await overflow(app);
  expect(m.overflow, `${where}: ${m.offenders.join(', ')}`).toBeLessThanOrEqual(0);
  expect(m.offenders, where).toEqual([]);
}

/** Interactive elements on screen smaller than 40 x 40 px. */
function smallTargets(app: MetrolistApp): Promise<string[]> {
  return app.page.evaluate(() => {
    const out: string[] = [];
    const scope = document.querySelector('[role="dialog"]') ?? document;
    for (const el of scope.querySelectorAll<HTMLElement>('button, a[href], input, [role="switch"], [role="menuitem"]')) {
      if (el.closest('[inert], [data-fake-yt]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > innerHeight || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.width < 39.5 || r.height < 39.5) {
        out.push(`${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    return out;
  });
}

const visible = (app: MetrolistApp, selector: string) => app.page.locator(selector).first().isVisible();

const LIBRARY = { liked: songs('layout liked', 8), downloaded: songs('layout downloads', 3), recent: songs('layout recent', 6) };

test.describe('layout', () => {
  test('nothing overflows horizontally on any page, in Now Playing or the queue', async ({ app }) => {
    await app.open({ storage: v2Storage(LIBRARY) });
    await expectNoOverflow(app, 'home');
    await app.goTo('Search');
    await expectNoOverflow(app, 'search');
    await app.search('a very long search query that keeps going and going');
    await expect(app.resultRows().first()).toBeVisible();
    await expectNoOverflow(app, 'search results');
    await app.resultRows().first().click();
    await app.goTo('Library');
    await expectNoOverflow(app, 'library');
    await app.openCollection('Liked Songs');
    await expectNoOverflow(app, 'liked');
    await app.openCollection('Downloads');
    await expectNoOverflow(app, 'downloads');
    await app.openNowPlaying();
    await expectNoOverflow(app, 'now playing');
    await app.openQueue();
    await expectNoOverflow(app, 'queue');
    await app.closeNowPlaying();
    await app.page.goto('/#/debug');
    await expect(app.heading).toHaveText('Debug log');
    await expectNoOverflow(app, 'debug log');
  });

  test('below 1024 px: tab bar + docked mini player; from 1024 px: sidebar + player bar', async ({ app, page }) => {
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    const check = async (desktop: boolean) => {
      await expect(app.nav).toHaveCount(1);
      expect(await visible(app, 'aside'), 'sidebar').toBe(desktop);
      expect(await visible(app, 'footer[aria-label="Player"]'), 'player bar').toBe(desktop);
      expect(await visible(app, '[data-chrome="bottom"]:has(nav)'), 'tab bar + mini player').toBe(!desktop);
      if (!desktop) {
        // The mini player sits directly above the tab bar
        const [mini, nav] = await Promise.all([
          page.locator('button[aria-label="Open Now Playing"]:visible').boundingBox(),
          app.nav.boundingBox(),
        ]);
        expect(mini && nav && Math.abs(mini.y + mini.height - nav.y)).toBeLessThanOrEqual(8);
      }
    };
    const width = page.viewportSize()?.width ?? 0;
    await check(width >= 1024);
    if (width >= 1024) {
      await page.setViewportSize({ width: 1024, height: 768 });
      await check(true);
      await page.setViewportSize({ width: 1023, height: 768 });
      await check(false);
      await expectNoOverflow(app, '1023 px');
    }
  });

  test('content stays visible above the docked player; Now Playing fits the screen without scrolling', async ({ app, page }) => {
    await app.open({ storage: v2Storage(LIBRARY) });
    await app.searchAndPlayFirst('kavinsky');
    const height = page.viewportSize()?.height ?? 0;
    const chromeTop = await page.evaluate(() =>
      Math.min(innerHeight, ...[...document.querySelectorAll('[data-chrome="bottom"]')].map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top))
    );
    expect(chromeTop, 'room for the page between the top and the docked player').toBeGreaterThanOrEqual(Math.min(200, height * 0.45));
    // The last song can be scrolled into view above the chrome
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = await app.resultRows().last().boundingBox();
    expect((last?.y ?? 0) + (last?.height ?? 0)).toBeLessThanOrEqual(chromeTop + 1);

    await app.openNowPlaying();
    const fits = await app.nowPlaying.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1);
    expect(fits).toBe(true);
    for (const name of ['Close Now Playing', 'Previous Track', 'Pause Playback', 'Next Track', 'Shuffle']) {
      const box = await app.nowPlaying.getByRole('button', { name, exact: true }).boundingBox();
      expect(box && box.y >= 0 && box.y + box.height <= height, name).toBe(true);
    }
    const art = await app.nowPlaying.locator('.art-square').boundingBox();
    expect(art && Math.abs(art.width - art.height) < 2 && art.width >= 80, 'square artwork').toBe(true);
  });

  test('controls are at least 40 x 40 px on touch screens', async ({ app }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'touch screens only');
    await app.open({ storage: v2Storage(LIBRARY) });
    expect(await smallTargets(app), 'home').toEqual([]);
    await app.searchAndPlayFirst('daft punk');
    expect(await smallTargets(app), 'search results + mini player').toEqual([]);
    await app.goTo('Library');
    expect(await smallTargets(app), 'library').toEqual([]);
    await app.page.goto('/#/debug');
    await expect(app.heading).toHaveText('Debug log');
    expect(await smallTargets(app), 'debug log').toEqual([]);
    await app.page.goBack();
    await app.openCollection('Liked Songs');
    expect(await smallTargets(app), 'liked').toEqual([]);
    await app.openNowPlaying();
    expect(await smallTargets(app), 'now playing').toEqual([]);
    await app.openQueue();
    expect(await smallTargets(app), 'queue').toEqual([]);
    await app.closeQueue();
    await app.nowPlaying.locator('button[aria-label^="More options for "]').click();
    expect(await smallTargets(app), 'menu').toEqual([]);
  });

  test('every control the listener needs is reachable without hover', async ({ app }) => {
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    await expect(app.results.locator('button[aria-label^="More options for "]').first()).toBeVisible();
    await expect(app.pauseButton).toBeVisible();
    await expect(app.control('Remove from Liked Songs').or(app.control('Save to Liked Songs'))).toBeVisible();
    await app.showControls();
    for (const name of ['Previous Track', 'Pause Playback', 'Next Track', 'Shuffle']) await expect(app.control(name)).toBeVisible();
    await expect(app.repeatButton).toBeVisible();
    await app.openQueue();
    await expect(app.autoplaySwitch).toBeVisible();
  });

  test('keyboard focus is clearly visible', async ({ app, page }) => {
    await app.open();
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement as Element);
      return `${s.outlineStyle} ${s.outlineWidth}`;
    });
    expect(outline).toBe('solid 2px');
  });

  test('reduced motion: no slide-in, no animated bars, no transitions', async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await app.open();
    await app.searchAndPlayFirst('daft punk');
    const bars = app.results.locator('.playing-bars > span').first();
    await expect(bars).toBeVisible();
    expect(await bars.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await app.openNowPlaying();
    expect(await app.nowPlaying.evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    const duration = await app.nowPlaying.getByRole('button', { name: 'Pause Playback' }).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBeLessThanOrEqual(0.001);
  });
});
