import { expect, test, type MetrolistApp } from './fixtures/test';
import { LOW_QUALITY_HINT, STREAM_QUALITY_KEY, hiddenPlayerCssSize } from '../src/player/streamQuality';

/** The box the hidden player's iframe lives in (its parent), in CSS pixels. */
async function hostBox(app: MetrolistApp): Promise<{ width: number; height: number }> {
  return app.page.evaluate(() => {
    const host = document.querySelector('[data-fake-yt]')!.parentElement!;
    const r = host.getBoundingClientRect();
    return { width: Math.round(r.width), height: Math.round(r.height) };
  });
}

const qualityCalls = (app: MetrolistApp) =>
  app.page.evaluate(() => (window as unknown as { __yt: { qualityCalls: string[] } }).__yt.qualityCalls);

const hints = (app: MetrolistApp) =>
  app.page.evaluate(() => {
    const yt = (window as unknown as { __yt: { vqVars: (string | null)[]; suggestedQualities: (string | null)[] } }).__yt;
    return { vq: yt.vqVars, suggested: yt.suggestedQualities };
  });

const dpr = (app: MetrolistApp) => app.page.evaluate(() => window.devicePixelRatio);

async function openDebugLog(app: MetrolistApp) {
  await app.page.evaluate(() => {
    location.hash = '#/debug';
  });
  await expect(app.heading).toHaveText('Debug log');
  return app.main.getByRole('list', { name: 'Debug log entries' });
}

test.describe('hidden player video quality', () => {
  test('low (default): a small box, small requested for a video reported as large, details in the log', async ({ app }) => {
    await app.open({ yt: { quality: 'large' } });
    await app.searchAndPlayFirst('coldplay yellow');
    const ratio = await dpr(app);
    const expected = hiddenPlayerCssSize('low', ratio);
    expect(expected.width).toBeGreaterThan(1);
    expect(await hostBox(app)).toEqual(expected);

    await expect.poll(() => qualityCalls(app)).toContain('small');
    await app.page.waitForTimeout(600); // a loop would keep calling
    const calls = await qualityCalls(app);
    expect(calls.every((q) => q === 'small')).toBe(true);
    expect(calls.length).toBeLessThanOrEqual(2); // once when ready, once for the reported `large`

    // The extra hints: every player is created with vq=<hint>, every load / cue suggests it
    const first = await hints(app);
    expect(first.vq.length).toBeGreaterThan(0);
    expect(first.vq.every((v) => v === LOW_QUALITY_HINT)).toBe(true);
    expect(first.suggested.every((v) => v === LOW_QUALITY_HINT)).toBe(true);

    const log = await openDebugLog(app);
    await expect(log).toContainText(
      new RegExp(`stream quality: large \\(video \\S+; mode low, player ${expected.width}x${expected.height} css, dpr ${Math.round(ratio * 100) / 100}, asked small, hints vq\\+suggestedQuality ${LOW_QUALITY_HINT}\\)`)
    );
  });

  test('low: a video already reported at 240p is not asked again', async ({ app }) => {
    await app.open({ yt: { quality: 'small' } });
    await app.searchAndPlayFirst('coldplay yellow');
    await app.page.waitForTimeout(400);
    expect((await qualityCalls(app)).length).toBeLessThanOrEqual(1); // only the one when ready
  });

  test('auto (saved): the old 1x1 box and no request', async ({ app }) => {
    await app.open({ yt: { quality: 'large' }, storage: { [STREAM_QUALITY_KEY]: 'auto' } });
    await app.searchAndPlayFirst('coldplay yellow');
    expect(await hostBox(app)).toEqual({ width: 1, height: 1 });
    expect(await qualityCalls(app)).toEqual([]);
    const none = await hints(app);
    expect(none.vq.length).toBeGreaterThan(0);
    expect(none.vq.every((v) => v === null)).toBe(true);
    expect(none.suggested.every((v) => v === null)).toBe(true);
    const log = await openDebugLog(app);
    await expect(log).toContainText(/stream quality: large \(video \S+; mode auto, player 1x1 css, dpr [\d.]+\)/);
  });

  test('the hidden player never affects layout or hit-testing', async ({ app }) => {
    await app.open();
    await app.searchAndPlayFirst('coldplay yellow');
    const info = await app.page.evaluate(() => {
      const wrapper = document.querySelector('[data-fake-yt]')!.parentElement!.parentElement!;
      const cs = getComputedStyle(wrapper);
      const r = wrapper.getBoundingClientRect();
      return { position: cs.position, opacity: cs.opacity, events: cs.pointerEvents, inView: r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
    });
    expect(info).toEqual({ position: 'fixed', opacity: '0', events: 'none', inView: true });
  });

  test('the debug page switches the mode, saves it, and the next start uses it', async ({ app, page }) => {
    await app.open({ path: '/#/debug' });
    const select = app.main.getByLabel('Video quality of the hidden player');
    await expect(select).toHaveValue('low');
    await select.selectOption('auto');
    expect(await page.evaluate((k) => localStorage.getItem(k), STREAM_QUALITY_KEY)).toBe('auto');
    await page.reload();
    await expect(app.main.getByLabel('Video quality of the hidden player')).toHaveValue('auto');
    await app.searchAndPlayFirst('coldplay yellow');
    expect(await hostBox(app)).toEqual({ width: 1, height: 1 });
    await openDebugLog(app);
    await app.main.getByLabel('Video quality of the hidden player').selectOption('low');
    expect(await page.evaluate((k) => localStorage.getItem(k), STREAM_QUALITY_KEY)).toBe('low');
  });
});
