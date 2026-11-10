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
│   │   └── mockData.ts                    # Initial seed catalog, EQ band definitions, TypeScript interfaces
│   ├── components/
│   │   ├── PlayerLibraryView.tsx          # Main Spotify-style view: Hero card, Live YT Search, Up Next Radio, Library
│   │   ├── LyricsAndQueueDrawer.tsx       # Right drawer: Synced LRC lyrics, Up Next Queue manager, 5-Band Parametric EQ
│   │   └── YouTubeStreamBridge.tsx        # Hidden YouTube IFrame Player API bridge for full-duration song streaming
│   └── utils/
│       ├── metrolistCore.ts               # Pure parsers (InnerTube WEB_REMIX, WatchNext RDAMVM, LRC parser, sanitizers)
│       ├── metrolistCore.test.ts          # Automated unit test suite (node:test)
│       └── audioEngine.ts                 # Web Audio API 5-band BiquadFilter EQ + real-time FFT spectrum analyzer
└── .github/workflows/
    ├── deploy-pages.yml                   # CI Build, TypeScript check, and unit test workflow on push/PR
    └── release-native-builds.yml          # Multi-OS release pipeline (Android APK, iOS, macOS, Windows, Web)
```

---

## 3. Core Data Flows

1. **Live YouTube Music Search (`GET /api/innertube/search?q=...`)**:
   - `PlayerLibraryView.tsx` debounces user input (320ms) and calls `/api/innertube/search`.
   - `server.ts` sends a `POST` request to `https://music.youtube.com/youtubei/v1/search` using client `WEB_REMIX` (`params: EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D` for songs).
   - `parseInnerTubeSearchResponse` in `src/utils/metrolistCore.ts` extracts `videoId`, `title`, `artist`, `album`, `durationMs`, and `thumbnailUrl`.

2. **YouTube Music Recommendations / Radio (`GET /api/innertube/recommendations?videoId=...`)**:
   - Whenever `activeTrack` changes in `src/App.tsx`, it queries `/api/innertube/recommendations`.
   - `server.ts` calls `https://music.youtube.com/youtubei/v1/next` with playlist `RDAMVM${seedVideoId}`.
   - `parseInnerTubeWatchNextResponse` extracts up to 12 recommended tracks. When `autoplayRadio` is `ON`, recommendations automatically populate the `Up Next` queue.

3. **Full-Song Audio Playback (`YouTubeStreamBridge.tsx` vs `audioEngine.ts`)**:
   - **Live YouTube Music tracks (`isLiveInnerTube: true`)**: Streamed at full length via `YouTubeStreamBridge.tsx` (YouTube IFrame API). `ytBridgeActivelyPlaying` lets the bridge drive `currentTimeMs` and updates `durationMs` if the real stream duration exceeds 30s.
   - **Local Studio Synth seed tracks (`isLiveInnerTube: false`)**: Synthesized in real time via `src/utils/audioEngine.ts` using Web Audio oscillators + 5-band parametric `BiquadFilterNode` chain.

4. **Synced Lyrics Resolution (`GET /api/innertube/resolve?title=...&artist=...&videoId=...`)**:
   - Queries `https://lrclib.net/api/search` for time-synced `.lrc` lyrics (`syncedLyrics`).
   - Parsed by `parseLyricsLrc` (`src/utils/metrolistCore.ts`) in linear $O(N)$ time and binary-searched during playback via `findActiveLyricIndex`.

---

## 4. Priority Bug Areas & Architectural Caveats to Investigate

When debugging or improving the application, prioritize checking these areas:

1. **Standalone Android APK / Mobile WebView Backend Connectivity**:
   - Inside a packaged Capacitor Android `.apk`, the frontend runs on `https://localhost` inside the Android WebView without the Node.js `server.ts` process running locally on the phone.
   - Relative `fetch('/api/innertube/...')` calls in `src/App.tsx` and `src/components/PlayerLibraryView.tsx` will fail in a standalone `.apk` unless either:
     - `VITE_API_BASE_URL` is prepended to `/api/...` requests pointing to a deployed backend server, **or**
     - Client-side fallback resolvers (direct `https://lrclib.net/api/search`, public Piped/Invidious/iTunes CORS endpoints) are used when `/api/innertube/*` is unreachable.

2. **YouTube IFrame Audio Restrictions on Mobile WebViews & Background Play**:
   - `YouTubeStreamBridge.tsx` uses a hidden `1x1` YouTube embed iframe. On mobile browsers (iOS Safari / Android WebView), autoplay without direct user gesture on the iframe or background screen-off playback can be throttled by the OS.
   - Replacing or augmenting `YouTubeStreamBridge.tsx` with direct audio stream extraction (`<audio>` element connected to `AudioContext`) enables true background playback and allows the 5-band Web Audio EQ (`audioEngine.ts`) to process live YouTube tracks directly.

3. **Full-Length Duration Preservation**:
   - Never overwrite a track's `durationMs` with a 30-second preview duration (`previewUrl` from iTunes is ~30s). Keep the full duration parsed from InnerTube (`ytTrack.durationMs`) or reported by `YouTubeStreamBridge.onTimeUpdateMs`.

---

## 5. Strict Security & CI Guardrails (Do Not Break)

GitHub **Dependabot** and **CodeQL** are active on this repository. Preserve these invariants when editing code:

1. **CodeQL `js/missing-rate-limiting` (`server.ts`)**:
   - Always keep `express-rate-limit` (`rateLimiterMiddleware`) mounted both globally (`app.use(rateLimiterMiddleware)`) and explicitly on any route calling `res.sendFile(...)`. Do not replace `express-rate-limit` with a custom `Map` rate limiter, as CodeQL only recognizes standard library middleware models.
2. **CodeQL `js/request-forgery` / SSRF (`server.ts`)**:
   - When making outbound `fetch()` calls with query parameters derived from `req.query`, always construct a `new URL(...)` object, populate parameters with `.searchParams.set(...)`, and explicitly verify `url.origin === 'https://...'` before calling `fetch(url)`.
3. **CodeQL `js/polynomial-redos` (`src/utils/metrolistCore.ts`)**:
   - Never use regexes with nested quantifiers or ambiguous `.*?` on user-controlled strings (such as `/\[.*?\]|\(.*?token.*?\)/gi` or `/\/+$/`). Use linear $O(N)$ character loops (`stripBracketedAnnotationsLinear`, `sanitizeApiQueryText`).
4. **Cross-Platform CI Lockfile Handling (`.github/workflows/release-native-builds.yml`)**:
   - Keep `package-lock.json` committed at the root so GitHub Dependabot can audit exact dependency versions (`vite >= 6.4.6`, `esbuild >= 0.25.0`, `express >= 4.21.2`).
   - In GitHub Actions jobs running on `macos-latest` or `windows-latest`, keep `rm -f package-lock.json` before `npm install --legacy-peer-deps` so npm fetches OS-specific native optional binaries (`@rollup/rollup-*`, `@tailwindcss/oxide-*`).
