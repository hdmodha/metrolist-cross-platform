# Metrolist — Cross-Platform Ad-Free Music Player

A fast, Spotify-inspired open-source music player for **macOS, Windows, iOS, Android, and Web**, powered by **YouTube Music (`InnerTube WEB_REMIX`)**, **YouTube Radio (`RDAMVM`) recommendations**, and **LRCLIB time-synced lyrics**.

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
- **Live Time-Synced Lyrics (`LRCLIB`)**: Interactive `.lrc` lyrics with click-to-seek timestamps.
- **5-Band Parametric Equalizer & Spectrum Analyzer**: Built-in Web Audio API BiquadFilter equalizer (`60 Hz` to `14 kHz`).
- **Native OS Media Keys (`MediaSession API`)**: Integrates with macOS Control Center, Windows System Media Transport Controls, iOS Lock Screen, and Android Media Notifications.

---

## How to Upload to GitHub & Publish Stable Releases

### Step 1: Upload to GitHub from Google AI Studio
1. Click the **Export to GitHub** (or **Download ZIP**) button at the top of Google AI Studio.
2. If using the downloaded ZIP, initialize Git and push to your new public GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Initial open-source release of Metrolist Cross-Platform"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```

### Step 2: Automatically Build & Publish Native Releases (`v1.0.0`)
This repository includes `.github/workflows/release-native-builds.yml`. Whenever you push a version tag (or trigger the workflow in the **Actions** tab), GitHub Actions automatically runs the test suite, builds the **Android `.apk`**, **iOS Xcode bundle**, **macOS**, **Windows**, and **Web** packages, and publishes them on your repository's **Releases** page:
```bash
git tag v1.0.0
git push origin v1.0.0
```
Or on GitHub.com:
1. Go to your repository's **Actions** tab.
2. Click **Build & Publish Release Artifacts (macOS, Windows, Android, iOS, Web)**.
3. Click **Run workflow** → enter `v1.0.0` → click **Run workflow**.
4. In ~2 minutes, your downloadable `.apk` and desktop/mobile packages will appear under **Releases** on the right sidebar of your GitHub repo!

---

## Contributing

Contributions are welcome! Please read **[CONTRIBUTING.md](./CONTRIBUTING.md)** for local setup, testing (`npx tsx --test src/utils/metrolistCore.test.ts`), and native build instructions.
