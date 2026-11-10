# Metrolist — Cross-Platform Ad-Free Music Player

A fast, Spotify-inspired open-source music player for **macOS, Windows, iOS, Android, and Web**, powered by **YouTube Music (`InnerTube WEB_REMIX`)** and **YouTube Radio (`RDAMVM`) recommendations**.

---

## Download Stable Builds

Users can download the latest stable builds directly from the **[GitHub Releases](../../releases)** page:
- **Android**: `metrolist-android-universal.apk` (install directly on any Android device)
- **iOS / iPadOS**: `metrolist-ios-xcode-project.zip` (sideload via Xcode / AltStore, or install as an iOS Home Screen Web App)
- **macOS**: `metrolist-macos-universal-standalone.zip`
- **Windows**: `metrolist-windows-x64-standalone.zip`
- **Portable Web & Server**: `metrolist-portable-web-and-server.zip`

---

## Key Features

- **Full-Length Ad-Free Streaming**: Searches and streams full-length songs from YouTube Music (`WEB_REMIX`) with zero audio interruptions.
- **YouTube Music Algorithmic Recommendations (`RDAMVM`)**: Automatically updates the **Recommended for You** shelf and **Up Next Radio Queue** using YouTube Music's official `youtubei/v1/next` recommendation engine whenever a song is played.
- **5-Band Parametric Equalizer & Spectrum Analyzer**: Built-in Web Audio API BiquadFilter equalizer (`60 Hz` to `14 kHz`).
- **Works Standalone on Phones**: The packaged Android / iOS app searches YouTube Music directly from the device — no server required.
- **Real Queue Controls**: Play next, add to queue, reorder, clear, shuffle, repeat (all / one), and an endless Autoplay Radio that loads more songs whenever the queue runs low.
- **Remembers You**: Liked songs, your library, the queue (resumed paused where you left off), volume and player preferences are saved on the device.
- **Native OS Media Keys (`MediaSession API`)**: Integrates with macOS Control Center, Windows System Media Transport Controls, iOS Lock Screen, and Android Media Notifications.

---

## Local Development

```bash
# Install dependencies
npm install

# Run all unit tests (player core, InnerTube, persistence & security checks)
npm test

# End-to-end browser tests (Playwright + Chromium; builds the app and starts its servers itself).
# Hermetic: YouTube, the API and artwork are simulated, no internet needed.
npx playwright install chromium   # once per machine
npm run test:e2e

# Start development server (Express + Vite on http://localhost:3000)
npm run dev

# Build for production
npm run build

# Run the production server (serves dist/ + the API on http://localhost:3000)
NODE_ENV=production npx tsx server.ts
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
