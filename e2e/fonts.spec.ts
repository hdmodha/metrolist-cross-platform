/** Fonts are bundled with the app (runs in all five projects): no request to a font CDN. */
import { expect, test } from './fixtures/test';

test('fonts come from the app itself: bundled woff2 loaded from the page origin, no font request elsewhere', async ({
  app,
  page,
  unexpectedRequests,
}) => {
  const fontResponses: string[] = [];
  const foreign: string[] = [];
  page.on('response', (response) => {
    if (/\.woff2?$/.test(new URL(response.url()).pathname)) fontResponses.push(response.url());
  });
  page.on('request', (request) => {
    if (/fonts\.(googleapis|gstatic)\.com/.test(new URL(request.url()).hostname)) foreign.push(request.url());
  });
  await app.open();
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family.replace(/["']/g, ''))
  );
  expect(loaded).toContain('DM Sans');
  expect(await page.evaluate(() => document.fonts.check('16px "DM Sans"'))).toBe(true);
  const origin = new URL(page.url()).origin;
  expect(fontResponses.length).toBeGreaterThan(0);
  expect(fontResponses.every((url) => url.startsWith(`${origin}/assets/`))).toBe(true);
  expect(foreign).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
});
