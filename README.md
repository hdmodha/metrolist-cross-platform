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
- **Full-length streaming** through YouTube Music (ad and tracking requests blocked in the desktop, Android and iOS apps, see below), with **endless radio**: "Autoplay similar songs" keeps the music going with YouTube Music's own recommendations (`RDAMVM`) when your queue runs low, without ever dropping songs you queued.
- **Fewer unplayable songs**: some uploads can't be played outside youtube.com (their owner turned that off). The app checks the playing song and the next three with YouTube's public oEmbed endpoint and swaps a blocked upload for another upload of the same song *before* it is reached — scored on title, artist and length, never a cover, remix, live or sped-up version, and never anything that does not match well enough. A song with no good upload is skipped without being loaded, with a notice that says why; player errors get their own honest messages (removed or private, the owner's choice, a player error that is retried once, …).
- **Ad blocking (desktop, Android and iOS apps)**: like Brave, the apps cancel the YouTube player's ad and tracking requests (DoubleClick, Google ad / analytics hosts, YouTube's ad and telemetry endpoints) while the video itself plays through the official YouTube player. See [Ad blocking per platform](#ad-blocking-per-platform).
- **Background play on Android and iOS**: the music keeps playing with the screen off, after pressing Home or with another app in front, with a media notification (cover, previous / play-pause / next, seek bar), lock-screen and Bluetooth / headset controls. See [Android: background play](#android-background-play) and [iOS: background play](#ios-background-play-untested-on-a-device). The desktop app keeps playing when minimised; mobile browsers cannot (see [Platform differences](#platform-differences)).
- **Downloads, honestly**: "Download" adds a song to your Downloads list; the audio is not stored on the device, so those songs still need an internet connection to play.
- **Remembers you**: liked songs, downloads, history, recent searches, the queue (resumed paused where you left off), volume and preferences are saved on the device. Data from older versions is upgraded automatically.
- **Native OS media keys**: macOS Control Center, Windows media controls and browsers' media controls (`MediaSession API`); in the Android and iOS apps the app's own media session drives the notification / lock screen / Control Center and Bluetooth / headset buttons; Space / ← / → on desktop.

## How It Works on Each Device

- **Phones and tablets** (narrower than 1024 px): bottom tabs, a docked mini player, full-screen Now Playing with swipe-down to close. Landscape phones get a compact two-column Now Playing.
- **Desktop and large windows** (1024 px and wider): a sidebar with shortcuts to Liked Songs and Downloads, and a full-width player bar with volume and a queue button.
- **Packaged Android / iOS app**: searches YouTube Music directly from the device through Capacitor's native HTTP bridge — no server needed. The Android Back button follows the app's navigation (closes Now Playing, steps back through pages). Both apps keep playing in the background and block ads (below; iOS is not yet tested on a device).
- **Desktop app (Electron)**: the same app in its own window; the server runs inside the app on `127.0.0.1` only. Closing the window on macOS keeps the music playing (Cmd+Q quits); media keys work through the OS media controls.
- **Web / portable bundle**: talk to the bundled Express server (`dist-server/server.mjs`, built from `server.ts`), or to any deployed one via `VITE_API_BASE_URL`.

### Ad blocking per platform

Playback always uses the official YouTube IFrame player. What differs is who controls the network:

| Platform | Ads and tracking |
|---|---|
| **Desktop app** (macOS, Windows, Linux) | Blocked by the app: every request (the YouTube player's included) is checked against a conservative list in `src/shared/adBlock.ts` and ad / tracking requests are cancelled. Video streams, artwork, the player scripts and playback statistics are never blocked. |
| **Web browser** (any build served to a browser) | The app cannot block requests the YouTube player makes from its own frame (browsers do not let a page block another site's requests). Use your browser's blocker: Brave Shields, uBlock Origin, or your browser's built-in protection. |
| **Android app** | Blocked by the app, with the same rules: the app's WebView answers ad / tracking requests (the YouTube player's included) with an empty response before they leave the phone. The rules ship with the app (`metrolist-ad-block-rules.json`, generated from `src/shared/adBlock.ts` by `npm run adblock:rules`). |
| **iOS app** | Blocked by the app with the same rules, as a WebKit content-blocker list (`metrolist-content-blocker.json`, generated from `src/shared/adBlock.ts` by `npm run adblock:rules`). Two documented differences: an ad address opened as the whole page would be blocked too (the app never does that), and addresses with a user name in them are not matched. Not yet tested on a device. |

### Android: background play

When the Android app goes to the background, Android hides its web page, and the YouTube player is paused (by YouTube's own script, and by Android's web engine, which pauses video players on hidden pages). The first phone test showed exactly that: the music survived the screen turning off (the app's window stays "visible" then) but stopped on Home. The app now does what Brave does, while the music still plays through YouTube's official player:

1. **The page stays "visible" while music plays.** The app's WebView (`BackgroundPlaybackWebView`) keeps telling Android's web engine that its window is visible as long as you want music (playing or loading the next song). Once you pause, it reports the real state again, so a paused app in the background stops rendering and saves battery. Resuming from the notification or a headset makes the page visible again before it plays.
2. **The YouTube player believes it is still visible.** A small script (`metrolist-page-visibility.js`) runs inside YouTube's player frames only and keeps reporting the page as visible and focused.
3. **A media notification keeps the app alive.** While music plays, a foreground service shows a notification with the cover, previous / play-pause / next and a seek bar; the same controls work on the lock screen and from Bluetooth / headset buttons. Pausing keeps the notification so you can resume from it; unplugging headphones pauses; swiping the app away from recents stops the music.
4. **A safety net.** If the player still pauses itself within 2.5 seconds of the app going to the background, the app resumes it once. It never fights a pause you asked for (in the app, from the notification, the lock screen or a headset).
5. **Ads are blocked** (see the table above).

The app saves where you are when it goes to the background (the page no longer gets the browser's "hidden" signal while music plays, so the app tells it).

**Notification permission (Android 13 and newer):** the first time you play a song, the app asks once to show notifications. Saying no is fine: music still plays in the background, there is just no visible notification (and no notification controls). You can turn it on later in **Settings → Apps → Metrolist → Notifications**.

Requirements: Android 5.1 or newer; the visibility script needs an up-to-date **Android System WebView** (on an old WebView the app logs it and still keeps the notification and ad blocking).

Building it yourself: the generated Android project needs Metrolist's `MainActivity` (it swaps in the WebView above): run `npm run native:prepare` after `npx cap add android` (see [CONTRIBUTING](CONTRIBUTING.md)). Without it the app works but stops on Home as before, and its debug log says so.

**What to check on a phone** (tested on a simulated bridge and compiled in CI, not yet on a device):
- Play a song, **press Home**, open another app, come back after a few songs: the music never stopped and the next song started on its own. Also with the screen off, and switching apps from the recents screen.
- The notification and lock screen show the title, artist and cover; play / pause / next / previous and dragging the seek bar work; so do Bluetooth headset buttons.
- Pause from the notification while the app is in the background: it stays paused (it is not resumed by the safety net); resume from the notification after a minute: it plays again.
- Unplug wired headphones (or disconnect Bluetooth audio): playback pauses.
- Swipe the app away from recents: the music stops and the notification disappears.
- Android 13+: the permission prompt appears once at the first play; with "Don't allow" music still plays.
- No video ads before or between songs.
- Then open the debug log (below) and send it along with what happened.

### iOS: background play (untested on a device)

The iOS app has the same plugin, written for iOS: the app declares background audio (`UIBackgroundModes: audio`, added by `npm run native:prepare`), activates a playback audio session at the first play, shows the song on the lock screen and in Control Center (title, artist, album, cover, position) with play / pause / next / previous / seek, pauses when headphones are unplugged, runs the same visibility script in YouTube's frames, blocks ads with a WebKit content-blocker list, and resumes once if iOS pauses the player right after the app leaves the foreground (never after a pause you asked for, or a phone call). CI compiles it for the iOS Simulator; it has **not been run on an iPhone** yet. Things that may still not work on a device: WebKit may keep pausing video players in the background, and YouTube may refuse to play inside the app's `capacitor://` page.

**What to check on an iPhone:** play, press Home / lock the phone: does the music continue to the next song? Do the lock screen and Control Center show the song and control it? Do AirPods / headset buttons work? Does a phone call pause it, and does it stay paused afterwards until you press play? Then send the debug log.

### The debug log

For device tests there is a hidden log of the last 100 player, page and plugin events, with timestamps, plus the Android / iOS plugin's own lines (window visibility, what the page reported, commands, the foreground service). Open **Library**, scroll to the bottom and **press and hold the version line ("Metrolist 1.x.y") for about a second**. **Copy** puts the whole log on the clipboard (paste it into a message); **Refresh** reloads the plugin's lines; **Clear** empties it. It is kept in memory only and never sent anywhere. In a browser it is also at `#/debug`. With a computer, `adb logcat -s Metrolist` shows the Android plugin's lines live.

### Platform differences

| | Keeps playing in the background | Lock screen / media keys | Ad blocking |
|---|---|---|---|
| **Android app** | Yes: screen off, Home, other apps (see above; device test pending for Home) | Notification, lock screen, Bluetooth / headset | Yes |
| **iOS app** | Intended (background audio); untested on a device | Lock screen, Control Center, headset | Yes (WebKit content blocker) |
| **Desktop app** (macOS, Windows, Linux) | Yes, also minimised or hidden (macOS: closing the window hides it) | OS media keys / controls | Yes |
| **Desktop browsers** | Yes while the tab stays open (a background tab keeps playing) | Browser media controls | Use the browser's blocker |
| **Mobile browsers** | **No**: when you switch apps or lock the phone, the browser and YouTube pause a background tab, and a web page cannot prevent it. Install the Android / iOS app for background play. | While the tab is in front | Use the browser's blocker |

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
