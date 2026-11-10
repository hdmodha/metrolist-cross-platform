# CLAUDE.md — AI Engineering & Architecture Guide

This file provides essential architectural context, commands, data flows, known issues, and security guardrails for Claude (`claude-code`) and other AI coding assistants collaborating on this repository.

---

## 1. Quick Commands (Build, Test, Lint, Run)

- **Start Full-Stack Dev Server (Express + Vite on Port 3000)**:
  ```bash
  npm run dev
  ```
- **TypeScript Typecheck / Lint**:
  ```bash
  npm run lint
  ```
- **Run All Unit Tests (`node:test` via tsx, every `src/**/*.test.ts`)**:
  ```bash
  npm test
  ```
- **End-to-End Browser Tests (Playwright, hermetic; starts its own servers)**:
  ```bash
  npm run test:e2e                       # all projects: phone, small-phone, landscape-phone, tablet, desktop
  npx playwright test --project=phone    # one device class
  ```
  Every external request is routed to fixtures in `e2e/fixtures/` (fake YouTube IFrame API, API answers, images); an unrouted external request fails the test.
- **Production Frontend Build (`dist/`)**:
  ```bash
  npm run build
  ```
- **Verify Dependency Security (Zero Vulnerabilities Required)**:
  ```bash
  npm audit
  ```

---

## 2. High-Level Architecture & File Map

The app is a single-page, Spotify-style cross-platform music player inspired by Metrolist (YouTube Music client), built with **React 19 + TypeScript + Tailwind CSS v4 + Vite** on the frontend and an **Express (`server.ts`)** InnerTube proxy backend.

```text
├── server.ts                              # Express backend: InnerTube search, RDAMVM recommendations
├── capacitor.config.json                  # Capacitor config for Android (.apk) & iOS native packaging
├── src/
│   ├── App.tsx                            # Thin composition: usePlayer() + view state (search, filter, drawer tab)
│   ├── data/
│   │   ├── metrolistData.ts               # `MetrolistTrack` interface + seed catalog (seed covers resolved via `new URL(..., import.meta.url)`)
│   │   └── fallbackTracks.ts              # Offline-safe shelf (STATIC_YTM_FALLBACK)
│   ├── components/                        # Presentational, React.memo'd; no playback logic
│   │   ├── AppHeader.tsx                  # Sticky header: brand, library filters, Autoplay Radio toggle
│   │   ├── PlayerLibraryView.tsx          # Search, hero, shelves (YtTrackCard), library rows (LibraryRow)
│   │   ├── TrackMenu.tsx                  # Per-track "More" menu (play next, add to queue, like, download), portal + keyboard
│   │   ├── QueueDrawer.tsx                # Up Next queue (clear, move, remove, labels) + 5-band EQ
│   │   ├── SpectrumMeter.tsx              # Self-polling EQ spectrum (only while visible and a local song plays)
│   │   ├── NowPlayingBar.tsx              # Fixed transport bar
│   │   ├── SeekBar.tsx                    # The ONLY component subscribed to the playback clock
│   │   ├── PlayerNotices.tsx              # Notice toast + "Waiting for connection… retrying"
│   │   ├── useSearchBackNavigation.ts     # Android / browser Back clears the search
│   │   └── YouTubeStreamBridge.tsx        # YouTube IFrame Player API bridge (hidden; revealed only when autoplay needs a tap)
│   ├── player/
│   │   ├── usePlayer.ts                   # The one hook with side effects (network, storage, stream, synth, media keys, timers)
│   │   ├── playerCore.ts                  # Pure normalized PlayerState + playerReducer + selectors
│   │   ├── playerStore.ts                 # Tiny external store around the reducer (read via useSyncExternalStore)
│   │   ├── playbackClock.ts               # Playback position store outside React state
│   │   ├── effectPolicies.ts              # Pure decisions for side effects: stream-error recovery, save throttle, shortcuts, Back
│   │   ├── queueRules.ts                  # Queue rules: next index, add to queue / play next, play-now queue, radio merge
│   │   └── retryPolicy.ts                 # Network back-off: 3 s · 2^attempt, capped at 30 s, 5 retries
│   └── utils/
│       ├── metrolistCore.ts               # Pure logic: InnerTube parsers (incl. radio pages) + shared request layer, song search terms, sanitizers
│       ├── apiClient.ts                   # Client network layer: `/api/*` backend, `VITE_API_BASE_URL`, native-shell direct InnerTube, search cache
│       ├── lruCache.ts                    # Pure LRU + TTL cache (time injected)
│       ├── menuNavigation.ts              # Pure menu keyboard navigation + on-screen placement
│       ├── persistence.ts                 # Validated localStorage persistence (library, prefs, queue) + PlayerState mappers
│       ├── renderProbe.ts                 # countRender(): no-op unless a browser test sets window.__renderProbe
│       └── webAudioSynth.ts               # Web Audio API 5-band BiquadFilter EQ + real-time FFT spectrum analyzer
│   (every module has its `*.test.ts` next to it; `npm test` runs them all)
├── playwright.config.ts                   # E2E: production server + static no-backend server, 5 Chromium device projects
├── e2e/
│   ├── fixtures/                          # test.ts (hermetic routes + MetrolistApp driver), fakeYouTube.ts, apiFixtures.ts, ports.ts
│   └── *.spec.ts                          # search, playback, queue, resilience, persistence, performance, native (no backend), layout
└── .github/workflows/
    ├── deploy-pages.yml                   # CI: unit tests, typecheck, build, Playwright e2e (report artifact on failure)
    └── release-native-builds.yml          # Multi-OS release pipeline (Android APK, iOS, macOS, Windows, Web)
```

---

## 3. Core Data Flows

1. **Live YouTube Music Search (`GET /api/innertube/search?q=...`)**:
   - `PlayerLibraryView.tsx` wraps the input in a `<form role="search">` (Enter / the on-screen keyboard's Search key submits and blurs), debounces typing (320ms) and calls `searchTracks()` from `src/utils/apiClient.ts`.
   - `searchInnerTubeTracks` (`src/utils/metrolistCore.ts`, shared by `server.ts` and the native shell) POSTs to `https://music.youtube.com/youtubei/v1/search` using client `WEB_REMIX`, first with the Songs filter (`EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D`), then with the Videos filter (`EgWKAQIQAWoKEAQQBRAVEBAQEQ%3D%3D`). **The Songs filter returns "No results" in regions / on networks without the YouTube Music song catalog, so the Videos fallback must stay.**
   - `parseInnerTubeSearchResponse` extracts `videoId`, `title`, `artist`, `album`, `durationMs`, and `thumbnailUrl` from both shelf formats (`Artist • Album • 3:22` and `Channel • 1.3B views • 4:33`).
   - The UI never substitutes unrelated songs for a search: it shows loading, "No songs found", or an error with Retry.

2. **YouTube Music Recommendations / Radio (`GET /api/innertube/recommendations?videoId=...`)**:
   - Whenever the active track id (or Autoplay Radio) changes, `usePlayer.ts` calls `fetchRecommendations()` and dispatches `recommendationsLoaded` / `recommendationsFailed` (fallback shelf).
   - `server.ts` calls `https://music.youtube.com/youtubei/v1/next` with playlist `RDAMVM${seedVideoId}`.
   - `parseInnerTubeWatchNextPage` extracts recommended tracks (live streams and >20 min mixes are dropped) and the radio continuation token (`playlistPanelRenderer.continuations[0].nextRadioContinuationData.continuation`); the route answers `{ tracks, seedVideoId, continuation }`. When `autoplayRadio` is `ON`, the reducer appends them (`mergeRadioIntoQueue`) **only when 5 or fewer songs are left** — it never replaces the queue, so hand-queued songs survive.
   - **Radio continuation**: the same route with `&continuation=<token>` (≤ 1024 chars of `[A-Za-z0-9_\-%=.]`, checked by the linear `sanitizeRadioContinuation`; the seed must be a valid video id) re-sends the WatchNext body plus the URL-decoded token. That answer repeats the first page under `contents`, so only `continuationContents.playlistPanelContinuation` is parsed. Client: `fetchRadioContinuation()` in `apiClient.ts` (backend and native-shell paths). `usePlayer.ts` requests the next page whenever `selectRadioContinuationRequest(state)` is non-null (`radioPageRequested` → `radioPageLoaded` / `radioPageFailed`, retried with back-off via `radioRetry`); an aborted request must still dispatch `radioPageFailed`.

3. **Full-Song Audio Playback (`YouTubeStreamBridge.tsx` vs `webAudioSynth.ts`)**:
   - **Live YouTube Music tracks (`isLiveInnerTube: true`)**: Streamed at full length via `YouTubeStreamBridge.tsx` (YouTube IFrame API). The bridge writes the position into the playback clock (it never runs while nothing is audible), reports `streamStatus` (`loading | buffering | playing | paused | blocked`) and the real duration. Seeks carry a token and are reported handled only once applied (a seek before the player is ready is kept); `initialPositionMs` creates / cues the player at a restored position, paused; a new `retryNonce` re-creates the player (network retry). Player errors follow `planStreamErrorRecovery`: another upload of the same song (`deriveSongSearchTerms`, max 3 per track), then a skip; API unavailable / an error while offline → `networkLost` and back-off retries. Never a synth fallback.
   - **Connectivity blips must not interrupt playback** (`effectPolicies.ts`): a window `offline` event alone does nothing (YouTube keeps playing from its buffer). "Waiting for network" starts only on a real failure: the IFrame API cannot load, a player error while `navigator.onLine === false`, or ≥ 8 s stuck in `loading` / `buffering` while offline (`shouldWaitForNetworkAfterStall`). A retry never re-creates a stream whose status is `playing` (`planNetworkRetry` → `networkRestored`).
   - **Bridge callbacks must go through the `latest` ref** (`YouTubeStreamBridge.tsx`); `usePlayer.ts` callbacks read `store.getState()`. The player is long-lived; capturing props at mount made "track ended" act on a stale queue.
   - **Local Studio Synth seed tracks (`isLiveInnerTube: false`)**: Synthesized in real time via `src/utils/webAudioSynth.ts`; `usePlayer.ts` clocks them (250 ms ticks into the playback clock).
   - **Performance rule**: the position lives in `playbackClock.ts`, not React state. Only `SeekBar` (and handlers / persistence / MediaSession via `clock.subscribe`) read it; no component above `SeekBar` may re-render on ticks (the browser suite counts renders through `countRender`).

4. **Queue rules (`pickNextQueueIndex`, `insertIntoQueueAfterCurrent`, `insertIntoQueueAsNext`, `buildPlayNowQueue`, `mergeRadioIntoQueue` in `src/player/queueRules.ts`)**:
   - Pure and unit-tested, used by the reducer. Invariant: the playing track is always in the queue once playback started.

5. **Player core (`src/player/playerCore.ts` + `usePlayer.ts`)**:
   - `playerReducer(state, action)` over a normalized `PlayerState` (`tracksById` + id lists) plus selectors (`selectActiveTrack`, `selectQueueTracks`, `selectRadioContinuationRequest`, ...). No timers, clock or `Math.random`: randomness and positions arrive in action payloads. No-op actions return the same object; every change re-establishes the invariants (a seeded property test runs thousands of random action sequences).
   - All playback / queue behaviour is the reducer's; components only call `usePlayer().actions` (stable identities). `Math.random` and positions are injected by the hook.
   - Launch restores the last queue, song and position, always paused (`loadPlayerState` → `fromPersistedState` → `restore`). Saves are debounced on state change; the position is saved at most every 5 s while playing, on pause, on `visibilitychange` → hidden and on `pagehide`.

---

## 4. Priority Bug Areas & Architectural Caveats to Investigate

When debugging or improving the application, prioritize checking these areas:

1. **Standalone Android APK / Mobile WebView Backend Connectivity**:
   - Inside a packaged Capacitor Android `.apk`, the frontend runs on `https://localhost` inside the Android WebView without the Node.js `server.ts` process running locally on the phone.
   - **Handled in `src/utils/apiClient.ts` — all network calls must go through it, never a bare `fetch('/api/...')`.** Inside the native shell (`window.Capacitor.isNativePlatform()`), search and radio call YouTube Music directly through Capacitor's native HTTP bridge (`Capacitor.nativePromise('CapacitorHttp', 'request', ...)`, no browser CORS).
   - `VITE_API_BASE_URL` (build-time) points any frontend at a deployed `server.ts`; `/api/*` sends permissive CORS headers for that purpose.
   - A plain static web host (no backend, not a native shell) cannot search: browsers block cross-origin calls to `music.youtube.com`. It needs `VITE_API_BASE_URL`.
   - The native path was verified against a simulated bridge only (no device build in CI): re-test on a real APK after touching `apiClient.ts`.

2. **YouTube IFrame Audio Restrictions on Mobile WebViews & Background Play**:
   - `YouTubeStreamBridge.tsx` uses a hidden `1x1` YouTube embed iframe. On mobile browsers (iOS Safari / Android WebView), autoplay without direct user gesture on the iframe or background screen-off playback can be throttled by the OS. When a requested start stays "unstarted", the bridge reports `blocked` and reveals the player with a "Tap the player to start playback" prompt.
   - Capacitor iOS serves the app from `capacitor://localhost`; YouTube embeds may reject that origin (untested).
   - Replacing or augmenting `YouTubeStreamBridge.tsx` with direct audio stream extraction (`<audio>` element connected to `AudioContext`) enables true background playback and allows the 5-band Web Audio EQ (`webAudioSynth.ts`) to process live YouTube tracks directly.

3. **Full-Length Duration Preservation**:
   - Never overwrite a track's `durationMs` with a 30-second preview duration (`previewUrl` from iTunes is ~30s). Keep the full duration parsed from InnerTube (`ytTrack.durationMs`) or reported by `YouTubeStreamBridge.onTimeUpdateMs`.

---

## 5. Strict Security & CI Guardrails (Do Not Break)

GitHub **Dependabot** and **CodeQL** are active on this repository. Preserve these invariants when editing code:

0. **Express 5 routing (`server.ts`)**:
   - `express` resolves to 5.x. A bare `'*'` route pattern throws at startup there, so the SPA fallback is a path-less `app.use(rateLimiterMiddleware, ...)`. Always smoke-test `NODE_ENV=production npx tsx server.ts` after touching routes.
1. **CodeQL `js/missing-rate-limiting` (`server.ts`)**:
   - Always keep `express-rate-limit` (`rateLimiterMiddleware`) mounted both globally (`app.use(rateLimiterMiddleware)`) and explicitly on any route calling `res.sendFile(...)`. Do not replace `express-rate-limit` with a custom `Map` rate limiter, as CodeQL only recognizes standard library middleware models. The per-minute limit defaults to 240 and may only be raised through `RATE_LIMIT_PER_MINUTE` (the e2e web server sets it, because the whole suite comes from one IP); never remove the middleware.
2. **CodeQL `js/request-forgery` / SSRF (`server.ts`)**:
   - When making outbound `fetch()` calls with query parameters derived from `req.query`, always construct a `new URL(...)` object, populate parameters with `.searchParams.set(...)`, and explicitly verify `url.origin === 'https://...'` before calling `fetch(url)`.
3. **CodeQL `js/polynomial-redos` (`src/utils/metrolistCore.ts`)**:
   - Never use regexes with nested quantifiers or ambiguous `.*?` on user-controlled strings (such as `/\[.*?\]|\(.*?token.*?\)/gi` or `/\/+$/`). Use linear $O(N)$ character loops (`stripAllBracketedSegmentsLinear`, `sanitizeApiQueryText`).
4. **Cross-Platform CI Lockfile Handling (`.github/workflows/release-native-builds.yml`)**:
   - Keep `package-lock.json` committed at the root so GitHub Dependabot can audit exact dependency versions (`vite >= 6.4.6`, `esbuild >= 0.25.0`, `express >= 4.21.2`).
   - In GitHub Actions jobs running on `macos-latest` or `windows-latest`, keep `rm -f package-lock.json` before `npm install --legacy-peer-deps` so npm fetches OS-specific native optional binaries (`@rollup/rollup-*`, `@tailwindcss/oxide-*`).
