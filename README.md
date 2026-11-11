# Metrolist — Cross-Platform Ad-Free Music Player

A fast, Spotify-inspired open-source music player for **macOS, Windows, iOS, Android, and Web**, powered by **YouTube Music (`InnerTube WEB_REMIX`)** and **YouTube Radio (`RDAMVM`) recommendations**.

---

## Download and install

Download the latest builds from the **[GitHub Releases](../../releases)** page:
- **macOS** (Apple Silicon and Intel, one download): `Metrolist-<version>-mac-universal.dmg`
- **Windows** (64-bit): `Metrolist-<version>-win-x64-setup.exe`
- **Android**: `metrolist-android-universal.apk` (install directly on any Android device)
- **iOS / iPadOS**: `metrolist-ios-xcode-project.zip` (sideload via Xcode / AltStore, or install as an iOS Home Screen Web App)
- **Portable Web & Server** (any OS with [Node.js](https://nodejs.org) 20.19 or newer): `metrolist-portable-web-and-server.zip`. Unzip it, open a terminal in the folder and run `npm start` (or `node dist-server/server.mjs`), then open http://localhost:3000. No `npm install` is needed: the server is a single bundled file. Set `PORT` to use another port.

The macOS and Windows apps need no Node.js, terminal or browser: the whole app, including its small server, runs inside them.

### macOS

1. Open the `.dmg` and drag **Metrolist** onto **Applications**.
2. Open Metrolist from Applications or Launchpad.

The app is not notarized by Apple (the project has no Apple Developer account), so the first launch is blocked once:
- **macOS 15 (Sequoia) and newer**: macOS says *"Apple could not verify 'Metrolist' is free of malware…"*. Click **Done**, open **System Settings → Privacy & Security**, scroll down to the message about Metrolist and click **Open Anyway**, then confirm with your password.
- **Older macOS**: right-click (or Control-click) Metrolist in Applications, choose **Open**, then **Open** again.
- **Alternative** (Terminal): `xattr -dr com.apple.quarantine /Applications/Metrolist.app`

Closing the window keeps the music playing (like Music or Spotify); click the Dock icon to bring it back and press **Cmd+Q** to quit. Media keys and Control Center work.

### Windows

1. Run `Metrolist-<version>-win-x64-setup.exe`. It installs for your user only (no administrator rights) and adds Start-menu and desktop shortcuts.
2. The installer is not code-signed, so **Microsoft Defender SmartScreen** may say *"Windows protected your PC"*: click **More info → Run anyway**.

To uninstall: **Settings → Apps → Installed apps → Metrolist → Uninstall**.

### Updating

Download the newer installer from Releases and install it over the old version (on macOS, replace the app in Applications). Your library is kept.

### Where your data lives

Liked songs, downloads, history, the queue, preferences and the window size and position are stored in the app's user-data folder:
- macOS: `~/Library/Application Support/Metrolist`
- Windows: `%APPDATA%\Metrolist`
- Linux (from source): `~/.config/Metrolist`

Uninstalling keeps this folder; delete it to start fresh. The library belongs to the app's local address, `http://127.0.0.1:47823`. If another program holds that port, Metrolist starts on a fallback port and tells you that your saved music is not shown in that session.

---

## Key Features

- **Simple, Spotify-style navigation**: Home, Search and Library tabs along the bottom on phones and tablets, a sidebar on desktop. Every page has a real address (`#/search?q=…`, `#/library/liked`, …), so links, reloads and the Back button just work.
- **Home**: a greeting, your recently played songs, recommendations based on the last song you played ("Because you listened to …"; "Popular right now" on a fresh install) and artists to explore.
- **Search**: live YouTube Music search as you type, recent searches, and a Browse grid of genres and moods.
- **Library**: Liked Songs and Downloads (newest first, with Play and Shuffle) and your recently played songs.
- **Mini player → Now Playing**: the playing song is docked above the tabs; tap it for a full-screen player with large artwork, seek bar, shuffle / repeat, the "⋮" menu and the Up next queue (reorder, remove, clear). Close it with the chevron, Escape, Back or a swipe down.
- **Full-length streaming** through YouTube Music (ad and tracking requests blocked in the desktop app, see below), with **endless radio**: "Autoplay similar songs" keeps the music going with YouTube Music's own recommendations (`RDAMVM`) when your queue runs low, without ever dropping songs you queued.
- **Fewer unplayable songs**: some uploads can't be played outside youtube.com (their owner turned that off). The app checks the playing song and the next three with YouTube's public oEmbed endpoint and swaps a blocked upload for another upload of the same song *before* it is reached — scored on title, artist and length, never a cover, remix, live or sped-up version, and never anything that does not match well enough. A song with no good upload is skipped without being loaded, with a notice that says why; player errors get their own honest messages (removed or private, the owner's choice, a player error that is retried once, …).
- **Ad blocking (desktop app)**: like Brave, the desktop app cancels the YouTube player's ad and tracking requests (DoubleClick, Google ad / analytics hosts, YouTube's ad and telemetry endpoints) while the video itself plays through the official YouTube player. See [Ad blocking per platform](#ad-blocking-per-platform).
- **Downloads, honestly**: "Download" adds a song to your Downloads list; the audio is not stored on the device, so those songs still need an internet connection to play.
- **Remembers you**: liked songs, downloads, history, recent searches, the queue (resumed paused where you left off), volume and preferences are saved on the device. Data from older versions is upgraded automatically.
- **Native OS media keys (`MediaSession API`)**: macOS Control Center, Windows media controls, iOS Lock Screen and Android media notifications; Space / ← / → on desktop.

## How It Works on Each Device

- **Phones and tablets** (narrower than 1024 px): bottom tabs, a docked mini player, full-screen Now Playing with swipe-down to close. Landscape phones get a compact two-column Now Playing.
- **Desktop and large windows** (1024 px and wider): a sidebar with shortcuts to Liked Songs and Downloads, and a full-width player bar with volume and a queue button.
- **Packaged Android / iOS app**: searches YouTube Music directly from the device through Capacitor's native HTTP bridge — no server needed. The Android Back button follows the app's navigation (closes Now Playing, steps back through pages).
- **Desktop app (Electron)**: the same app in its own window; the server runs inside the app on `127.0.0.1` only. Closing the window on macOS keeps the music playing (Cmd+Q quits); media keys work through the OS media controls.
- **Web / portable bundle**: talk to the bundled Express server (`dist-server/server.mjs`, built from `server.ts`), or to any deployed one via `VITE_API_BASE_URL`.

### Ad blocking per platform

Playback always uses the official YouTube IFrame player. What differs is who controls the network:

| Platform | Ads and tracking |
|---|---|
| **Desktop app** (macOS, Windows, Linux) | Blocked by the app: every request (the YouTube player's included) is checked against a conservative list in `src/shared/adBlock.ts` and ad / tracking requests are cancelled. Video streams, artwork, the player scripts and playback statistics are never blocked. |
| **Web browser** (any build served to a browser) | The app cannot block requests the YouTube player makes from its own frame (browsers do not let a page block another site's requests). Use your browser's blocker: Brave Shields, uBlock Origin, or your browser's built-in protection. |
| **Android / iOS app** | Not yet: the next release reuses the same rules (`src/shared/adBlockRules.json`, generated with `npm run adblock:rules`). |

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
