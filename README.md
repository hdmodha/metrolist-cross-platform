# Metrolist — Cross-Platform Ad-Free Music Player

A fast, Spotify-inspired open-source music player for **macOS, Windows, iOS, Android, and Web**, powered by **YouTube Music (`InnerTube WEB_REMIX`)** and **YouTube Radio (`RDAMVM`) recommendations**.

---

## Download and install

Download the latest builds from the **[GitHub Releases](../../releases)** page:
- **Android**: `metrolist-android-universal.apk` (install directly on any Android device)
- **iOS / iPadOS**: `metrolist-ios-xcode-project.zip` (sideload via Xcode / AltStore, or install as an iOS Home Screen Web App)
- **Portable Web & Server** (any OS with [Node.js](https://nodejs.org) 20.19 or newer): `metrolist-portable-web-and-server.zip`. Unzip it, open a terminal in the folder and run `npm start` (or `node dist-server/server.mjs`), then open http://localhost:3000. No `npm install` is needed: the server is a single bundled file. Set `PORT` to use another port.
- **macOS / Windows**: native apps (a `.dmg` with `Metrolist.app`, a Windows installer) are being prepared; see [Desktop app](#desktop-app) below. Until they ship, `metrolist-macos-universal-standalone.zip` / `metrolist-windows-x64-standalone.zip` contain the same portable web & server as above and need Node.js.

### Desktop app

The desktop app is an Electron wrapper around the same app, with the server running inside it on `127.0.0.1` (port 47823). It needs no Node.js, terminal or browser once packaged. Until the installers are published, contributors can run it from source (see [CONTRIBUTING.md](./CONTRIBUTING.md)):

```bash
npm install
npm run build && npm run build:electron
npx electron .
```

Where your data lives: liked songs, downloads, history, the queue and preferences are stored by the app's web storage in its user-data folder (macOS `~/Library/Application Support/Metrolist`, Windows `%APPDATA%\Metrolist`, Linux `~/.config/Metrolist`), together with the window size and position. The data belongs to the address `http://127.0.0.1:47823`; if another program holds that port, Metrolist starts on a fallback port and tells you that your saved music is not shown in that session.

---

## Key Features

- **Simple, Spotify-style navigation**: Home, Search and Library tabs along the bottom on phones and tablets, a sidebar on desktop. Every page has a real address (`#/search?q=…`, `#/library/liked`, …), so links, reloads and the Back button just work.
- **Home**: a greeting, your recently played songs, recommendations based on the last song you played ("Because you listened to …"; "Popular right now" on a fresh install) and artists to explore.
- **Search**: live YouTube Music search as you type, recent searches, and a Browse grid of genres and moods.
- **Library**: Liked Songs and Downloads (newest first, with Play and Shuffle) and your recently played songs.
- **Mini player → Now Playing**: the playing song is docked above the tabs; tap it for a full-screen player with large artwork, seek bar, shuffle / repeat, the "⋮" menu and the Up next queue (reorder, remove, clear). Close it with the chevron, Escape, Back or a swipe down.
- **Full-length, ad-free streaming** through YouTube Music, with **endless radio**: "Autoplay similar songs" keeps the music going with YouTube Music's own recommendations (`RDAMVM`) when your queue runs low, without ever dropping songs you queued.
- **Downloads, honestly**: "Download" adds a song to your Downloads list; the audio is not stored on the device, so those songs still need an internet connection to play.
- **Remembers you**: liked songs, downloads, history, recent searches, the queue (resumed paused where you left off), volume and preferences are saved on the device. Data from older versions is upgraded automatically.
- **Native OS media keys (`MediaSession API`)**: macOS Control Center, Windows media controls, iOS Lock Screen and Android media notifications; Space / ← / → on desktop.

## How It Works on Each Device

- **Phones and tablets** (narrower than 1024 px): bottom tabs, a docked mini player, full-screen Now Playing with swipe-down to close. Landscape phones get a compact two-column Now Playing.
- **Desktop and large windows** (1024 px and wider): a sidebar with shortcuts to Liked Songs and Downloads, and a full-width player bar with volume and a queue button.
- **Packaged Android / iOS app**: searches YouTube Music directly from the device through Capacitor's native HTTP bridge — no server needed. The Android Back button follows the app's navigation (closes Now Playing, steps back through pages).
- **Desktop app (Electron)**: the same app in its own window; the server runs inside the app on `127.0.0.1` only. Closing the window on macOS keeps the music playing (Cmd+Q quits); media keys work through the OS media controls.
- **Web / portable bundle**: talk to the bundled Express server (`dist-server/server.mjs`, built from `server.ts`), or to any deployed one via `VITE_API_BASE_URL`.

---

## Local Development

```bash
# Install dependencies
npm install

# Run all unit tests (player core, router, InnerTube, persistence & migration, security checks)
npm test

# End-to-end browser tests (Playwright + Chromium; builds the app and starts its servers itself).
# Hermetic: YouTube, the API and artwork are simulated, no internet needed.
npx playwright install chromium   # once per machine
npm run test:e2e

# Start development server (Express + Vite on http://localhost:3000)
npm run dev

# Build for production (dist/ = frontend, dist-server/server.mjs = bundled server)
npm run build

# Run the production server (serves dist/ + the API on http://localhost:3000)
npm start
```

### Hosting the frontend without the bundled server

Static web hosts cannot call YouTube Music directly (browsers block it), so point the build at a deployed backend:

```bash
VITE_API_BASE_URL="https://your-metrolist-backend.example.com" npm run build
```

The packaged Android / iOS app does not need this.

---

## Contributing

Contributions are welcome! Please read **[CONTRIBUTING.md](./CONTRIBUTING.md)** for local setup, testing, and native build instructions.
