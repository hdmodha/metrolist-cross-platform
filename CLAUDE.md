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
  npm run test:e2e                       # all projects: phone, small-phone, landscape-phone, tablet, desktop (layout spec on all; the rest on phone + desktop)
  npx playwright test --project=phone    # one device class
  ```
  Every external request is routed to fixtures in `e2e/fixtures/` (fake YouTube IFrame API, API answers, images); an unrouted external request fails the test.
- **Production Build (`dist/` frontend + `dist-server/server.mjs` bundled server)**:
  ```bash
  npm run build
  npm start                              # node dist-server/server.mjs (always production; PORT, RATE_LIMIT_PER_MINUTE)
  ```
- **Desktop app (Electron)**:
  ```bash
  npm run desktop:dev                    # Electron against the source (Vite middleware in the main process)
  npm run build && npm run build:electron && npx electron .   # the production build in Electron
  METROLIST_SMOKE_TEST=1 npx electron .  # start-up self-check: PASS / FAIL line, exit 0 / 1, 45 s timeout
  npm run test:electron                  # Playwright `_electron` suite (Linux: `xvfb-run -a npm run test:electron`)
  npm run desktop:pack                   # electron-builder, unpacked app for this OS (release/, git-ignored)
  npm run desktop:dist                   # installers for this OS: universal .dmg (macOS), NSIS setup .exe (Windows)
  ```
- **Ad-block rules for Android (after editing `src/shared/adBlock.ts`)**:
  ```bash
  npm run adblock:rules                  # regenerates src/shared/adBlockRules.json (a unit test fails while it is stale)
  ```
- **Verify Dependency Security (Zero Vulnerabilities Required)**:
  ```bash
  npm audit
  ```

---

## 2. High-Level Architecture & File Map

The app is a Spotify-style, multi-page music player inspired by Metrolist (YouTube Music client), built with **React 19 + TypeScript + Tailwind CSS v4 + Vite** on the frontend and an **Express** InnerTube proxy backend (`src/server/createServer.ts`, started by the `server.ts` CLI or inside the Electron desktop app). Every song is a YouTube Music song (there are no built-in songs); a fresh install starts with an empty library and nothing loaded.

```text
├── server.ts                              # CLI entry: env (PORT, NODE_ENV, RATE_LIMIT_PER_MINUTE) → startMetrolistServer (web mode); Vite only in dev (dynamic import)
├── scripts/build-node.mjs                 # esbuild: server.ts → dist-server/server.mjs (ESM), electron/main.ts → dist-electron/main.cjs (CJS); all deps bundled, vite external
├── scripts/generate-ad-block-rules.ts     # `npm run adblock:rules`: src/shared/adBlock.ts → src/shared/adBlockRules.json
├── electron/                              # Desktop app main process (TypeScript; type-checked by `npm run lint`)
│   ├── main.ts                            # Lifecycle: switches, single-instance lock, server on 127.0.0.1:47823, menus, mac hide-on-close, smoke test
│   ├── adBlocker.ts                       # session.webRequest.onBeforeRequest → shouldBlockRequest (every frame); logs the 1st and every 50th block
│   ├── mainWindow.ts / security.ts / menu.ts / smokeRunner.ts / jsonFile.ts
│   └── policies/                          # Pure, test-first: navigation (allow / external / deny), permissions, ports (fixed + fallback), windowState (clamp), smokeTest
├── e2e-electron/                          # Playwright `_electron` suite (playwright.electron.config.ts; NOT part of test:e2e)
├── electron-builder.yml                   # Packaging: files (dist/, dist-electron/, package.json only), universal dmg, NSIS per-user, Linux dir
├── build/icon.png                         # 1024 px app icon (electron-builder derives .icns / .ico; the rest of build/ is ignored)
├── capacitor.config.json                  # Capacitor config for Android (.apk) & iOS native packaging
├── src/
│   ├── server/
│   │   ├── createServer.ts                # Express app factory: mode 'web' | 'desktop', routes (search, recommendations, embeddable), rate limiter, InnerTube + oEmbed transports, SPA fallback
│   │   ├── hostAllowlist.ts               # Desktop DNS-rebinding check: Host must be 127.0.0.1:<port> / localhost:<port>
│   │   ├── serverConfig.ts                # PORT / RATE_LIMIT_PER_MINUTE parsing, dist/ location (source or bundled)
│   │   └── devFrontend.ts                 # Vite dev middlewares (dynamic import; npm run dev, desktop:dev)
│   ├── App.tsx                            # Shell: usePlayer() + useRoute() + useNowPlaying() in, chrome + current page out
│   ├── app/
│   │   ├── router.ts                      # Hash router: pure parseRoute / formatRoute + navigate() + history flags
│   │   ├── useRoute.ts                    # useSyncExternalStore on hashchange / popstate
│   │   ├── nowPlayingHistory.ts           # Pure rules tying Now Playing to the Back button
│   │   ├── useNowPlaying.ts               # Open / close Now Playing through one flagged history entry
│   │   └── AppActionsContext.tsx          # Stable app-wide handlers (player actions, go, goToArtist, open/close Now Playing)
│   ├── pages/                             # One job per page; React.memo'd; countRender probes
│   │   ├── HomePage.tsx                   # Greeting, Recently played, recommendations / "Popular right now", artists
│   │   ├── SearchPage.tsx                 # Search box, Recent searches + Browse tiles, results (query in the URL)
│   │   ├── LibraryPage.tsx                # Liked Songs / Downloads entries + Recently played
│   │   ├── CollectionPage.tsx             # Liked Songs and Downloads (Play, Shuffle, newest first, empty states)
│   │   └── useTrackSearch.ts, usePopularTracks.ts, usePlayList.ts
│   ├── components/                        # Presentational, React.memo'd; no playback logic
│   │   ├── Sidebar.tsx / BottomNav.tsx    # Desktop sidebar (>= 1024 px) / bottom tabs (< 1024 px)
│   │   ├── MiniPlayer.tsx                 # Docked above the tabs; tap opens Now Playing; ProgressLine
│   │   ├── PlayerBar.tsx                  # Desktop player bar (transport, seek, queue, volume, expand)
│   │   ├── NowPlaying.tsx                 # Full-screen dialog (chevron / Escape / Back / swipe-down to close)
│   │   ├── QueueSheet.tsx                 # Up next: reorder, remove, clear, "Autoplay similar songs" switch
│   │   ├── SongRow.tsx / SongCard.tsx     # The one row / card component; "⋮" opens TrackMenu
│   │   ├── TrackMenu.tsx + trackMenuItems.tsx  # Play next, Add to queue, Like, Download, Go to artist (portal + keyboard)
│   │   ├── SeekBar.tsx / ProgressLine.tsx # The ONLY components subscribed to the playback clock
│   │   ├── Notices.tsx                    # Notice toast + "Waiting for connection… retrying"
│   │   └── YouTubeStreamBridge.tsx        # YouTube IFrame Player API bridge (hidden; revealed only when autoplay needs a tap)
│   ├── data/
│   │   ├── track.ts                       # `MetrolistTrack` (id, videoId, title, artist, album, durationMs, coverUrl)
│   │   ├── browse.ts                      # Browse tiles, "Popular right now" query, featured artists
│   │   └── fallbackTracks.ts              # Offline-safe shelf (STATIC_YTM_FALLBACK)
│   ├── player/
│   │   ├── usePlayer.ts                   # The one hook with side effects (network, storage, stream, media keys, timers)
│   │   ├── playerCore.ts                  # Pure normalized PlayerState + playerReducer + selectors
│   │   ├── playerStore.ts                 # Tiny external store around the reducer (read via useSyncExternalStore)
│   │   ├── playbackClock.ts               # Playback position store outside React state
│   │   ├── effectPolicies.ts              # Pure decisions for side effects: stream-error recovery, embeddability pre-check targets, stall, save throttle, shortcuts
│   │   ├── streamErrors.ts                # IFrame error codes → reason + recovery (alternate / retry once / skip), notice texts
│   │   ├── alternateUploads.ts            # Scores / ranks / chooses another upload of the same song (linear, no regex over titles)
│   │   ├── queueRules.ts                  # Queue rules: next index, add to queue / play next, play-now queue, radio merge
│   │   └── retryPolicy.ts                 # Network back-off: 3 s · 2^attempt, capped at 30 s, 5 retries
│   └── utils/
│       ├── metrolistCore.ts               # Pure logic: InnerTube parsers (incl. radio pages) + shared request layer, song search terms, sanitizers
│       ├── apiClient.ts                   # Client network layer: `/api/*` backend, `VITE_API_BASE_URL`, native-shell direct InnerTube + oEmbed, search / embeddability caches
│       ├── embeddability.ts               # oEmbed URL (fixed, origin-checked), status → true / false / null, `ids` parameter and payload validation
│       ├── persistence.ts                 # Validated localStorage persistence (v2) + v1 migration + PlayerState mappers
│       ├── recentSearches.ts              # Recent searches (newest first, max 10, persisted)
│       ├── greeting.ts, lruCache.ts, menuNavigation.ts
│       └── renderProbe.ts                 # countRender(): no-op unless a browser test sets window.__renderProbe
│   └── shared/
│       ├── adBlock.ts                     # Pure ad / tracking blocklist: host + YouTube path rules, never-block list, shouldBlockRequest(url, resourceType)
│       └── adBlockRules.json              # The same rules as data for the Android app (generated; a test keeps it in sync)
│   (every pure module has its `*.test.ts` next to it; `npm test` runs them all)
├── playwright.config.ts                   # E2E: production server + static no-backend server, 5 Chromium device projects
├── e2e/
│   ├── fixtures/                          # test.ts (hermetic routes incl. `/api/innertube/embeddable` via `api.embeddable` + MetrolistApp driver), fakeYouTube.ts (`errorIds`, `readyDelayMs`, `probeUrls`, `loaded` history), apiFixtures.ts, storage.ts (seeded saved data), ports.ts
│   └── *.spec.ts                          # search, navigation, nowplaying, library, playback, queue, resilience, persistence, performance, native (no backend), layout
└── .github/workflows/
    ├── deploy-pages.yml                   # CI on pull requests into main only (not again on the merge push): unit tests, typecheck, build, Playwright e2e, Electron suite
    └── release-native-builds.yml          # Multi-OS release pipeline (Android APK, iOS, macOS, Windows, Web)
```

---

## 3. Core Data Flows

1. **Routing (`src/app/router.ts`)**:
   - Hash routes: `#/` (Home), `#/search?q=…`, `#/library`, `#/library/liked`, `#/library/downloads`; anything else renders Home. Hash routing works unchanged in the Capacitor WebView, on static hosts and in the desktop bundles (no server fallback needed). Links are real `<a href="#/…">` that call `navigate()`.
   - `navigate(route, { replace, flags })` pushes or replaces one entry (`navigationEffect`: the page already shown → nothing; the same page under another URL — no hash yet on a fresh start, an unknown route — → replace, so Back never lands on the same page); `flags` live in `history.state`: `searchFromEmpty` (the first query typed on the empty Search page pushed it) and `nowPlaying`.
   - Search: typing is debounced (320 ms) into the URL with `replace`, so refining never adds entries; the first query from the empty page pushes one entry, so Back returns to the empty Search page and Back again to the previous page. Clearing the box goes back over that entry instead of leaving it stale. Enter / the keyboard's Search key submits at once and blurs.

2. **Now Playing (`useNowPlaying.ts` + `nowPlayingHistory.ts`)**:
   - Opening pushes one entry flagged `nowPlaying` (same URL); Back pops it and closes the dialog; the chevron / Escape / swipe close at once and call `history.back()` to remove the entry. Navigating from inside Now Playing (e.g. "Go to artist") replaces the entry. While it is open the rest of the app is `inert`; focus moves to its close button and returns to the mini player / expand button.
   - Swipe-down: pointer events on touch (≥ 120 px or a fast flick); the queue sheet, sliders and menus are excluded (`data-no-swipe`).

3. **Live YouTube Music Search (`GET /api/innertube/search?q=...`)**:
   - `SearchPage.tsx` → `useTrackSearch` → `searchTracks()` in `src/utils/apiClient.ts` (only the newest request may update the results).
   - `searchInnerTubeTracks` (`src/utils/metrolistCore.ts`, shared by `server.ts` and the native shell) POSTs to `https://music.youtube.com/youtubei/v1/search` using client `WEB_REMIX`, first with the Songs filter (`EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D`), then with the Videos filter (`EgWKAQIQAWoKEAQQBRAVEBAQEQ%3D%3D`). **The Songs filter returns "No results" in regions / on networks without the YouTube Music song catalog, so the Videos fallback must stay.**
   - **One retry** (`withInnerTubeRetry`, `metrolistCore.ts`): every InnerTube call of the server transport and of the native-shell transport retries once on a timeout / network failure (never on an HTTP error status, `InnerTubeHttpError`, or a non-JSON body). All calls of one operation share one budget: server 8 s per attempt, 16 s per request (below the client's 20 s request timeout); native 8 s / 20 s. A single slow upstream answer used to fail the whole search with 502.
   - `parseInnerTubeSearchResponse` extracts `videoId`, `title`, `artist`, `album`, `durationMs`, and `thumbnailUrl` from both shelf formats (`Artist • Album • 3:22` and `Channel • 1.3B views • 4:33`).
   - The UI never substitutes unrelated songs for a search: it shows loading, "No songs found", or an error with Retry. Home's "Popular right now" (fresh install only) is a live search with `STATIC_YTM_FALLBACK` when it fails.

4. **YouTube Music Recommendations / Radio (`GET /api/innertube/recommendations?videoId=...`)**:
   - Whenever the active track id (or autoplay) changes, `usePlayer.ts` calls `fetchRecommendations()` and dispatches `recommendationsLoaded` / `recommendationsFailed` (fallback shelf). Home shows them as "Because you listened to <title>".
   - The server (`src/server/createServer.ts`) calls `https://music.youtube.com/youtubei/v1/next` with playlist `RDAMVM${seedVideoId}`.
   - `parseInnerTubeWatchNextPage` extracts recommended tracks (live streams and >20 min mixes are dropped) and the radio continuation token (`playlistPanelRenderer.continuations[0].nextRadioContinuationData.continuation`); the route answers `{ tracks, seedVideoId, continuation }`. With "Autoplay similar songs" on (`autoplayRadio`), the reducer appends them (`mergeRadioIntoQueue`) **only when 5 or fewer songs are left** — it never replaces the queue, so hand-queued songs survive.
   - **Radio continuation**: the same route with `&continuation=<token>` (≤ 1024 chars of `[A-Za-z0-9_\-%=.]`, checked by the linear `sanitizeRadioContinuation`; the seed must be a valid video id) re-sends the WatchNext body plus the URL-decoded token. That answer repeats the first page under `contents`, so only `continuationContents.playlistPanelContinuation` is parsed. Client: `fetchRadioContinuation()` in `apiClient.ts` (backend and native-shell paths). `usePlayer.ts` requests the next page whenever `selectRadioContinuationRequest(state)` is non-null (`radioPageRequested` → `radioPageLoaded` / `radioPageFailed`, retried with back-off via `radioRetry`); an aborted request must still dispatch `radioPageFailed`.

5. **Full-Song Audio Playback (`YouTubeStreamBridge.tsx`)**:
   - Every track streams at full length through the YouTube IFrame API. The bridge writes the position into the playback clock (it never runs while nothing is audible), reports `streamStatus` (`loading | buffering | playing | paused | blocked`) and the real duration. Seeks carry a token and are reported handled only once applied (a seek before the player is ready is kept); `initialPositionMs` creates / cues the player at a restored position, paused; a new `retryNonce` re-creates the player (network retry). Player errors follow `planStreamErrorRecovery` (see 5a); API unavailable / an error while offline → `networkLost` and back-off retries. When the player was created with autoplay but playback is no longer wanted at `onReady` (paused while it got ready), the bridge cues the video so autoplay does not start it.
   - **Connectivity blips must not interrupt playback** (`effectPolicies.ts`): a window `offline` event alone does nothing (YouTube keeps playing from its buffer). "Waiting for network" starts only on a real failure: the IFrame API cannot load, a player error while `navigator.onLine === false`, or ≥ 8 s stuck in `loading` / `buffering` while offline (`shouldWaitForNetworkAfterStall`). A retry never re-creates a stream whose status is `playing` (`planNetworkRetry` → `networkRestored`).
   - **Bridge callbacks must go through the `latest` ref** (`YouTubeStreamBridge.tsx`); `usePlayer.ts` callbacks read `store.getState()`. The player is long-lived; capturing props at mount made "track ended" act on a stale queue.
   - **Performance rule**: the position lives in `playbackClock.ts`, not React state. Only `SeekBar` and the mini player's `ProgressLine` (and handlers / persistence / MediaSession via `clock.subscribe`) read it; nothing above them (shell, pages, mini player, player bar, Now Playing, queue sheet) may re-render on ticks — the browser suite counts renders through `countRender`, with Now Playing open and closed.

5a. **Unplayable uploads: error classes, embeddability pre-check, alternate scoring**:
   - **Error classes** (`streamErrors.ts`): IFrame `onError` 2 (invalid id), 100 (removed / private), 101 / 150 (owner disallows embedding) → look for another upload at once; 5 (HTML5 player error, often transient) → re-create the player for the same video once (`retry`, tracked per `trackId videoId` in `usePlayer`), then another upload; 152 / 153 (embedder / referrer rejected: every upload would fail) → retry once, then skip. Each reason has its own notice (`unplayableNotice`: "…its owner turned that off. Skipping…", "…was removed from YouTube or is private…", …). Only content restrictions (2, 100, 101 / 150, the pre-check) mark a song unplayable.
   - **Pre-check** (`GET /api/innertube/embeddable?ids=a,b,c`, 1–10 ids): the server asks the fixed `https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=<id>` (`new URL` + `searchParams`, origin checked, 5 s timeout): 200 → `true`, 401 / 403 / 404 → `false`, anything else → `null` (unknown = playable). Definite answers are cached (LRU, 5000 entries, 6 h). oEmbed does not catch every restriction (some label videos pass and still raise 150), so the runtime recovery stays. Client: `checkEmbeddable` / `peekEmbeddability` (`apiClient.ts`; native shell: oEmbed GET through `CapacitorHttp`), answers cached per video id, `null` for 2 min; never rejects except on abort.
   - `usePlayer` checks `selectEmbedCheckTargets(state)` (the active song + the next 3 upcoming in play order, hand-queued first with shuffle, marked songs left out) whenever that list changes — no React state, so no extra renders. `planEmbedPrecheck` → unknown uploads are checked, blocked ones go to `findReplacementUpload`.
   - **`findReplacementUpload(trackId, videoId, reason)`** (one per upload, shared by the pre-check and the error recovery, so neither searches nor skips twice): `alternateSearchQuery` → `searchTracks` → `rankAlternateUploads` → the top 3 are checked with `checkEmbeddable` → `chooseAlternateUpload` (best known-embeddable, else best unknown, never a known-blocked one) → `alternateVideoFound { expectedVideoId }` (any song still on that upload; the track id stays, so queue, likes and history are intact). No acceptable upload → `trackUnplayable { videoId }`: the active song is skipped with the notice; an upcoming one is only marked (`unplayableTracks`, per session, not persisted). The reducer jumps over marked songs without loading them (one "…Skipped." notice), and a tap on one says why instead of loading it.
   - **Alternate scoring** (`alternateUploads.ts`, pure, linear): title word overlap without brackets / noise / artist words (45; under half in common → reject), artist named by the uploader, an exact "Artist - Title" side or the title, or the same "A - B" pair in either order (30), duration within 15 s (25, fading to 0 at 60 s, rejected beyond; placeholder durations count as unknown), −50 per kind of version marker on one side only (cover / karaoke / remix / slowed / reverb / sped up / nightcore / 8D / live / performance / festival / instrumental / piano / tutorial / extended / hour / dance practice / remake …). Minimum 75: without the artist signal nothing qualifies (an unlabelled cover by another channel is common). `alternateSearchQuery`: "<artist> <title>", or an "A - B" title as it is when A is not the uploader.
   - Two songs on the same upload (an alternate can be another song's own video): `startTrack` seeks to 0, because the bridge does not reload an unchanged video id.

6. **Queue rules (`pickNextQueueIndex`, `insertIntoQueueAfterCurrent`, `insertIntoQueueAsNext`, `buildPlayNowQueue`, `mergeRadioIntoQueue` in `src/player/queueRules.ts`)**:
   - Pure and unit-tested, used by the reducer. Invariant: once a song is active it is in the queue; the queue is empty exactly when nothing is active.

7. **Player core and library model (`src/player/playerCore.ts` + `usePlayer.ts`)**:
   - `playerReducer(state, action)` over a normalized `PlayerState`: `tracksById`, `queueIds`, `userQueuedIds`, `activeTrackId: string | null`, `playingFrom` ("Playing from …"), and the library as ordered id lists — `likedIds`, `downloadedIds` (newest first; liking / downloading puts a song in front, toggling again removes it) and `recentlyPlayedIds` (newest first, deduplicated, max 30, recorded when a song starts playing). Tracks no list refers to are garbage-collected. Selectors: `selectActiveTrack`, `selectQueueTracks`, `selectLikedTracks`, `selectDownloadedTracks`, `selectRecentlyPlayedTracks`, `selectRadioContinuationRequest`, ...
   - Rows play with `playFromList` (continue through the list it was picked from) or `playFromSearch` (one song; the radio continues); Shuffle uses `shuffleList`. No timers, clock or `Math.random` in the reducer: randomness and positions arrive in action payloads (injected by `usePlayer`). No-op actions return the same object; every change re-establishes the invariants (a seeded property test runs thousands of random action sequences).
   - "Download" only adds a song to the Downloads list — audio is not stored on the device, and the Downloads page says its songs still need a connection. Do not imply offline playback anywhere else.
   - Components only call `usePlayer().actions` (stable identities, shared through `AppActionsContext`).

8. **Persistence (`src/utils/persistence.ts`)**:
   - v2 under `metrolist.player.v2`: a track table plus the id lists above, the queue window (≤ 200 songs around the active one), active song, position, `playingFrom`, radio session and preferences (volume, mute, shuffle, repeat, autoplay). Everything read back is validated field by field; corrupt data falls back to a fresh install.
   - v1 (`metrolist.player.v1`) is migrated once on load: library tracks with `liked` → `likedIds`, `cachedOffline` → `downloadedIds`, the library order → Recently played; the old demo songs (`trk-…`), their flags, demo queue entries and the EQ gains are dropped; an active demo song leaves nothing active. v1 is removed only after v2 was written.
   - Launch restores the last queue, song and position, always paused (`loadPlayerState` → `fromPersistedState` → `restore`). Saves are debounced on state change; the position is saved at most every 5 s while playing, on pause, on `visibilitychange` → hidden and on `pagehide`. Recent searches live in `metrolist.recentSearches.v1`.

9. **Desktop app (`electron/`, Electron 45)**:
   - The main process starts the server in **desktop mode** (`startMetrolistServer({ mode: 'desktop' })`) and loads `http://127.0.0.1:<port>/`. **The port is fixed (47823, `policies/ports.ts`)**: localStorage — the whole library above — is per origin, and the origin includes the port, so a random port would lose the listener's data on every launch. Busy ports fall back to 47824–47827, then any port, with a one-time notice ("saved music not available in this session"). It is http, not a custom `app://` scheme, because the YouTube embed needs a normal http origin / referrer.
   - Desktop mode: binds 127.0.0.1 only (anything else throws), no CORS headers, `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (403 otherwise; DNS rebinding).
   - **Ad blocking** (`adBlocker.ts`, rules in `src/shared/adBlock.ts`): `session.defaultSession.webRequest.onBeforeRequest` (installed before the window loads) cancels what `shouldBlockRequest(details.url, details.resourceType)` matches, in every frame — the YouTube iframe included. Host rules (host + subdomains): `doubleclick.net`, `googleadservices.com`, `googlesyndication.com`, `google-analytics.com`, `googletagservices.com`, `adservice.google.com`. Path rules on `youtube.com` / `youtube-nocookie.com`: `/pagead/`, `/ptracking`, `/api/stats/ads`, `/api/stats/atr`, `/get_midroll_info`, `/youtubei/v1/log_event`. **Never blocked** (wins over every rule; a test proves no rule overlaps it): `googlevideo.com`, `ytimg.com`, `ggpht.com`, `googleusercontent.com`, `gstatic.com`, `googleapis.com`, `/iframe_api`, `/s/player/`, `/embed/`, `/youtubei/v1/player`, `/youtubei/v1/next`, `/api/stats/playback`, `/api/stats/watchtime` — YouTube may refuse playback without them; top-level navigations and non-http(s) URLs are never blocked. Every rule carries the reason it is safe; add rules conservatively, then run `npm run adblock:rules` (the JSON copy for Android; `adBlock.test.ts` fails while it is stale). No regex on URLs. Browsers cannot do this for the web build (README: use the browser's blocker).
   - Window security (`security.ts`): `contextIsolation`, `sandbox`, no `nodeIntegration`, no preload, no `<webview>`, DevTools only unpackaged. `will-navigate` / `setWindowOpenHandler` follow `decideNavigation`: same origin stays, other http(s) → `shell.openExternal`, everything else denied. Iframes (the YouTube player) are not window navigations. Permissions: only `fullscreen` and `clipboard-sanitized-write`; devices denied.
   - Behaviour: single-instance lock (a second launch shows the window); bounds / maximised saved in `userData/window-state.json`, clamped to a visible display (`policies/windowState.ts`); min 360×560; background `#09090B`, window title fixed to "Metrolist"; `backgroundThrottling: false` + `disable-renderer-backgrounding` / `disable-background-timer-throttling`; `autoplay-policy=no-user-gesture-required`. macOS: app / Edit (needed for Cmd+C / Cmd+V) / View / Window menus, closing hides (music keeps playing), Dock click shows, Cmd+Q quits. Windows / Linux: no menu, closing quits. Media keys come from the page's MediaSession code: never disable Chromium's `HardwareMediaKeyHandling`.
   - Bundling: `dist-electron/main.cjs` inlines everything except `electron` (and `vite`, only loaded by `--metrolist-dev`), so `app.asar` holds only `dist/`, `dist-electron/main.cjs` and a trimmed `package.json` — no `node_modules`, `src/` or source maps (check with `npx @electron/asar list release/*/resources/app.asar`). Serving `dist/` from inside `app.asar` works (Electron's fs patch).
   - **Smoke test**: `METROLIST_SMOKE_TEST=1` uses a throw-away `userData`, waits for the page, checks `<main>` + `nav[aria-label="Main"]` + a title naming Metrolist, requests `/manifest.webmanifest`, prints `METROLIST SMOKE TEST: PASS|FAIL (…)` and exits 0 / 1 (45 s timeout). No YouTube needed.
   - **Tests**: `npm run test:electron` launches the app with `--user-data-dir` per test, `--host-resolver-rules` (no external DNS) and a dead proxy for the in-process server (`NODE_USE_ENV_PROXY`), installs the web suite's routes on the page, then reloads. Page-level routes are required: context routes do not reach Electron's first window. `webRequest` runs before Playwright's page routes: a request the ad blocker cancels never reaches a route (the ad-blocking test routes the ad URL to `continue()` and also checks the main process's log line, because the suite's catch-all would abort with the same `ERR_BLOCKED_BY_CLIENT`). On Linux it adds `--no-sandbox` (root containers, Ubuntu 24.04 AppArmor).

---

## 4. Priority Bug Areas & Architectural Caveats to Investigate

When debugging or improving the application, prioritize checking these areas:

1. **Standalone Android APK / Mobile WebView Backend Connectivity**:
   - Inside a packaged Capacitor Android `.apk`, the frontend runs on `https://localhost` inside the Android WebView without the Node.js `server.ts` process running locally on the phone.
   - **Handled in `src/utils/apiClient.ts` — all network calls must go through it, never a bare `fetch('/api/...')`.** Inside the native shell (`window.Capacitor.isNativePlatform()`), search and radio call YouTube Music directly through Capacitor's native HTTP bridge (`Capacitor.nativePromise('CapacitorHttp', 'request', ...)`, no browser CORS).
   - `VITE_API_BASE_URL` (build-time) points any frontend at a deployed `server.ts`; `/api/*` sends permissive CORS headers for that purpose.
   - A plain static web host (no backend, not a native shell) cannot search: browsers block cross-origin calls to `music.youtube.com`. It needs `VITE_API_BASE_URL`.
   - The native path was verified against a simulated bridge only (no device build in CI): re-test on a real APK after touching `apiClient.ts`. The Android hardware Back button goes through `history.back()`, so it follows the router / Now Playing rules above (also untested on a device).

2. **YouTube IFrame Audio Restrictions on Mobile WebViews & Background Play**:
   - `YouTubeStreamBridge.tsx` uses a hidden `1x1` YouTube embed iframe. On mobile browsers (iOS Safari / Android WebView), autoplay without direct user gesture on the iframe or background screen-off playback can be throttled by the OS. When a requested start stays "unstarted", the bridge reports `blocked` and reveals the player with a "Tap the player to start playback" prompt (above Now Playing too).
   - Capacitor iOS serves the app from `capacitor://localhost`; YouTube embeds may reject that origin (untested).
   - Playback stays on the official IFrame player (decided): no `youtubei/v1/player` calls, no impersonated app clients for raw `googlevideo.com` URLs, no signature deciphering or PO / BotGuard tokens. So "Downloads" stays a list only; background play on Android is the next phase (shell-side, plus the shared ad-block rules in `src/shared/adBlockRules.json`).

3. **Desktop packaging and signing (`electron-builder.yml`, release workflow job `build-desktop-installers`)**:
   - macOS: one universal `.dmg` (`Metrolist-<v>-mac-universal.dmg`). electron-builder packs x64 and arm64 unsigned, merges them with `@electron/universal`, then signs the merged app once (`macPackager.doUniversalPack` → `doSignAfterPack`).
   - **Signing is ad-hoc** (no Apple Developer account); an unsigned arm64 app is killed on Apple Silicon. CI passes `-c.mac.identity=- -c.mac.hardenedRuntime=false -c.mac.timestamp=none` when the `CSC_LINK` secret is empty: `MacTargetHelper.findSigningIdentity` turns identity `"-"` into an ad-hoc `Identity("-")` and `@electron/osx-sign` runs `codesign --sign - --force` on every binary, deepest first. Hardened runtime stays off (library validation would reject ad-hoc-signed frameworks); `--timestamp=none` because ad-hoc signatures are not timestamped. Never put `identity: "-"` in the yml: it would stop a real certificate from being used.
   - With the secrets `CSC_LINK` (base64 `.p12` Developer ID Application) + `CSC_KEY_PASSWORD`, the certificate is found automatically and the default hardened runtime is used; with `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` it is also notarized (`MacTargetHelper.getNotarizeOptions`). Users then no longer need "Open Anyway".
   - CI proves the mac build with `codesign --verify --deep --strict`, `codesign -dv`, `lipo -archs` (arm64 + x86_64) and the packaged smoke test; Windows with the packaged `win-unpacked/Metrolist.exe` smoke test (the verdict is written to `METROLIST_SMOKE_TEST_REPORT`; the exit code decides).
   - Windows: NSIS, x64, one-click per-user install in `%LOCALAPPDATA%\Programs\Metrolist` (no admin), Start-menu + desktop shortcuts, uninstaller, keeps app data on uninstall. Not code-signed (SmartScreen "More info → Run anyway"); `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets would sign it. Installer, uninstaller and exe icons come from `build/icon.png`.

4. **Full-Length Duration Preservation**:
   - Never overwrite a track's `durationMs` with a 30-second preview duration (`PREVIEW_DURATION_MS`). Keep the full duration parsed from InnerTube (`ytTrack.durationMs`) or reported by `YouTubeStreamBridge.onTimeUpdateMs`.

---

## 5. Strict Security & CI Guardrails (Do Not Break)

GitHub **Dependabot** and **CodeQL** are active on this repository. Preserve these invariants when editing code:

0. **Express 5 routing (`src/server/createServer.ts`)**:
   - `express` resolves to 5.x. A bare `'*'` route pattern throws at startup there, so the SPA fallback is a path-less `app.use(rateLimiterMiddleware, ...)`. Always smoke-test `NODE_ENV=production npx tsx server.ts` and `npm run build && npm start` after touching routes.
   - The server code must not use `import.meta` (it is also bundled to CJS for Electron); `server.ts` is the only place that does.
1. **CodeQL `js/missing-rate-limiting` (`src/server/createServer.ts`)**:
   - The rate limiter lives in the factory, so every mode (web, desktop, dev) gets it. Always keep `express-rate-limit` (`rateLimiterMiddleware`) mounted both globally (`app.use(rateLimiterMiddleware)`) and explicitly on any route calling `res.sendFile(...)`. Do not replace `express-rate-limit` with a custom `Map` rate limiter, as CodeQL only recognizes standard library middleware models. The per-minute limit defaults to 240 and may only be raised through `RATE_LIMIT_PER_MINUTE` (the e2e web server sets it, because the whole suite comes from one IP); never remove the middleware.
2. **CodeQL `js/request-forgery` / SSRF (`src/server/createServer.ts`, `innerTubeTransport`, `oEmbedStatus`; `src/utils/embeddability.ts` `buildOEmbedUrl`)**:
   - When making outbound `fetch()` calls with query parameters derived from `req.query`, always construct a `new URL(...)` object, populate parameters with `.searchParams.set(...)`, and explicitly verify `url.origin === 'https://...'` before calling `fetch(url)`.
3. **CodeQL `js/polynomial-redos` (`src/utils/metrolistCore.ts`, `src/player/alternateUploads.ts`, `src/shared/adBlock.ts`)**:
   - Never use regexes with nested quantifiers or ambiguous `.*?` on user-controlled strings (such as `/\[.*?\]|\(.*?token.*?\)/gi` or `/\/+$/`). Use linear $O(N)$ character loops (`stripAllBracketedSegmentsLinear`, `sanitizeApiQueryText`).
4. **`minimatch` override for electron-builder (`package.json` `overrides`)**:
   - `app-builder-lib` (`minimatch@^10.2.5`) and `@electron/universal` (`minimatch@^9.0.3`) are forced to `minimatch@11.0.1`, and its dependency `@isaacs/nonrecursive-glob-match` to `1.0.1`, because of GHSA-g3hv-75wg-m249 (minimatch DoS, fixed only in 11.0.1+). It is build-time only: none of it ships in the app. The range-scoped keys leave the unaffected minimatch 3.x / 5.x copies (`@electron/asar`, `glob`, `dir-compare`, `filelist`) alone.
   - **Remove these three entries once electron-builder depends on minimatch >= 11.0.1 by itself**, then check `npx -y npm@11.21.1 ls minimatch` and `npm audit` (npm 10's `npm ls` reports the range-scoped overrides as "invalid" and exits 1 even when the tree is right).
   - npm 10 ignores these scoped overrides when it resolves without a lockfile, so the mac / win release jobs install with `npx npm@11.21.1` and fail on `npm ls minimatch` if an override was not applied. Installs from the committed lockfile (npm 10 or 11) are correct.
5. **Desktop server isolation (`src/server/createServer.ts`, `hostAllowlist.ts`)**:
   - Desktop mode binds `127.0.0.1` only, sends no CORS headers and rejects any `Host` other than `127.0.0.1:<port>` / `localhost:<port>`. Never relax these: the desktop server is reachable by every page the user visits. Keep the window settings in `electron/security.ts` (`contextIsolation`, `sandbox`, no `nodeIntegration`, navigation / window-open / permission policies).
6. **Cross-Platform CI Lockfile Handling (`.github/workflows/release-native-builds.yml`)**:
   - Keep `package-lock.json` committed at the root so GitHub Dependabot can audit exact dependency versions (`vite >= 6.4.6`, `esbuild >= 0.25.0`, `express >= 4.21.2`).
   - In GitHub Actions jobs running on `macos-latest` or `windows-latest`, keep `rm -f package-lock.json` before the install (`npx -y npm@11.21.1 install --legacy-peer-deps`, see item 4) so npm fetches OS-specific native optional binaries (`@rollup/rollup-*`, `@tailwindcss/oxide-*`).
