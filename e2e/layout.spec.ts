/** Layout and accessibility on every device class (runs in all five projects). */
import { expect, test, type MetrolistApp } from './fixtures/test';

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

async function measure(app: MetrolistApp) {
  return app.page.evaluate(() => {
    const box = (sel: string): Box => {
      const r = document.querySelector(sel)?.getBoundingClientRect();
      return { top: r?.top ?? 0, bottom: r?.bottom ?? 0, left: r?.left ?? 0, right: r?.right ?? 0 };
    };
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
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 50)}`);
    return {
      overflow: document.documentElement.scrollWidth - width,
      offenders,
      header: box('header'),
      footer: box('footer'),
      content: box('main > div > div'),
      drawer: box('#inspector-drawer'),
    };
  });
}

async function openPlaying(app: MetrolistApp): Promise<void> {
  await app.open();
  await app.searchAndPlayFirst('daft punk');
  await app.page.locator('button[aria-label="Show Dynamic Queue Panel"]').click();
}

test.describe('layout', () => {
  test('nothing overflows horizontally (home and while playing)', async ({ app }) => {
    await app.open();
    let m = await measure(app);
    expect(m.overflow, m.offenders.join(', ')).toBeLessThanOrEqual(0);
    expect(m.offenders).toEqual([]);
    await app.searchAndPlayFirst('daft punk');
    await app.page.locator('button[aria-label="Show Dynamic Queue Panel"]').click();
    m = await measure(app);
    expect(m.overflow).toBeLessThanOrEqual(0);
    expect(m.offenders).toEqual([]);
  });

  test('content stays visible between the sticky header and the fixed bottom bar', async ({ app, page }) => {
    await app.open();
    const m = await measure(app);
    const height = page.viewportSize()?.height ?? 0;
    expect(m.footer.top - m.header.bottom).toBeGreaterThanOrEqual(Math.min(200, height * 0.45));
  });

  test('one column below 1024 px, content and drawer side by side from 1024 px', async ({ app, page }) => {
    await openPlaying(app);
    const width = page.viewportSize()?.width ?? 0;
    const sideBySide = (m: Awaited<ReturnType<typeof measure>>) =>
      m.drawer.left >= m.content.right - 1 && Math.abs(m.drawer.top - m.content.top) < 40;
    expect(sideBySide(await measure(app))).toBe(width >= 1024);
    if (width >= 1024) {
      await page.setViewportSize({ width: 1024, height: 768 });
      expect(sideBySide(await measure(app)), 'two columns at exactly 1024 px').toBe(true);
      await page.setViewportSize({ width: 1023, height: 768 });
      expect(sideBySide(await measure(app)), 'one column at 1023 px').toBe(false);
    }
  });

  test('primary controls are at least 40 x 40 px on touch screens', async ({ app }, testInfo) => {
    test.skip(!testInfo.project.use.hasTouch, 'touch screens only');
    await openPlaying(app);
    const small = await app.page.evaluate(() => {
      const selectors = [
        'button[aria-label="Previous Track"]',
        'button[aria-label="Next Track"]',
        'button[aria-label="Pause Playback"], button[aria-label="Start Playback"]',
        'button[aria-label^="More options for "]',
        '#inspector-drawer button',
        'header button',
        'button[aria-label="Clear search"]',
        'button[aria-label="Search"]',
      ];
      const out: string[] = [];
      for (const sel of selectors) {
        for (const el of document.querySelectorAll<HTMLElement>(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.width < 39.5 || r.height < 39.5) {
            out.push(`${el.getAttribute('aria-label') ?? el.textContent?.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
      }
      return out;
    });
    expect(small).toEqual([]);
  });

  test('every control the listener needs is reachable without hover', async ({ app }) => {
    await openPlaying(app);
    for (const name of ['Previous Track', 'Pause Playback', 'Next Track', 'Show Dynamic Queue Panel']) {
      await expect(app.page.locator(`button[aria-label="${name}"]`)).toBeVisible();
    }
    await expect(app.results.locator('button[aria-label^="More options for "]').first()).toBeVisible();
    await expect(app.drawer.getByRole('button', { name: 'Shuffle' })).toBeVisible();
    await expect(app.drawer.getByRole('button', { name: /^Repeat/ })).toBeVisible();
  });

  test('keyboard focus is clearly visible', async ({ app, page }) => {
    await app.open();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const outline = await page.evaluate(() => {
      const s = getComputedStyle(document.activeElement as Element);
      return `${s.outlineStyle} ${s.outlineWidth}`;
    });
    expect(outline).toBe('solid 2px');
  });

  test('reduced motion turns transitions off', async ({ app, page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await app.open();
    const duration = await app.nextButton.evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(parseFloat(duration)).toBeLessThanOrEqual(0.001);
  });
});
