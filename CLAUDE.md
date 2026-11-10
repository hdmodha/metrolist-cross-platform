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
- **Run Pure Logic & Security Unit Tests (`node:test`)**:
  ```bash
  npx tsx --test src/utils/metrolistCore.test.ts
  ```
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

The app is a single-page, Spotify-style cross-platform music player inspired by Metrolist (YouTube Music client), built with **React 19 + TypeScript + Tailwind CSS v4 + Vite** on the frontend and an **Express (`server.ts`)** InnerTube/LRCLIB proxy backend.

```text
├── server.ts                              # Express backend: InnerTube search, RDAMVM recommendations, LRCLIB resolver
├── capacitor.config.json                  # Capacitor config for Android (.apk) & iOS native packaging
├── src/
│   ├── App.tsx                            # Root SPA state: playback lifecycle, queue, MediaSession, recommendations
│   ├── data/
│   │   └── metrolistData.ts               # Initial seed catalog, TypeScript interfaces (seed covers resolved via `new URL(..., import.meta.url)`)
│   ├── components/
│   │   ├── PlayerLibraryView.tsx          # Main Spotify-style view: Hero card, Live YT Search, Up Next Radio, Library
│   │   ├── LyricsAndQueueDrawer.tsx       # Right drawer: Synced LRC lyrics, Up Next Queue manager, 5-Band Parametric EQ
│   │   └── YouTubeStreamBridge.tsx        # YouTube IFrame Player API bridge (hidden; revealed only when autoplay needs a tap)
│   └── utils/
│       ├── metrolistCore.ts               # Pure logic: InnerTube parsers + shared request layer, queue rules, lyrics terms, sanitizers
│       ├── metrolistCore.test.ts          # Automated unit test suite (node:test)
│       ├── apiClient.ts                   # Client network layer: `/api/*` backend, `VITE_API_BASE_URL`, native-shell direct InnerTube
│       ├── persistence.ts                 # Validated localStorage persistence (library, likes, volume, shuffle/repeat, EQ)
│       └── webAudioSynth.ts               # Web Audio API 5-band BiquadFilter EQ + real-time FFT spectrum analyzer
└── .github/workflows/
    ├── deploy-pages.yml                   # CI Build, TypeScript check, and unit test workflow on push/PR
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
   - Whenever the active track id changes in `src/App.tsx`, it calls `fetchRecommendations()` (`/api/innertube/recommendations`).
   - `server.ts` calls `https://music.youtube.com/youtubei/v1/next` with playlist `RDAMVM${seedVideoId}`.
   - `parseInnerTubeWatchNextResponse` extracts recommended tracks (live streams and >20 min mixes are dropped). When `autoplayRadio` is `ON`, `mergeRadioIntoQueue` appends them **only when fewer than 3 songs are left** — it never replaces the queue, so hand-queued songs survive.

3. **Full-Song Audio Playback (`YouTubeStreamBridge.tsx` vs `audioEngine.ts`)**:
   - **Live YouTube Music tracks (`isLiveInnerTube: true`)**: Streamed at full length via `YouTubeStreamBridge.tsx` (YouTube IFrame API). The bridge alone drives `currentTimeMs` (the clock never runs while nothing is audible), reports `streamStatus` (`loading | buffering | playing | paused | blocked`) and updates `durationMs` if the real stream duration exceeds 30s. Player errors trigger a search for another upload of the same song, then a skip; they never fall back to the synth.
   - **Bridge callbacks must go through the `latest` ref** (`YouTubeStreamBridge.tsx`) and App handlers through `latest.current` (`App.tsx`). The player is created once; capturing props at mount made "track ended" act on a stale queue.
   - **Local Studio Synth seed tracks (`isLiveInnerTube: false`)**: Synthesized in real time via `src/utils/audioEngine.ts` using Web Audio oscillators + 5-band parametric `BiquadFilterNode` chain.

4. **Synced Lyrics Resolution (`GET /api/innertube/resolve?title=...&artist=...&videoId=...`)**:
   - `deriveLyricsSearchTerms` cleans YouTube-style titles (`Artist - Song (Official Video)`), then `https://lrclib.net/api/search` is queried by `track_name` + `artist_name` and, failing that, by free-text `q`. `pickBestLyricsMatch` prefers the synced record closest in duration to the stream.
   - Parsed by `parseLyricsLrc` (`src/utils/metrolistCore.ts`) in linear $O(N)$ time and binary-searched during playback via `findActiveLyricIndex`.

5. **Queue rules (`pickNextQueueIndex`, `insertIntoQueueAfterCurrent`, `buildPlayNowQueue`, `mergeRadioIntoQueue` in `metrolistCore.ts`)**:
   - Pure and unit-tested. Next / Previous / track-ended / repeat (`OFF | ALL | ONE`) / shuffle all go through `skipTrack()` in `App.tsx`. Invariant: the playing track is always in `queue`.

---

## 4. Priority Bug Areas & Architectural Caveats to Investigate

When debugging or improving the application, prioritize checking these areas:

1. **Standalone Android APK / Mobile WebView Backend Connectivity**:
   - Inside a packaged Capacitor Android `.apk`, the frontend runs on `https://localhost` inside the Android WebView without the Node.js `server.ts` process running locally on the phone.
   - **Handled in `src/utils/apiClient.ts` — all network calls must go through it, never a bare `fetch('/api/...')`.** Inside the native shell (`window.Capacitor.isNativePlatform()`), search and radio call YouTube Music directly through Capacitor's native HTTP bridge (`Capacitor.nativePromise('CapacitorHttp', 'request', ...)`, no browser CORS), and lyrics call LRCLIB directly (it allows CORS).
   - `VITE_API_BASE_URL` (build-time) points any frontend at a deployed `server.ts`; `/api/*` sends permissive CORS headers for that purpose.
   - A plain static web host (no backend, not a native shell) cannot search: browsers block cross-origin calls to `music.youtube.com`. It needs `VITE_API_BASE_URL`.
   - The native path was verified against a simulated bridge only (no device build in CI): re-test on a real APK after touching `apiClient.ts`.

2. **YouTube IFrame Audio Restrictions on Mobile WebViews & Background Play**:
   - `YouTubeStreamBridge.tsx` uses a hidden `1x1` YouTube embed iframe. On mobile browsers (iOS Safari / Android WebView), autoplay without direct user gesture on the iframe or background screen-off playback can be throttled by the OS. When a requested start stays "unstarted", the bridge reports `blocked` and reveals the player with a "Tap the player to start playback" prompt.
   - Capacitor iOS serves the app from `capacitor://localhost`; YouTube embeds may reject that origin (untested).
   - Replacing or augmenting `YouTubeStreamBridge.tsx` with direct audio stream extraction (`<audio>` element connected to `AudioContext`) enables true background playback and allows the 5-band Web Audio EQ (`audioEngine.ts`) to process live YouTube tracks directly.

3. **Full-Length Duration Preservation**:
   - Never overwrite a track's `durationMs` with a 30-second preview duration (`previewUrl` from iTunes is ~30s). Keep the full duration parsed from InnerTube (`ytTrack.durationMs`) or reported by `YouTubeStreamBridge.onTimeUpdateMs`.

---

## 5. Strict Security & CI Guardrails (Do Not Break)

GitHub **Dependabot** and **CodeQL** are active on this repository. Preserve these invariants when editing code:

0. **Express 5 routing (`server.ts`)**:
   - `express` resolves to 5.x. A bare `'*'` route pattern throws at startup there, so the SPA fallback is a path-less `app.use(rateLimiterMiddleware, ...)`. Always smoke-test `NODE_ENV=production npx tsx server.ts` after touching routes.
1. **CodeQL `js/missing-rate-limiting` (`server.ts`)**:
   - Always keep `express-rate-limit` (`rateLimiterMiddleware`) mounted both globally (`app.use(rateLimiterMiddleware)`) and explicitly on any route calling `res.sendFile(...)`. Do not replace `express-rate-limit` with a custom `Map` rate limiter, as CodeQL only recognizes standard library middleware models.
2. **CodeQL `js/request-forgery` / SSRF (`server.ts`)**:
   - When making outbound `fetch()` calls with query parameters derived from `req.query`, always construct a `new URL(...)` object, populate parameters with `.searchParams.set(...)`, and explicitly verify `url.origin === 'https://...'` before calling `fetch(url)`.
3. **CodeQL `js/polynomial-redos` (`src/utils/metrolistCore.ts`)**:
   - Never use regexes with nested quantifiers or ambiguous `.*?` on user-controlled strings (such as `/\[.*?\]|\(.*?token.*?\)/gi` or `/\/+$/`). Use linear $O(N)$ character loops (`stripBracketedAnnotationsLinear`, `sanitizeApiQueryText`).
4. **Cross-Platform CI Lockfile Handling (`.github/workflows/release-native-builds.yml`)**:
   - Keep `package-lock.json` committed at the root so GitHub Dependabot can audit exact dependency versions (`vite >= 6.4.6`, `esbuild >= 0.25.0`, `express >= 4.21.2`).
   - In GitHub Actions jobs running on `macos-latest` or `windows-latest`, keep `rm -f package-lock.json` before `npm install --legacy-peer-deps` so npm fetches OS-specific native optional binaries (`@rollup/rollup-*`, `@tailwindcss/oxide-*`).
