/**
 * Desktop app tests (`npm run test:electron`, Playwright's Electron support). Not part of
 * `npm run test:e2e`. They start the real main process (`dist-electron/main.cjs`, built by the script)
 * with the built frontend, one app at a time: the app always listens on 127.0.0.1:47823.
 * Hermetic like the web suite: see `e2e-electron/desktopApp.ts`. On Linux run it under `xvfb-run -a`.
 */
import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e-electron',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-electron' }]] : [['list']],
  outputDir: 'test-results-electron',
});
