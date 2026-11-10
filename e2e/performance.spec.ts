import { expect, test, type MetrolistApp } from './fixtures/test';

/** Everything above the seek bar / progress line: none of it may re-render on playback ticks. */
const SHELL = ['App', 'Sidebar', 'BottomNav', 'HomePage', 'SearchPage', 'LibraryPage', 'LikedSongsPage', 'DownloadsPage', 'MiniPlayer', 'PlayerBar', 'NowPlaying', 'QueueSheet'];
const CLOCK_SUBSCRIBERS = ['SeekBar', 'ProgressLine'];

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

function expectOnlyClockSubscribers(delta: Record<string, number>, where: string): void {
  const ticks = CLOCK_SUBSCRIBERS.reduce((sum, name) => sum + (delta[name] ?? 0), 0);
  expect(ticks, `${where}: the position still moves ${JSON.stringify(delta)}`).toBeGreaterThanOrEqual(6);
  for (const name of SHELL) expect(delta[name] ?? 0, `${where}: ${name} ${JSON.stringify(delta)}`).toBe(0);
}

test.describe('performance', () => {
  test('only the seek bar and the progress line re-render on playback ticks (Now Playing closed and open)', async ({ app }) => {
    await app.open({ renderProbe: true });
    await app.searchAndPlayFirst('kavinsky nightcall');
    await app.openQueue();
    await expect.poll(async () => (await app.upcomingTitles()).length).toBeGreaterThan(5); // the radio has settled
    await expect(app.notice).toHaveCount(0);

    // Now Playing open, queue showing
    expectOnlyClockSubscribers(await rendersDuring(app, 2500), 'Now Playing + queue');
    await app.closeQueue();
    expectOnlyClockSubscribers(await rendersDuring(app, 2000), 'Now Playing');

    // Closed: search results page
    await app.closeNowPlaying();
    expectOnlyClockSubscribers(await rendersDuring(app, 2000), 'Search');

    // Home with the recommendations shelf
    await app.goTo('Home');
    await expect(app.main.getByText('Because you listened to')).toBeVisible();
    await app.page.waitForTimeout(300);
    expectOnlyClockSubscribers(await rendersDuring(app, 2000), 'Home');
  });
});
