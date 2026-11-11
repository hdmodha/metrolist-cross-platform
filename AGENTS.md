# AGENTS.md — Universal Multi-Agent & LLM Collaboration Spec

This repository is structured for multi-LLM collaboration (Claude Code, GitHub Copilot, Cursor, Windsurf, Codex, Gemini). Before modifying any code, read this specification and `./CLAUDE.md`.

---

## 0. Platform Parity Rule (standing rule from the owner)

> "From now on, each patch and change should happen to all OS and platforms and devices."

Every change is implemented and verified for: **web** (desktop and mobile browsers), **the Electron desktop app** (macOS, Windows, Linux), **Android** and **iOS** (Capacitor), and **phone, tablet and desktop layouts**. A platform that cannot have a change is named, with the reason, in the commit message and the PR description; so is "not tested on a device".

| Platform | Run locally | What CI proves | Needs a real device / machine |
|---|---|---|---|
| Web, desktop browsers | `npm test`, `npm run lint`, `npm run build`, `npm run test:e2e`, server smoke starts | PR CI: unit, typecheck, build, e2e | Safari / Firefox specifics |
| Web, mobile browsers | `npm run test:e2e` (phone, small-phone, landscape-phone, tablet) | PR CI e2e | iOS Safari / Android Chrome autoplay, background tabs |
| Electron, Linux | `xvfb-run -a npm run test:electron`, `npm run desktop:pack` + smoke | PR CI Electron suite | a real window manager |
| Electron, macOS / Windows | — | release: packaged smoke tests, macOS signature + architectures | media keys, minimise / hide |
| Android | `npm test`, `e2e/native.spec.ts`; pure Java + JUnit with plain `javac` | release `build-mobile-bundles`: `native:prepare --check`, `assembleDebug`, plugin JUnit, APK dex + merged-layout checks | background play (Home, screen off), notification, lock screen, Bluetooth, permission prompt, ads |
| iOS | `npm test`, `e2e/native.spec.ts` (iOS shell) | release `build-ios-app`: Swift guard vectors, WebKit compile of the content-blocker list, `native:prepare --check`, simulator `xcodebuild` | background audio, lock screen, remote commands, the YouTube embed's origin |
| Layouts | `npm run test:e2e` (`layout.spec.ts`, five projects) | PR CI | — |

---

## 1. Mandatory Verification Loop Before Every Commit

Every AI agent making changes to this repository **must** run all the checks below and confirm zero errors before finishing a task:

```bash
# 1. Run all unit & security tests (every src/, electron/, native/*/src/ and scripts/ *.test.ts, all must pass)
npm test

# 2. Run TypeScript compiler typecheck (must exit 0)
npm run lint

# 3. Run production Vite bundle build (must exit 0)
npm run build

# 4. Run the hermetic end-to-end browser suite (phone, small phone, landscape phone, tablet, desktop)
npm run test:e2e

# 5. Desktop app (Electron) suite; on Linux under a virtual display
xvfb-run -a npm run test:electron          # macOS / Windows: npm run test:electron

# 6. Production server smoke starts (stop them afterwards)
NODE_ENV=production PORT=3077 timeout 8 npx tsx server.ts
PORT=3078 timeout 8 npm start              # bundled dist-server/server.mjs

# 6b. After editing src/shared/adBlock.ts, adBlockVectors.ts, webkitContentBlocker.ts or systemPauseGuardVectors.ts:
#     regenerate the rule copies (Android asset, iOS content-blocker list) and the shared JUnit / Swift vectors
#     (a unit test fails while any is stale)
npm run adblock:rules                      # alias: npm run native:artifacts

# 6c. Native projects (generated, never committed): after `npx cap add android|ios` + `npx cap sync`
npm run native:prepare                     # Android MainActivity (background-playback WebView), iOS UIBackgroundModes audio
npm run native:prepare -- --check          # verify only; fails loudly on an unexpected generated MainActivity

# 7. Dependencies: must report 0 vulnerabilities (and the minimatch override must hold)
npm audit
npx -y npm@11.21.1 ls minimatch            # npm 11, as the release jobs use: exit 0, minimatch@11.0.1 "overridden"
# (not plain `npm ls minimatch` under npm 10: it reports the range-scoped overrides in package.json
#  as "invalid" and exits 1 although the installed tree is correct; npm 11 understands them)

# 8. After touching electron/, electron-builder.yml or the build: package and smoke-test the app
npm run desktop:pack
METROLIST_SMOKE_TEST=1 xvfb-run -a release/linux-unpacked/metrolist --no-sandbox   # Linux
npx @electron/asar list release/linux-unpacked/resources/app.asar                  # only dist/, dist-electron/, package.json
```

---

## 2. Architecture in One Minute

- Pure logic is test-first: `src/player/playerCore.ts` (reducer + selectors), `queueRules.ts`, `effectPolicies.ts`, `src/app/router.ts`, `src/app/nowPlayingHistory.ts`, `src/utils/persistence.ts`, `src/utils/recentSearches.ts`. Write the failing `node:test` test first; keep the reducer free of time and randomness (inject them through action payloads).
- `src/player/usePlayer.ts` is the only hook with side effects. Components and pages are presentational (`React.memo`) and call the stable `usePlayer().actions` (shared through `AppActionsContext`).
- The playback position never goes into React state: only `SeekBar` and `ProgressLine` subscribe to the playback clock. The e2e render proof fails if anything else re-renders on ticks.
- Routing is a dependency-free hash router; Now Playing's open state is backed by one history entry so Back closes it.
- Every song is a YouTube Music song. "Download" only adds a song to the Downloads list (no audio is stored) — do not imply offline playback.
- The server is one factory (`src/server/createServer.ts`) used by the CLI (`server.ts`, web mode) and the Electron main process (`electron/`, desktop mode). Electron decision logic lives in pure `electron/policies/*` modules with tests.
- See `./CLAUDE.md` for the file map, data flows and caveats.

## 3. Prioritized Backlog for Collaborating LLMs

### Priority 1: Verify the Standalone Mobile App on Real Devices
- The packaged Android / iOS app calls YouTube Music directly through Capacitor's native HTTP bridge (`src/utils/apiClient.ts`) and relies on the hash router for the hardware Back button. Both were verified against simulated environments only: test a real APK / iOS build.

### Priority 2: Verify Background Play and Ad Blocking on a Phone (Android, then iOS)
- The first APK stopped the music on Home (screen off was fine): Android hid the WebView's page. Fixed by `BackgroundPlaybackWebView` (window kept "visible" while music is wanted) installed through the prepared `MainActivity` (`npm run native:prepare`), plus a once-only resume after a system pause and lifecycle saves; see CLAUDE.md §3 items 10 and 11 (iOS). Proven by CI compiles, node / JUnit / Swift-vector tests and a simulated bridge only: run the README's "What to check on a phone" lists on a real APK / iPhone and read the hidden debug log (long press on the version in Library) or `adb logcat -s Metrolist`.
- Never replace `scripts/prepare-native.mjs`'s exact-default check with a blind overwrite: it is what stops a future Capacitor template from being clobbered.
- Playback stays in the hidden YouTube IFrame (decided): do NOT call `youtubei/v1/player`, impersonate YouTube's app clients to get raw `googlevideo.com` URLs, decipher signatures or generate PO / BotGuard tokens.
- Never inject the visibility override into the app's own origin (`usePlayer` saves the position on the real `visibilitychange`), and keep `AdBlockingWebViewClient` calling `super` for everything it does not block (Capacitor serves `https://localhost` through it).
- The system-pause guard must never resume a pause the listener asked for: the page sends `pausedBy: 'player'` only for pauses the YouTube player made itself; keep TS (`src/shared/systemPauseGuard.ts`), Java and Swift in step through the shared vectors.

### Priority 3: Playlists
- The library has Liked Songs, Downloads and Recently played (`likedIds`, `downloadedIds`, `recentlyPlayedIds` in the player core, persisted in `metrolist.player.v2`). User playlists would follow the same pattern: an ordered id list in the reducer, a v3 persistence shape with a migration test, and a page under `#/library/…`.

---

## 4. Security & CI Rules (CodeQL + Dependabot)

- **Never remove `express-rate-limit` from `src/server/createServer.ts`**: CodeQL rule `js/missing-rate-limiting` requires `rateLimit(...)` from `express-rate-limit` on routes serving files.
- **Never relax the desktop server**: desktop mode binds 127.0.0.1 only, sends no CORS headers and checks `Host` (DNS rebinding). Keep the Electron window hardening in `electron/security.ts`.
- **Never pass raw string URLs with user query params to `fetch()` in the server**: Always use `new URL(...)` + `.searchParams.set(...)` + explicit `url.origin` verification to satisfy CodeQL rule `js/request-forgery`.
- **Ad-block rules stay conservative** (`src/shared/adBlock.ts`, also applied by the Android plugin's Java matcher and, as a WebKit content-blocker list, by the iOS plugin; held to the same answers by `src/shared/adBlockVectors.ts`, iOS differences pinned in `webkitContentBlocker.ts`): never block what playback needs (the never-block list: `googlevideo.com`, `ytimg.com`, `/iframe_api`, `/s/player/`, `/embed/`, `/youtubei/v1/player`, `/youtubei/v1/next`, `/api/stats/playback`, `/api/stats/watchtime`, …); every rule says why it is safe.
- **Never introduce super-linear regexes in `src/utils/metrolistCore.ts`** (nor in `src/player/alternateUploads.ts` or `src/shared/adBlock.ts`): Use linear $O(N)$ string scanning to satisfy CodeQL rule `js/polynomial-redos`.
- **Keep `vite >= 6.4.6` and `esbuild >= 0.25.0` in `package.json`**: Required to keep GitHub Dependabot at 0 alerts.
