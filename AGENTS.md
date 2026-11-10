# AGENTS.md — Universal Multi-Agent & LLM Collaboration Spec

This repository is structured for multi-LLM collaboration (Claude Code, GitHub Copilot, Cursor, Windsurf, Codex, Gemini). Before modifying any code, read this specification and `./CLAUDE.md`.

---

## 1. Mandatory Verification Loop Before Every Commit

Every AI agent making changes to this repository **must** run all four checks below and confirm zero errors before finishing a task:

```bash
# 1. Run all unit & security tests (every src/**/*.test.ts, all must pass)
npm test

# 2. Run TypeScript compiler typecheck (must exit 0)
npm run lint

# 3. Run production Vite bundle build (must exit 0)
npm run build

# 4. Run the hermetic end-to-end browser suite (phone, small phone, landscape phone, tablet, desktop)
npm run test:e2e
```

---

## 2. Prioritized Bug & Improvement Backlog for Collaborating LLMs

When asked to fix bugs or improve playback reliability across platforms, address these items in order:

### Priority 1: Standalone Mobile APK / Static Client API Fallback — IMPLEMENTED (`src/utils/apiClient.ts`)
- **Status**: `VITE_API_BASE_URL` support plus a direct InnerTube path through Capacitor's native HTTP bridge are in place. Still to do: verify on a real device build.
- **Original symptom**: In the Capacitor Android `.apk` (`com.metrolist.music`), the app runs inside an Android WebView at `https://localhost` without the Node.js `server.ts` backend running on the device. Relative calls to `/api/innertube/search` and `/api/innertube/recommendations` fail unless a remote backend URL or client-side fallback is configured.
- **Target Files**: `src/App.tsx`, `src/components/PlayerLibraryView.tsx`, `capacitor.config.json`.
- **Recommended Solution**:
  - Introduce an `API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''` helper.
  - Add a resilient client-side fallback when `/api/innertube/*` is unreachable in standalone mobile builds (e.g., using CORS-enabled music search/stream endpoints).

### Priority 2: Unified Audio Element & Web Audio EQ for Live Streams
- **Symptom**: `src/components/YouTubeStreamBridge.tsx` plays live YouTube Music tracks via a hidden `1x1` YouTube IFrame (`www.youtube.com`). Because cross-origin `<iframe>` audio cannot be routed into a Web Audio `MediaElementAudioSourceNode`, the 5-band parametric EQ and real-time FFT visualizer in `src/utils/webAudioSynth.ts` only affect synthesized audio rather than the YouTube IFrame output, and mobile WebViews may block unmuted background iframe playback.
- **Target Files**: `src/components/YouTubeStreamBridge.tsx`, `src/utils/webAudioSynth.ts`, `src/App.tsx`.
- **Recommended Solution**:
  - Add direct audio stream extraction or `<audio crossOrigin="anonymous">` playback fallback connected to `sharedAudioEngine`, while keeping `YouTubeStreamBridge` as a fallback when direct stream URLs are unavailable.

### Priority 3: Persistent User Library (Liked Songs, Playlists & Queue) — PARTLY IMPLEMENTED (`src/utils/persistence.ts`)
- **Status**: library, likes, download flags, volume, shuffle / repeat, autoplay and EQ gains persist in `localStorage`. The queue, current song, position and radio session persist too and are restored (paused) on launch (`usePlayer.ts` → `persistence.ts`). Playlists are not persisted yet.
- **Original symptom**: Liked songs (`liked`), offline cache toggles (`cachedOffline`), EQ gains (`eqGains`), and custom queue order reset on page reload because state in `src/App.tsx` is currently held in React memory (`useState`).
- **Target Files**: `src/App.tsx`.
- **Recommended Solution**:
  - Persist `liked` track IDs, `queue`, `eqGains`, `volume`, and `autoplayRadio` in `localStorage` (or `IndexedDB`) with safe JSON schema validation.

---

## 3. Security & CI Rules (CodeQL + Dependabot)

- **Never remove `express-rate-limit` from `server.ts`**: CodeQL rule `js/missing-rate-limiting` requires `rateLimit(...)` from `express-rate-limit` on routes serving files.
- **Never pass raw string URLs with user query params to `fetch()` in `server.ts`**: Always use `new URL(...)` + `.searchParams.set(...)` + explicit `url.origin` verification to satisfy CodeQL rule `js/request-forgery`.
- **Never introduce super-linear regexes in `src/utils/metrolistCore.ts`**: Use linear $O(N)$ string scanning to satisfy CodeQL rule `js/polynomial-redos`.
- **Keep `vite >= 6.4.6` and `esbuild >= 0.25.0` in `package.json`**: Required to keep GitHub Dependabot at 0 alerts.
