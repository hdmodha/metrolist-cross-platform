/**
 * `METROLIST_SMOKE_TEST=1`: the packaged app starts, loads its page and checks the app shell rendered
 * and the server answers, then prints one PASS / FAIL line and exits 0 / 1. It needs no YouTube access.
 * CI runs it against the packaged app on real macOS and Windows runners.
 */
export const SMOKE_TEST_TIMEOUT_MS = 45_000;
const PREFIX = 'METROLIST SMOKE TEST:';

export interface SmokeObservation {
  /** `document.title` once the shell rendered. */
  title: string;
  /** `<main>` is present. */
  hasMain: boolean;
  /** `nav[aria-label="Main"]` is present. */
  hasMainNavigation: boolean;
  /** Status of `GET /manifest.webmanifest`, `null` when the request failed. */
  manifestStatus: number | null;
  /** A load failure or exception, if any. */
  error?: string;
}

export interface SmokeVerdict {
  pass: boolean;
  line: string;
}

export function isSmokeTestEnabled(env: Record<string, string | undefined>): boolean {
  return env.METROLIST_SMOKE_TEST === '1';
}

/**
 * Where to also write the verdict line (`METROLIST_SMOKE_TEST_REPORT`), for CI shells that do not show
 * a GUI app's stdout (Windows). `null` when unset.
 */
export function smokeTestReportPath(env: Record<string, string | undefined>): string | null {
  const value = env.METROLIST_SMOKE_TEST_REPORT?.trim();
  return value ? value : null;
}

export function evaluateSmokeTest(observation: SmokeObservation): SmokeVerdict {
  const problems: string[] = [];
  if (observation.error) problems.push(observation.error);
  if (!observation.title.includes('Metrolist')) problems.push(`title "${observation.title}" does not name Metrolist`);
  if (!observation.hasMain) problems.push('app shell <main> missing');
  if (!observation.hasMainNavigation) problems.push('main navigation missing');
  if (observation.manifestStatus === null) problems.push('manifest request failed');
  else if (observation.manifestStatus !== 200) problems.push(`manifest answered ${observation.manifestStatus}`);

  if (problems.length > 0) return { pass: false, line: `${PREFIX} FAIL (${problems.join('; ')})` };
  return {
    pass: true,
    line: `${PREFIX} PASS (title "${observation.title}", app shell rendered, manifest ${observation.manifestStatus})`,
  };
}

export function smokeTestTimedOut(): SmokeVerdict {
  return { pass: false, line: `${PREFIX} FAIL (timed out after ${SMOKE_TEST_TIMEOUT_MS / 1000} s)` };
}
