/**
 * End-to-end browser tests (`npm run test:e2e`). Hermetic: every network call is answered by the
 * fixtures in `e2e/fixtures/` (see `test.ts`), so the suite needs no internet access.
 *
 * Two servers are started once for the whole run: the production Express server (built app + API
 * routes) and a static `vite preview` with no backend, for the packaged-app (Capacitor) spec.
 */
import { defineConfig, devices } from '@playwright/test';
import { SERVER_PORT, STATIC_PORT } from './e2e/fixtures/ports';

const isCI = !!process.env.CI;

const phone = devices['Pixel 7'];
const LAYOUT_SPEC = /layout\.spec\.ts$/;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${SERVER_PORT}`,
    trace: 'on-first-retry',
    serviceWorkers: 'block',
  },
  webServer: [
    {
      // Build once, then serve the production bundle + API (the API answers are mocked in the browser)
      // (the rate limiter stays on; the whole suite comes from one IP, so its limit is raised)
      command: `npm run build && NODE_ENV=production PORT=${SERVER_PORT} RATE_LIMIT_PER_MINUTE=100000 npx tsx server.ts`,
      url: `http://localhost:${SERVER_PORT}`,
      reuseExistingServer: !isCI,
      timeout: 180_000,
    },
    {
      // Static files only, like the packaged Android / iOS app (started after the build above)
      command: `npx vite preview --port ${STATIC_PORT} --strictPort`,
      url: `http://localhost:${STATIC_PORT}`,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
  ],
  projects: [
    { name: 'phone', use: { ...phone } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'small-phone',
      testMatch: LAYOUT_SPEC,
      use: { ...phone, viewport: { width: 320, height: 568 } },
    },
    {
      name: 'landscape-phone',
      testMatch: LAYOUT_SPEC,
      use: { ...phone, viewport: { width: 915, height: 412 } },
    },
    {
      name: 'tablet',
      testMatch: LAYOUT_SPEC,
      use: { ...phone, viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2 },
    },
  ],
});
