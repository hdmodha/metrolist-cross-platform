import { expect, test, type MetrolistApp } from './fixtures/test';

const ABOVE_SEEK_BAR = ['App', 'AppHeader', 'PlayerLibraryView', 'QueueDrawer', 'NowPlayingBar'];

/** Render counts (from `countRender` in the app) during `ms` of playback. */
async function rendersDuring(app: MetrolistApp, ms: number): Promise<Record<string, number>> {
  const read = () => app.page.evaluate(() => ({ ...(window as unknown as { __renderProbe: Record<string, number> }).__renderProbe }));
  const before = await read();
  await app.page.waitForTimeout(ms); // measuring renders over a period needs real time
  const after = await read();
  const delta: Record<string, number> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) delta[key] = (after[key] ?? 0) - (before[key] ?? 0);
  return delta;
}

test.describe('performance', () => {
  test('only the seek bar re-renders on playback ticks (live stream and local song)', async ({ app, page }) => {
    await app.open({ renderProbe: true });
    await app.searchAndPlayFirst('kavinsky nightcall');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThan(5);
    await expect(page.getByText('YouTube Music Radio Algorithm')).toBeVisible(); // recommendations settled

    const live = await rendersDuring(app, 2500);
    expect(live.SeekBar ?? 0, JSON.stringify(live)).toBeGreaterThanOrEqual(6);
    for (const name of ABOVE_SEEK_BAR) expect(live[name] ?? 0, `${name}: ${JSON.stringify(live)}`).toBe(0);

    // A local (synthesized) song with the equalizer spectrum open
    await page.locator('button[aria-label="Clear search"]').click(); // the query also filters the library
    await page.locator('[role="button"][aria-label^="Play Night Prism"]').click();
    await app.drawer.getByRole('tab', { name: 'EQ' }).click();
    await expect.poll(() => app.seekValue()).toBeGreaterThan(0);
    await expect(page.getByText('YouTube Music Radio Algorithm')).toBeVisible();
    const local = await rendersDuring(app, 2500);
    expect(local.SeekBar ?? 0, JSON.stringify(local)).toBeGreaterThanOrEqual(6);
    for (const name of ABOVE_SEEK_BAR) expect(local[name] ?? 0, `${name}: ${JSON.stringify(local)}`).toBe(0);
  });
});
