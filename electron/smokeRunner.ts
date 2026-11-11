/** Runs the `METROLIST_SMOKE_TEST=1` check against the live window and exits 0 (PASS) / 1 (FAIL). */
import { app, type BrowserWindow, type WebContents } from 'electron';
import fs from 'node:fs';
import {
  SMOKE_TEST_TIMEOUT_MS,
  evaluateSmokeTest,
  smokeTestReportPath,
  smokeTestTimedOut,
  type SmokeObservation,
  type SmokeVerdict,
} from './policies/smokeTest';

interface ShellProbe {
  title: string;
  hasMain: boolean;
  hasMainNavigation: boolean;
}

const PROBE = `({
  title: document.title,
  hasMain: !!document.querySelector('main'),
  hasMainNavigation: !!document.querySelector('nav[aria-label="Main"]'),
})`;

let finished = false;

export function finishSmokeTest(verdict: SmokeVerdict): void {
  if (finished) return;
  finished = true;
  console.log(verdict.line);
  const reportPath = smokeTestReportPath(process.env);
  if (reportPath) {
    try {
      fs.writeFileSync(reportPath, `${verdict.line}\n`);
    } catch (err) {
      console.error('[metrolist] could not write the smoke test report:', err);
    }
  }
  app.exit(verdict.pass ? 0 : 1);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForLoad(contents: WebContents): Promise<void> {
  if (!contents.isLoading() && contents.getURL()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    contents.once('did-finish-load', () => resolve());
    contents.once('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame) reject(new Error(`did-fail-load ${code} ${description} (${url})`));
    });
  });
}

async function probeShell(contents: WebContents): Promise<ShellProbe> {
  let last: ShellProbe = { title: '', hasMain: false, hasMainNavigation: false };
  for (let attempt = 0; attempt < 60; attempt++) {
    last = (await contents.executeJavaScript(PROBE, true)) as ShellProbe;
    if (last.hasMain && last.hasMainNavigation) break;
    await delay(250);
  }
  return last;
}

/** Starts the timeout immediately; call it as early as possible. */
export function armSmokeTestTimeout(): void {
  setTimeout(() => finishSmokeTest(smokeTestTimedOut()), SMOKE_TEST_TIMEOUT_MS);
}

export async function runSmokeTest(win: BrowserWindow, appUrl: string): Promise<void> {
  const observation: SmokeObservation = { title: '', hasMain: false, hasMainNavigation: false, manifestStatus: null };
  try {
    await waitForLoad(win.webContents);
    Object.assign(observation, await probeShell(win.webContents));
    observation.manifestStatus = await fetch(new URL('/manifest.webmanifest', appUrl))
      .then((response) => response.status)
      .catch(() => null);
  } catch (err) {
    observation.error = err instanceof Error ? err.message : String(err);
  }
  finishSmokeTest(evaluateSmokeTest(observation));
}
