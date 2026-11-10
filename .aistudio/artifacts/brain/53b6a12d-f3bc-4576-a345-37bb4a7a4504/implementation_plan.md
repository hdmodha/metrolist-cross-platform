# Metrolist Cross-Platform Migration & Interactive Application Suite

A comprehensive cross-platform engineering implementation and live interactive music client migrating **Metrolist** (`metrolistgroup/metrolist`) from Android-only Kotlin/Jetpack Compose to **iOS, macOS, and Windows** via **Kotlin Multiplatform (KMP) + Compose Multiplatform**, featuring real audio playback, synchronized lyrics, Listen Together Jam sessions, an InnerTube Stream Resolver & Security Hardening Auditor, and a Step-by-Step KMP Migration Workbench.

## User Review & Critical Decisions

> [!IMPORTANT]
> Below is the synthesis of your confirmed architectural and product choices from Phase 1, alongside recommended defaults for platform audio bindings and security hardening. Review the blueprint and click **Proceed** to build and verify the full application.

- **Confirmed Deliverable Mode**: **Interactive Cross-Platform App & Architecture Blueprint** — A unified web application where you can both **experience the cross-platform Metrolist player live** (with adaptive iOS, macOS, and Windows layout previews, real audio synthesis/playback, synced lyrics, and offline cache) and **inspect/test the KMP + Compose Multiplatform migration architecture** and security patches step-by-step.
- **Confirmed Target Architecture**: **Kotlin Multiplatform (KMP) + Compose Multiplatform (CMP)** — Reuses ~85% of Metrolist's existing Kotlin business logic (`innertube`, `kugou`, `lrclib`, Room KMP database, ViewModels, and Material 3 Compose UI) while bridging native platform media engines (`AVPlayer` on iOS/macOS, `Windows.Media.Playback` / `libmpv` on Windows).
- **Confirmed Priority Capabilities**:
  1. **Core Player, Dynamic Queue & Live Synced Lyrics** (real Web Audio harmonic synthesizer + audio stream engine, interactive scrubber, dynamic artwork color extraction, time-synced LRC/Kugou lyrics parser with click-to-seek, and reorderable queue).
  2. **InnerTube Stream Resolver & Security Hardening Audit** (interactive stream signature deciphering sandbox, SAPISIDHASH token generator/validator, and a 6-point vulnerability remediation verification suite with live before/after exploit tests).
  3. **Listen Together (Synchronized Jam Sessions) & Offline Cache** (real-time multi-peer playback synchronization simulator with drift compensation, plus encrypted offline song cache & validated SQLite backup/restore inspector).

---

## 1. Overview & Core Concept

- **What It Does**: Transforms the Android-exclusive Metrolist YouTube Music client into a hardened, maintainable cross-platform ecosystem targeting **iOS, macOS, Windows, and Android**. The application provides a full-featured **Metrolist Cross-Platform Music Client** paired with an **Interactive KMP Migration & Security Engineering Workbench**.
- **Target Audience / Persona**: Cross-platform mobile/desktop systems engineers, open-source maintainers, and audiophiles who want Metrolist's ad-free Material 3 YouTube Music experience running natively on Apple and Windows ecosystems without sacrificing native media key integration, background playback, or security.
- **Key Value**:
  - **Maximum Code Reuse (~85% Shared Kotlin)**: Eliminates the need to rewrite Metrolist's intricate `innertube` protocol parsers, `lrclib`/`kugou` lyric engines, and Jetpack Compose UI into Dart (Flutter) or TypeScript (React Native).
  - **Defense-in-Depth Security Hardening**: Resolves 6 critical/high security vulnerabilities present in unofficial InnerTube Android clients (Plaintext Cookie Storage, Unvalidated `.zip` Database Restore SQL Injection / Path Traversal, Unbounded LRC Regex ReDoS, Cleartext Kugou HTTP MitM, Exposed SAPISID Replay, and Unauthenticated Listen Together Room Hijacking).

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Flow 1: Cross-Platform Player, Adaptive OS Switcher & Live Synced Lyrics**
   - Users browse curated tracks, albums, and playlists in the **Explore & Library** view, filter by genre or search query (with instant InnerTube client simulation), and click any track to start real audio playback.
   - Users can switch the **Target OS Preview Mode** in the workspace toolbar between **macOS Desktop (Sonoma/Sequoia Window Chrome)**, **Windows 11 Desktop (Mica/Fluent Window Controls)**, and **iOS 18 (iPhone 16 Pro Dynamic Island & Home Indicator)** to inspect how Compose Multiplatform adapts navigation (`NavigationRail` on desktop vs. Bottom Navigation Bar on iOS) and window insets.
   - Opening the **Expanded Now Playing & Live Lyrics Drawer** displays real-time synchronized `.lrc` lyrics (with provider switcher between `LRCLIB` and `Kugou`), click-to-seek lyric lines, an interactive 5-band audio equalizer/visualizer, and a live **Dynamic Queue** manager (reorder, remove, play next, shuffle, repeat).

2. **Flow 2: Listen Together (Synchronized Jam Sessions) & Offline Cache Manager**
   - In the **Listen Together Jam** tab/drawer, users can host or join an encrypted room session, add simulated remote listeners (across iOS, macOS, Windows, and Android clients), test **Clock Drift & Latency Compensation** (injecting network jitter and observing NTP-style playback rate micro-adjustment), and toggle host-only vs. collaborative queue permissions.
   - In the **Offline Cache & Backup Vault**, users can download tracks to local offline storage, inspect cached chunk integrity (SHA-256 verification), and test **Secure Backup Import/Export** (validating SQLite `PRAGMA integrity_check` and rejecting Zip-Slip path traversal payloads).

3. **Flow 3: KMP Architecture Blueprint & Security Hardening Auditor**
   - In the **KMP Architecture & Migration** view, users explore the 5-phase migration roadmap, interactive **Framework Comparison Matrix** (KMP + Compose vs. Flutter vs. React Native across 8 engineering metrics), and inspect the exact `expect` / `actual` Kotlin Multiplatform code diffs for `MediaPlayerController`, `SecureCredentialStore`, and `RoomDatabaseBuilder` across `commonMain`, `iosMain`, `macosMain`, and `jvmDesktopMain`.
   - In the **InnerTube & Security Audit** view, users can run live interactive security tests against the 6 identified vulnerabilities—toggling between **Legacy Vulnerable Mode (Android v1)** and **Hardened KMP Mode (v2)** to see how malicious payloads (e.g., Zip-Slip `../../song.db`, ReDoS malformed `.lrc` timestamps, leaked `SAPISID` cookies) are intercepted and neutralized.

### Visual Identity & Theme

- **Aesthetic Direction**: Refined Material You (Material 3 Expressive) fused with desktop-grade studio precision. Clean dark slate surfaces (`#0B0F17` canvas, `#111827` structural panels) with dynamic album-reactive accent tinting and crisp hairline dividers (`1px solid rgba(255,255,255,0.08)` in dark mode; `#F8FAFC` canvas with `#E2E8F0` borders in light mode).
- **Color Palette & Mood (60-30-10 Discipline)**:
  - **60% Dominant Neutral Canvas**: Deep Obsidian Slate (`#0B0F17` dark / `#F8FAFC` light) for main background viewport.
  - **30% Structural Surfaces**: Elevated Studio Charcoal (`#131B2E` dark / `#FFFFFF` light) for navigation rail, track rows, player dock, and architecture inspector panels with subtle `border-slate-800/80` (`border-slate-200` light) hairlines.
  - **10% Accent Budget**: Dynamic Vinyl Indigo (`#6366F1` primary action accent) and Emerald Audio Nominal (`#10B981` for verified security audits and active synced states), plus Amber (`#F59E0B`) and Crimson (`#EF4444`) strictly paired with explicit labels for security severity states.
- **Typography & Hierarchy (2+1 Font Rule)**:
  - **Display & Headings**: `Plus Jakarta Sans` (SemiBold 600 / Bold 700, tight tracking `-0.02em`, `text-wrap: balance`) for album titles, section headers, and architectural blueprint titles.
  - **Body & UI Controls**: `DM Sans` (Regular 400 / Medium 500) for clean track lists, lyrics, and technical prose.
  - **Monospace & Telemetry**: `JetBrains Mono` (`tabular-nums`) for track timestamps (`02:41 / 03:58`), audio bitrate/sample rate (`251 Opus · 48kHz · 160kbps`), `SAPISIDHASH` cryptographic tokens, and KMP `expect`/`actual` code blocks.
- **Component Styling & Layout**:
  - **Top Bar Contract**: Strictly 3 zones separated by `gap-8`:
    1. *Brand Zone*: Single-line `Metrolist KMP` wordmark.
    2. *Navigation Zone*: 4 single-line links (`Player & Library`, `Listen Together`, `KMP Architecture`, `Security & InnerTube`).
    3. *Primary Action Zone*: Single primary action button (`Run Verification Suite` or theme/OS quick action).
  - **Persistent Bottom Player Bar**: Docked studio transport bar with album artwork, track title/artist, play/pause/skip controls, interactive scrub bar with tabular timestamps, live lyrics drawer toggle, queue drawer toggle, and volume slider.
  - **Zero-Pill Metadata Discipline**: Track durations, codec details (`Opus 251 · 160 kbps · Synced LRC`), and security audit metadata use clean unboxed text with `·` separators—never cluttered pill badge sandwiches.

---

## 3. Key Product Decisions & Trade-Offs

### Decision 1: Cross-Platform Framework Selection
- **Chosen Approach**: **Kotlin Multiplatform (KMP) + Compose Multiplatform (CMP)** targeting Android, iOS (`iosArm64` / `iosSimulatorArm64`), macOS (`macosArm64` / `macosX64`), and Windows (`jvm` Desktop / GraalVM native image).
- **Why**:
  1. **Zero Rewrite of InnerTube & Lyrics Core**: Metrolist's most complex, fragile, and frequently updated code is its `innertube` Ktor module (handling YouTube's undocumented JSON schemas, client context spoofing, and signature cipher extraction) plus `kugou` and `lrclib` parsers. Because Metrolist already uses **Kotlin + Ktor + Kotlinx.Serialization + Coroutines**, 100% of the networking and domain layer compiles directly to iOS, macOS, and Windows under `commonMain` without rewriting a single parser.
  2. **90% UI Reuse via Compose Multiplatform**: Metrolist's entire UI is already written in Jetpack Compose (Material 3). Migrating to Compose Multiplatform requires only replacing Android-specific imports (`androidx.compose.ui.platform.LocalContext`, `Intent`) with multiplatform equivalents (`compose.resources`, `LocalUriHandler`).
  3. **Official Room KMP & DataStore KMP Support**: AndroidX Room (`2.7.0+`) and DataStore now officially support Kotlin Multiplatform with `BundledSQLiteDriver`, allowing Metrolist's existing `@Entity` and `@Dao` definitions in `song.db` to run identically on iOS, macOS, and Windows.
- **Alternatives Considered**:
  - *Flutter (Dart)*: Strong desktop/iOS rendering via Impeller, and existing Dart forks like Harmony-Music exist, but migrating Metrolist to Flutter requires a **100% rewrite** of ~45,000 lines of Kotlin code, discarding all existing Compose UI components, Room DAOs, and Ktor InnerTube modules.
  - *React Native + Electron/Tauri*: High maintenance fragmentation (React Native for iOS, separate React DOM/Tauri wrapper or React Native Windows/macOS with immature audio session modules), plus JavaScript bridge overhead when parsing large InnerTube payloads and time-synced lyrics.

### Decision 2: Native Audio Engine Abstraction (`expect class MediaPlayerController`)
- **Chosen Approach**: A unified Kotlin `expect class PlatformAudioEngine` in `commonMain` backed by native platform engines:
  - **Android**: `androidx.media3.exoplayer.ExoPlayer` + `MediaSessionService`
  - **iOS & macOS**: `AVQueuePlayer` + `AVPlayerItem` + `MPNowPlayingInfoCenter` + `MPRemoteCommandCenter` (via Kotlin/Native Objective-C interop)
  - **Windows / Desktop JVM**: `libmpv` (via JNA/FFI) + `SystemMediaTransportControls` (SMTC) for native Windows 11 media flyout & hardware media keys (replacing brittle JavaFX media which lacks Opus/WebM container support).
- **Why**: YouTube Music's highest-quality audio stream (`itag 251`) uses the **Opus codec inside a WebM container**. While ExoPlayer and `libmpv` play WebM/Opus natively, Apple's `AVPlayer` on iOS/macOS requires either selecting the AAC/MP4 stream (`itag 140`) or remuxing Opus packets into CAF/HLS via `AVAssetResourceLoaderDelegate`. Handling this inside the KMP `InnerTubeStreamResolver` and `PlatformAudioEngine` guarantees rock-solid background playback and lock-screen controls on every OS.

### Decision 3: Defense-in-Depth Security Hardening
- **Chosen Approach**: Address 6 concrete security vulnerabilities identified in the Metrolist architecture during the cross-platform migration:
  1. **VULN-01 (Critical): Plaintext Google Session Cookies (`SAPISID` / `__Secure-3PAPISID`) in DataStore** -> Replaced with OS Keychain storage (`Keychain Services` on iOS/macOS, `DPAPI / Credential Locker` on Windows, `EncryptedSharedPreferences / AndroidKeyStore` on Android).
  2. **VULN-02 (High): Unvalidated Backup `.zip` Restore (Zip-Slip Path Traversal & Corrupt SQLite Injection)** -> Added canonical path prefix verification, max decompressed size caps (50 MB), and sandboxed temporary SQLite `PRAGMA integrity_check` before swapping `song.db`.
  3. **VULN-03 (High): Unauthenticated "Listen Together" WebSocket Room Hijacking & Queue Poisoning** -> Added ECDH ephemeral room session tokens, HMAC-SHA256 signed transport commands, and strict host-role validation.
  4. **VULN-04 (Medium): LRC / Kugou Lyrics Parser ReDoS & Unbounded Memory Allocation** -> Replaced backtracking regex with a linear-time $O(N)$ state-machine parser and enforced a 256 KB response payload ceiling.
  5. **VULN-05 (Medium): Cleartext HTTP Fallback & Track Metadata Leakage to Third-Party Lyrics APIs** -> Enforced strict TLS 1.3 (`https://`) with certificate pinning options and query sanitization (stripping personal playlist IDs and user tokens before querying `kugou` / `lrclib`).
  6. **VULN-06 (Medium): InnerTube Signature Cipher Dynamic JS Evaluation (`eval` / WebView Injection)** -> Replaced dynamic JS execution with a pure, sandboxed Kotlin regex/AST deobfuscator for `n`-parameter and signature cipher transformations.

---

## 4. Technical Architecture & Data Strategy

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                       METROLIST CROSS-PLATFORM SUITE (WORKSPACE)                       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  TOP BAR: [Metrolist KMP] ── [Player & Library | Listen Together | KMP Arch | Security]│
├──────────────────────┬──────────────────────────────────────────┬──────────────────────┤
│   ADAPTIVE OS SHELL  │        MAIN INTERACTIVE VIEWPORT         │  CONTEXTUAL DRAWER   │
│  (iOS / macOS / Win) │                                          │  (Lyrics / Queue /   │
│                      │  ┌────────────────────────────────────┐  │   Code Diffs)        │
│  • OS Chrome Toggle  │  │ 1. PLAYER & LIBRARY VIEW           │  │                      │
│    - macOS Sequoia   │  │    • InnerTube Catalog & Search    │  │  • Synced Lyrics     │
│    - Windows 11 Mica │  │    • Quick Picks & Curated Albums  │  │    (LRCLIB / Kugou)  │
│    - iOS 18 Island   │  │    • Offline Cache Vault & Backup  │  │  • Click-to-Seek     │
│                      │  ├────────────────────────────────────┤  │    Timecode Lines    │
│  • Navigation Rail   │  │ 2. LISTEN TOGETHER (JAM) VIEW      │  │  • Dynamic Queue     │
│    (Desktop) or      │  │    • Multi-OS Peer Sync Room       │  │    Reorder & Up Next │
│    Bottom Tab Bar    │  │    • NTP Drift Compensation Sim    │  │  • 5-Band EQ &       │
│    (iOS Mobile)      │  │    • HMAC Command Verification     │  │    Audio Spectrum    │
│                      │  ├────────────────────────────────────┤  │                      │
│  • Library Filters   │  │ 3. KMP ARCHITECTURE WORKBENCH      │  │                      │
│    - All Tracks      │  │    • Framework Matrix (KMP/Flutter)│  │                      │
│    - Cached Offline  │  │    • 5-Phase Migration Checklist   │  │                      │
│    - Liked Songs     │  │    • expect/actual Platform Code   │  │                      │
│                      │  ├────────────────────────────────────┤  │                      │
│                      │  │ 4. SECURITY & INNERTUBE AUDITOR    │  │                      │
│                      │  │    • Stream Resolver (itag 251/140)│  │                      │
│                      │  │    • SAPISIDHASH Token Sandbox     │  │                      │
│                      │  │    • 6-Vuln Live Exploit & Fix Test│  │                      │
│                      │  └────────────────────────────────────┘  │                      │
├──────────────────────┴──────────────────────────────────────────┴──────────────────────┤
│  PERSISTENT STUDIO TRANSPORT DOCK:                                                     │
│  [Artwork + Track Meta]  [Shuffle | Prev | Play/Pause | Next | Repeat]  [01:24 ── 03:45]│
│  [Codec: itag 251 Opus / itag 140 AAC]     [Lyrics Toggle | Queue Toggle | Volume 85%] │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                    DECOUPLED PURE LOGIC ENGINE (UNIT-TESTED CORE)                      │
├───────────────────────────┬────────────────────────────┬───────────────────────────────┤
│   InnerTube & Crypto      │   Lyrics & Sync Engine     │   Security & Backup Validator │
│ • generateSapisidHash()   │ • parseSyncedLrc() O(N)    │ • validateBackupArchive()     │
│ • resolveOptimalStream()  │ • findActiveLyricIndex()   │ • sanitizeLyricsQuery()       │
│ • decipherSignature()     │ • calculateJamDriftSync()  │ • verifyJamCommandHmac()      │
└───────────────────────────┴────────────────────────────┴───────────────────────────────┘
```

### Target KMP Module Hierarchy (Shared vs. Platform-Specific)

```
metrolist-kmp/
├── composeApp/
│   ├── src/commonMain/kotlin/com/metrolist/music/
│   │   ├── ui/                  # 100% Shared Compose Multiplatform Material 3 Screens
│   │   ├── viewmodels/          # Shared Lifecycle ViewModels + StateFlows
│   │   ├── db/                  # Room KMP (@Database, @Dao, BundledSQLiteDriver)
│   │   ├── playback/            # expect class PlatformAudioEngine, QueueManager
│   │   └── security/            # expect interface SecureCredentialVault
│   ├── src/androidMain/         # ExoPlayer (Media3), AndroidKeyStore, MediaSessionService
│   ├── src/iosMain/             # AVQueuePlayer, MPNowPlayingInfoCenter, Keychain Services
│   ├── src/macosMain/           # AVPlayer, NSWindow FullSizeContentView, Keychain
│   └── src/jvmDesktopMain/      # libmpv JNA binding, Windows SMTC, DPAPI Vault
├── innertube/ (commonMain)      # Ktor Client, YouTubeClient (WEB_REMIX, IOS, TVHTML5)
├── lrclib/    (commonMain)      # Hardened O(N) LRC Parser + HTTPS Ktor Client
└── kugou/     (commonMain)      # Sanitized HTTPS Kugou Lyrics Client
```

### Interactive Component & State Mapping

- **Web Audio Harmonic Engine & Transport State**:
  - Playing a track activates a genuine Web Audio API multi-oscillator harmonic synthesizer (generating warm chord progressions, bassline, and rhythmic pulse unique to each track's BPM and key) so playback, scrubbing, volume control, 5-band EQ adjustments, and real-time frequency visualizer work deterministically in any browser without external copyrighted MP3 dependencies failing.
  - Switching the **Target OS Preview** (`macOS`, `Windows 11`, `iOS 18`) dynamically reconfigures the stream resolver's selected container (`itag 140 M4A/AAC` via `AVPlayer` on iOS/macOS vs. `itag 251 WebM/Opus` via `libmpv`/`ExoPlayer` on Windows/Android) and adapts the shell chrome and navigation layout.
- **Synced Lyrics & Queue State**:
  - As playback progresses (or when the user drags the scrub bar or clicks any lyric line), `findActiveLyricIndex(lyrics, currentTimeMs)` highlights the active lyric line in real time with smooth auto-scrolling.
  - Users can switch lyric sources (`LRCLIB Verified`, `Kugou Synced`, `InnerTube Plain`) and test malformed LRC payloads safely.
- **Listen Together Jam Synchronization**:
  - Users can add/remove simulated peers, trigger a simulated network latency spike (e.g., `+420ms` drift on a Windows peer), and execute the **NTP Drift Compensation** algorithm (`calculateJamDriftSync`), which computes the exact playback rate adjustment (`1.03x` catch-up or immediate seek if drift $> 1500\text{ms}$) and verifies HMAC command signatures.
- **Security Audit & InnerTube Sandbox**:
  - Each of the 6 vulnerabilities includes an interactive **"Test Exploit Payload"** button and a **"Toggle Hardened KMP Patch"** switch. Running the test executes the real validation logic (e.g., testing `../../etc/passwd` or `../song.db` against `validateBackupArchive`, or testing an unsigned Jam skip command against `verifyJamCommandHmac`) and displays the live pass/block telemetry.
