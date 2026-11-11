# Contributing to Metrolist Cross-Platform

Thank you for contributing to **Metrolist**! This project provides a fast, ad-free, cross-platform music player powered by YouTube Music (`InnerTube WEB_REMIX`) for **macOS, Windows, Android, iOS, and Web**.

---

## 1. Getting Started (Local Setup)

1. **Fork & Clone** the repository:
   ```bash
   git clone https://github.com/<your-username>/metrolist.git
   cd metrolist
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Run the development server** (starts both the Express InnerTube proxy and Vite frontend on `http://localhost:3000`):
   ```bash
   npm run dev
   ```

---

## 2. Running Tests & Type Checks

Before opening a Pull Request, please ensure all unit tests and TypeScript checks pass:

```bash
# Run every unit test (player core, queue rules, router, InnerTube parsers, persistence + migration, security)
npm test

# End-to-end browser tests (Playwright + Chromium; builds the app and starts its servers itself).
# Hermetic: YouTube, the API and artwork are simulated, no internet needed. Runs on phone,
# small-phone, landscape-phone, tablet and desktop viewports.
npx playwright install chromium   # once per machine
npm run test:e2e

# Run TypeScript type checking
npm run lint

# Verify production build
npm run build

# Production server smoke start (bundled server)
PORT=3078 npm start

# Desktop app tests (see section 3)
npm run test:electron
```

### Writing code
- Pure logic (player core, queue rules, router, persistence) is test-first: add the failing `node:test` test next to the module, then the code.
- Keep components presentational and `React.memo`'d; side effects belong in `src/player/usePlayer.ts`.
- Never put the playback position in React state (the e2e render proof checks it).
- Changing the saved data shape? Bump the persistence version and add a migration test (see `src/utils/persistence.test.ts`).

---

## 3. Building Native Packages Locally

### Desktop app (Electron)
The main process lives in `electron/` (TypeScript, bundled by esbuild to `dist-electron/main.cjs`); it starts the server from `src/server/createServer.ts` in desktop mode and opens `http://127.0.0.1:47823/`.

```bash
# Run against the source (Vite serves the frontend inside the app)
npm run desktop:dev

# Run the production build in Electron
npm run build && npm run build:electron
npx electron .

# Start-up self-check (prints a PASS / FAIL line, exits 0 / 1)
METROLIST_SMOKE_TEST=1 npx electron .

# Desktop end-to-end tests (Playwright's Electron support; builds first)
npm run test:electron               # macOS / Windows
xvfb-run -a npm run test:electron   # Linux (virtual display)
```

On Linux, Electron refuses to start as root without `--no-sandbox` (the test helper adds it on Linux only).

Packaging uses electron-builder (`electron-builder.yml`, icons from `build/icon.png`; output in `release/`, git-ignored):

```bash
npm run desktop:pack   # unpacked app for this OS (release/mac-universal/Metrolist.app, release/win-unpacked/, release/linux-unpacked/)
npm run desktop:dist   # installers for this OS: universal .dmg on macOS, NSIS setup .exe on Windows
                       # (Linux is not shipped; there it only builds the unpacked app)

# Check the packaged app starts
METROLIST_SMOKE_TEST=1 release/mac-universal/Metrolist.app/Contents/MacOS/Metrolist      # macOS
METROLIST_SMOKE_TEST=1 xvfb-run -a release/linux-unpacked/metrolist --no-sandbox         # Linux
```

On a Mac without a Developer ID certificate, sign ad-hoc like CI does, or Apple Silicon kills the app:
`npx electron-builder --mac --universal --publish never -c.mac.identity=- -c.mac.hardenedRuntime=false -c.mac.timestamp=none`.
The release workflow (`.github/workflows/release-native-builds.yml`) builds both installers, smoke-tests the packaged apps on real macOS and Windows runners and attaches the installers to the release. Run it manually with **publish** unticked to test-build a branch without creating a release.

### Android (`.apk`) & iOS (`.ipa` / Xcode) via Capacitor
```bash
npm run build
npm install --no-save @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap add android
npx cap add ios
npx cap sync

# Open in Android Studio to build APK/AAB:
npx cap open android

# Open in Xcode (macOS) to build iOS app:
npx cap open ios
```

---

## 4. Submitting a Pull Request

1. Create a feature branch (`git checkout -b feat/your-feature-name`).
2. Commit your changes with a clear description (`git commit -m "feat: add ..."`).
3. Push to your fork (`git push origin feat/your-feature-name`) and open a Pull Request against `main`.
