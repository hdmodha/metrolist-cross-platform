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

## 2. Architecture in One Minute

- Pure logic is test-first: `src/player/playerCore.ts` (reducer + selectors), `queueRules.ts`, `effectPolicies.ts`, `src/app/router.ts`, `src/app/nowPlayingHistory.ts`, `src/utils/persistence.ts`, `src/utils/recentSearches.ts`. Write the failing `node:test` test first; keep the reducer free of time and randomness (inject them through action payloads).
- `src/player/usePlayer.ts` is the only hook with side effects. Components and pages are presentational (`React.memo`) and call the stable `usePlayer().actions` (shared through `AppActionsContext`).
- The playback position never goes into React state: only `SeekBar` and `ProgressLine` subscribe to the playback clock. The e2e render proof fails if anything else re-renders on ticks.
- Routing is a dependency-free hash router; Now Playing's open state is backed by one history entry so Back closes it.
- Every song is a YouTube Music song. "Download" only adds a song to the Downloads list (no audio is stored) — do not imply offline playback.
- See `./CLAUDE.md` for the file map, data flows and caveats.

## 3. Prioritized Backlog for Collaborating LLMs

### Priority 1: Verify the Standalone Mobile App on Real Devices
- The packaged Android / iOS app calls YouTube Music directly through Capacitor's native HTTP bridge (`src/utils/apiClient.ts`) and relies on the hash router for the hardware Back button. Both were verified against simulated environments only: test a real APK / iOS build.

### Priority 2: Direct Audio Streams (Background Play, Real Downloads)
- `src/components/YouTubeStreamBridge.tsx` plays through a hidden YouTube IFrame. Mobile WebViews may throttle it in the background, and the audio cannot be stored. A direct `<audio>` stream path (keeping the bridge as a fallback) would allow background playback and real offline Downloads.

### Priority 3: Playlists
- The library has Liked Songs, Downloads and Recently played (`likedIds`, `downloadedIds`, `recentlyPlayedIds` in the player core, persisted in `metrolist.player.v2`). User playlists would follow the same pattern: an ordered id list in the reducer, a v3 persistence shape with a migration test, and a page under `#/library/…`.

---

## 4. Security & CI Rules (CodeQL + Dependabot)

- **Never remove `express-rate-limit` from `server.ts`**: CodeQL rule `js/missing-rate-limiting` requires `rateLimit(...)` from `express-rate-limit` on routes serving files.
- **Never pass raw string URLs with user query params to `fetch()` in `server.ts`**: Always use `new URL(...)` + `.searchParams.set(...)` + explicit `url.origin` verification to satisfy CodeQL rule `js/request-forgery`.
- **Never introduce super-linear regexes in `src/utils/metrolistCore.ts`**: Use linear $O(N)$ string scanning to satisfy CodeQL rule `js/polynomial-redos`.
- **Keep `vite >= 6.4.6` and `esbuild >= 0.25.0` in `package.json`**: Required to keep GitHub Dependabot at 0 alerts.
