import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SMOKE_TEST_TIMEOUT_MS,
  evaluateSmokeTest,
  isSmokeTestEnabled,
  smokeTestReportPath,
  smokeTestTimedOut,
  type SmokeObservation,
} from './smokeTest';

const ok: SmokeObservation = { title: 'Metrolist — Ad-Free Music Player', hasMain: true, hasMainNavigation: true, manifestStatus: 200 };

test('enabled only by METROLIST_SMOKE_TEST=1', () => {
  assert.equal(isSmokeTestEnabled({ METROLIST_SMOKE_TEST: '1' }), true);
  assert.equal(isSmokeTestEnabled({}), false);
  assert.equal(isSmokeTestEnabled({ METROLIST_SMOKE_TEST: '0' }), false);
  assert.equal(isSmokeTestEnabled({ METROLIST_SMOKE_TEST: 'true' }), false);
});

test('times out after 45 s', () => {
  assert.equal(SMOKE_TEST_TIMEOUT_MS, 45_000);
  const verdict = smokeTestTimedOut();
  assert.equal(verdict.pass, false);
  assert.match(verdict.line, /^METROLIST SMOKE TEST: FAIL .*timed out after 45 s/);
});

test('passes with the title, the app shell and the manifest', () => {
  const verdict = evaluateSmokeTest(ok);
  assert.equal(verdict.pass, true);
  assert.equal(
    verdict.line,
    'METROLIST SMOKE TEST: PASS (title "Metrolist — Ad-Free Music Player", app shell rendered, manifest 200)'
  );
});

test('fails and says why for each missing piece', () => {
  const cases: Array<[Partial<SmokeObservation>, RegExp]> = [
    [{ title: 'Error' }, /title "Error" does not name Metrolist/],
    [{ hasMain: false }, /app shell <main> missing/],
    [{ hasMainNavigation: false }, /main navigation missing/],
    [{ manifestStatus: 404 }, /manifest answered 404/],
    [{ manifestStatus: null }, /manifest request failed/],
    [{ error: 'did-fail-load -102' }, /did-fail-load -102/],
  ];
  for (const [change, reason] of cases) {
    const verdict = evaluateSmokeTest({ ...ok, ...change });
    assert.equal(verdict.pass, false, JSON.stringify(change));
    assert.match(verdict.line, /^METROLIST SMOKE TEST: FAIL \(/);
    assert.match(verdict.line, reason);
  }
});

test('the verdict can also be written to METROLIST_SMOKE_TEST_REPORT (Windows CI)', () => {
  assert.equal(smokeTestReportPath({ METROLIST_SMOKE_TEST_REPORT: 'C:\\temp\\smoke.txt' }), 'C:\\temp\\smoke.txt');
  assert.equal(smokeTestReportPath({ METROLIST_SMOKE_TEST_REPORT: '  /tmp/smoke.txt ' }), '/tmp/smoke.txt');
  assert.equal(smokeTestReportPath({ METROLIST_SMOKE_TEST_REPORT: '   ' }), null);
  assert.equal(smokeTestReportPath({}), null);
});
