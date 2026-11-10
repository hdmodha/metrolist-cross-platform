import type { StreamFormatCandidate, TargetPlatformOS } from '../utils/metrolistCore';

export interface MetrolistTrack {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  bpm: number;
  rootFreqHz: number;
  chordIntervals: number[];
  coverUrl: string;
  accentColor: string;
  genre: 'Electronic' | 'Ambient' | 'Post-Rock' | 'Synthwave' | 'Indie' | 'YouTube Music';
  liked: boolean;
  cachedOffline: boolean;
  cacheSizeMb: number;
  sha256Checksum: string;
  lyricsSource: 'LRCLIB' | 'Kugou' | 'InnerTube';
  rawLrc: string;
  streamCandidates: StreamFormatCandidate[];
  directAudioUrl?: string;
  isLiveInnerTube?: boolean;
}

export interface JamPeer {
  id: string;
  name: string;
  platform: TargetPlatformOS;
  deviceModel: string;
  role: 'HOST' | 'GUEST';
  rttMs: number;
  clientPositionMs: number;
  playbackRate: number;
  verifiedHmac: boolean;
}

export interface KmpArchitectureModule {
  id: string;
  name: string;
  layer: 'commonMain' | 'iosMain' | 'macosMain' | 'jvmDesktopMain' | 'androidMain';
  reusePercentage: number;
  originalAndroidPath: string;
  kmpTargetPath: string;
  summary: string;
  keyApis: string[];
  expectCode: string;
  actualCodeByPlatform: Record<TargetPlatformOS, string>;
}

export interface SecurityVulnerabilityItem {
  id: string;
  code: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  affectedModule: string;
  cwe: string;
  legacyRiskDescription: string;
  kmpRemediationSummary: string;
  exploitPayloadSample: string;
  vulnerableCodeSnippet: string;
  hardenedKmpSnippet: string;
}

const DEFAULT_CANDIDATES: StreamFormatCandidate[] = [
  {
    itag: 251,
    mimeType: 'audio/webm; codecs="opus"',
    codec: 'opus',
    container: 'webm',
    bitrateKbps: 160,
    sampleRateHz: 48000,
    channels: 2,
    signatureCipher: 'ZZ9876543210METROLIST_OPUS_251',
  },
  {
    itag: 140,
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    codec: 'aac',
    container: 'mp4',
    bitrateKbps: 128,
    sampleRateHz: 44100,
    channels: 2,
    signatureCipher: 'AA5432109876METROLIST_AAC_140',
  },
  {
    itag: 250,
    mimeType: 'audio/webm; codecs="opus"',
    codec: 'opus',
    container: 'webm',
    bitrateKbps: 70,
    sampleRateHz: 48000,
    channels: 2,
    signatureCipher: 'BB1122334455METROLIST_OPUS_250',
  },
];

export const INITIAL_TRACKS: MetrolistTrack[] = [
  {
    id: 'trk-01',
    videoId: 'ytm_NP_9081a',
    title: 'Night Prism',
    artist: 'Obsidian Sound',
    album: 'Night Prism (180g Vinyl Session)',
    durationMs: 218000,
    bpm: 112,
    rootFreqHz: 220.0, // A3 minor
    chordIntervals: [0, 3, 7, 10],
    coverUrl: '/src/assets/images/album_midnight_synth_1794313619830.jpg',
    accentColor: '#6366F1',
    genre: 'Synthwave',
    liked: true,
    cachedOffline: true,
    cacheSizeMb: 4.8,
    sha256Checksum: '8f9d2a71e0c4b391a82e7f44190c5d82b73a91e4',
    lyricsSource: 'LRCLIB',
    rawLrc: [
      '[00:00.00] Instrumental Intro — Analog Sub & Prism Arpeggio',
      '[00:08.50] Refracting city light through obsidian glass // 黒曜石のガラスを通る都市の光',
      '[00:17.20] Every frequency aligned across the midnight bus',
      '[00:26.00] No interruptions in the signal path tonight',
      '[00:35.40] Caching memories inside a local vault // ローカルヴォールトに記憶をキャッシュする',
      '[00:44.80] From Tokyo towers to Cupertino silicon',
      '[00:54.10] One shared waveform resonating in sync',
      '[01:05.00] Drifting weightless above the static floor',
      '[01:18.50] Night prism holding the last amber ray',
      '[01:32.00] Pure Opus frames locked at forty-eight kilohertz',
    ].join('\n'),
    streamCandidates: DEFAULT_CANDIDATES,
  },
  {
    id: 'trk-02',
    videoId: 'ytm_TR_4412b',
    title: 'Shinjuku Raindrop Protocol',
    artist: 'Kaito & The Late Trains',
    album: 'After Hours in Chiyoda',
    durationMs: 194000,
    bpm: 94,
    rootFreqHz: 196.0, // G3
    chordIntervals: [0, 4, 7, 11],
    coverUrl: '/src/assets/images/album_tokyo_rain_1794313623366.jpg',
    accentColor: '#F59E0B',
    genre: 'Ambient',
    liked: true,
    cachedOffline: true,
    cacheSizeMb: 4.1,
    sha256Checksum: '3c11f908a4d271b9e56011d8a3f9c02b44e8123a',
    lyricsSource: 'Kugou',
    rawLrc: [
      '[00:00.00] Field Recording — Rain on Shinjuku Windowpane',
      '[00:07.00] Amber taillights dissolving in the mist // 霧の中に溶けていく琥珀色のテールライト',
      '[00:15.80] Last Yamanote train hums along the wet viaduct',
      '[00:24.50] Synchronized headphones across two hemispheres',
      '[00:33.90] Zero latency between the raindrop and the chord',
      '[00:43.20] Quiet shelter inside the nocturnal stream // 夜行性のストリームの中の静かな避難所',
      '[00:55.00] Analog warmth against the cold neon drizzle',
      '[01:08.40] Fading out beneath the station platform clock',
    ].join('\n'),
    streamCandidates: DEFAULT_CANDIDATES,
  },
  {
    id: 'trk-03',
    videoId: 'ytm_NE_7731c',
    title: 'Basalt Fjord Echoes',
    artist: 'Sigurðsson & Olsen',
    album: 'Nordic Mist (ECM 1432)',
    durationMs: 246000,
    bpm: 78,
    rootFreqHz: 164.81, // E3
    chordIntervals: [0, 3, 7, 14],
    coverUrl: '/src/assets/images/album_nordic_echoes_1794313623118.jpg',
    accentColor: '#38BDF8',
    genre: 'Post-Rock',
    liked: false,
    cachedOffline: false,
    cacheSizeMb: 5.4,
    sha256Checksum: '7a44e812c9b0012f8e341299a7c6d51e90f12c4b',
    lyricsSource: 'LRCLIB',
    rawLrc: [
      '[00:00.00] Bowed Cello & Glacial Reverb Tail',
      '[00:10.00] Dark basalt cliffs rising from the mirror sea',
      '[00:21.50] Cold silver horizon where the gulls Circle slow',
      '[00:33.00] Every echo returns cleaner than before',
      '[00:45.20] Unbroken silence between the northern tides',
      '[00:58.00] Carried across the water without distortion',
      '[01:14.50] Twilight settling on the fjord wall',
    ].join('\n'),
    streamCandidates: DEFAULT_CANDIDATES,
  },
  {
    id: 'trk-04',
    videoId: 'ytm_AH_5590d',
    title: 'Modular Patch Bay 04',
    artist: 'Buchla Telemetry',
    album: 'Voltage Controlled Architecture',
    durationMs: 182000,
    bpm: 124,
    rootFreqHz: 246.94, // B3
    chordIntervals: [0, 5, 7, 10],
    coverUrl: '/src/assets/images/album_analog_horizon_1794313623251.jpg',
    accentColor: '#10B981',
    genre: 'Electronic',
    liked: true,
    cachedOffline: false,
    cacheSizeMb: 3.9,
    sha256Checksum: '5e91b204d7c8a113f60922e4d8b1a005c33e719f',
    lyricsSource: 'InnerTube',
    rawLrc: [
      '[00:00.00] Sequence Clock Trigger — 124 BPM Locked',
      '[00:06.50] Patch cables routing the carrier wave',
      '[00:14.00] Low-pass filter sweeping through harmonic peaks',
      '[00:22.80] Brushed aluminum faceplates warm to the touch',
      '[00:31.50] Multi-platform audio callbacks firing on time',
      '[00:41.00] Hardware transport keys bound to the main bus',
      '[00:52.00] Envelope release trailing into pure sine',
    ].join('\n'),
    streamCandidates: DEFAULT_CANDIDATES,
  },
  {
    id: 'trk-05',
    videoId: 'ytm_VL_3109e',
    title: 'Velvet Subcarrier',
    artist: 'Obsidian Sound',
    album: 'Night Prism (180g Vinyl Session)',
    durationMs: 205000,
    bpm: 105,
    rootFreqHz: 174.61, // F3
    chordIntervals: [0, 4, 7, 9],
    coverUrl: '/src/assets/images/album_midnight_synth_1794313619830.jpg',
    accentColor: '#8B5CF6',
    genre: 'Indie',
    liked: false,
    cachedOffline: true,
    cacheSizeMb: 4.4,
    sha256Checksum: '9b02c418e7f113a6d54890c2e1f7a334b80d12e9',
    lyricsSource: 'LRCLIB',
    rawLrc: [
      '[00:00.00] Warm Tape Flutter & Rhodes Chord',
      '[00:09.20] Underneath the carrier wave we found room to breathe',
      '[00:18.60] Playlists synced across every desk and pocket',
      '[00:28.00] No gatekeepers standing at the studio door',
      '[00:39.50] Open source rhythms built to endure',
      '[00:51.00] Holding the groove until the final bar',
    ].join('\n'),
    streamCandidates: DEFAULT_CANDIDATES,
  },
];

export const INITIAL_JAM_PEERS: JamPeer[] = [
  {
    id: 'peer-host-mac',
    name: 'Harsh (Host · MacBook Pro M4)',
    platform: 'macos',
    deviceModel: 'macOS 15.3 Sequoia · AVQueuePlayer',
    role: 'HOST',
    rttMs: 18,
    clientPositionMs: 36000,
    playbackRate: 1.0,
    verifiedHmac: true,
  },
  {
    id: 'peer-ios-16',
    name: 'Elena (iPhone 16 Pro)',
    platform: 'ios',
    deviceModel: 'iOS 18.2 · AVAudioSession Background',
    role: 'GUEST',
    rttMs: 44,
    clientPositionMs: 36010,
    playbackRate: 1.0,
    verifiedHmac: true,
  },
  {
    id: 'peer-win-11',
    name: 'Marcus (Surface Laptop Studio)',
    platform: 'windows',
    deviceModel: 'Windows 11 24H2 · libmpv + SMTC',
    role: 'GUEST',
    rttMs: 68,
    clientPositionMs: 35620,
    playbackRate: 1.01,
    verifiedHmac: true,
  },
  {
    id: 'peer-android-px',
    name: 'Sora (Pixel 9 Pro)',
    platform: 'android',
    deviceModel: 'Android 15 · Media3 ExoPlayer',
    role: 'GUEST',
    rttMs: 32,
    clientPositionMs: 36005,
    playbackRate: 1.0,
    verifiedHmac: true,
  },
];

export const FRAMEWORK_COMPARISON_MATRIX = [
  {
    criterion: 'Existing Metrolist Code Reuse (~45k LOC Kotlin)',
    kmpCompose: '85% – 90% Direct Reuse (innertube, lrclib, kugou, Room, Compose UI)',
    flutter: '0% Reuse (Requires 100% full rewrite into Dart)',
    reactNative: '0% Reuse (Requires 100% rewrite into TypeScript + native bridges)',
    winner: 'KMP + Compose Multiplatform',
  },
  {
    criterion: 'InnerTube Protocol & Signature Deciphering',
    kmpCompose: 'Native Ktor + kotlinx.serialization shared in commonMain',
    flutter: 'Must port all YouTubeClient & cipher parsers to Dart manually',
    reactNative: 'JS bridge serialization overhead on heavy browse/next JSON trees',
    winner: 'KMP + Compose Multiplatform',
  },
  {
    criterion: 'iOS, macOS & Windows Native Audio & Media Keys',
    kmpCompose: 'Direct Objective-C interop (AVPlayer/MPRemoteCommandCenter) + JNA libmpv/SMTC',
    flutter: 'Relies on community plugins (just_audio / audio_service) with desktop gaps',
    reactNative: 'react-native-track-player lacks mature macOS & Windows desktop support',
    winner: 'KMP + Compose Multiplatform',
  },
  {
    criterion: 'Database Persistence (song.db & Offline Cache)',
    kmpCompose: 'Official AndroidX Room KMP 2.7+ with BundledSQLiteDriver across all 4 OSes',
    flutter: 'Requires migration to Drift / sqflite with new schema definitions',
    reactNative: 'Requires migration to WatermelonDB / op-sqlite',
    winner: 'KMP + Compose Multiplatform',
  },
  {
    criterion: 'UI Fidelity & Material 3 Dynamic Theme',
    kmpCompose: 'Skia-backed Compose Multiplatform matches Android Material 3 pixel-for-pixel',
    flutter: 'High performance via Impeller, but requires rebuilding all custom components',
    reactNative: 'Fragmented styling across React Native iOS and React Native Windows/macOS',
    winner: 'KMP + Compose Multiplatform',
  },
];

export const KMP_MIGRATION_MODULES: KmpArchitectureModule[] = [
  {
    id: 'mod-audio',
    name: 'PlatformAudioEngine (Playback & Lock-Screen Controls)',
    layer: 'commonMain',
    reusePercentage: 78,
    originalAndroidPath: 'app/src/main/kotlin/com/metrolist/music/playback/MusicService.kt',
    kmpTargetPath: 'composeApp/src/commonMain/kotlin/com/metrolist/music/playback/PlatformAudioEngine.kt',
    summary:
      'Decouples Android Media3 ExoPlayer into a multiplatform expect/actual controller supporting AVQueuePlayer on iOS/macOS and libmpv + SMTC on Windows.',
    keyApis: [
      'expect class PlatformAudioEngine',
      'StateFlow<PlaybackState>',
      'MPNowPlayingInfoCenter (Apple)',
      'SystemMediaTransportControls (Windows)',
    ],
    expectCode: `// composeApp/src/commonMain/kotlin/com/metrolist/music/playback/PlatformAudioEngine.kt
package com.metrolist.music.playback

import kotlinx.coroutines.flow.StateFlow

expect class PlatformAudioEngine() {
    val playbackState: StateFlow<PlaybackSnapshot>
    fun prepareAndPlay(streamUrl: String, mimeType: String, metadata: TrackMetadata)
    fun pause()
    fun seekTo(positionMs: Long)
    fun setPlaybackSpeed(rate: Float)
    fun setEqualizerBands(gainsDb: List<Float>)
    fun release()
}`,
    actualCodeByPlatform: {
      ios: `// composeApp/src/iosMain/kotlin/com/metrolist/music/playback/PlatformAudioEngine.ios.kt
actual class PlatformAudioEngine {
    private val avPlayer = AVQueuePlayer()

    init {
        val session = AVAudioSession.sharedInstance()
        session.setCategory(AVAudioSessionCategoryPlayback, error = null)
        session.setActive(true, error = null)
        setupRemoteCommandCenter() // Lock-screen & Control Center play/pause/scrub
    }

    actual fun prepareAndPlay(streamUrl: String, mimeType: String, metadata: TrackMetadata) {
        // Selects itag 140 (M4A/AAC) for native hardware decoding on Apple Silicon
        val item = AVPlayerItem(uRL = NSURL.URLWithString(streamUrl)!!)
        avPlayer.replaceCurrentItemWithPlayerItem(item)
        avPlayer.play()
        updateNowPlayingCenter(metadata)
    }
}`,
      macos: `// composeApp/src/macosMain/kotlin/com/metrolist/music/playback/PlatformAudioEngine.macos.kt
actual class PlatformAudioEngine {
    private val avPlayer = AVQueuePlayer()

    init {
        val commandCenter = MPRemoteCommandCenter.sharedCommandCenter()
        commandCenter.playCommand.addTargetWithHandler { avPlayer.play(); MPRemoteCommandHandlerStatusSuccess }
        commandCenter.pauseCommand.addTargetWithHandler { avPlayer.pause(); MPRemoteCommandHandlerStatusSuccess }
    }

    actual fun prepareAndPlay(streamUrl: String, mimeType: String, metadata: TrackMetadata) {
        val url = NSURL.URLWithString(streamUrl) ?: return
        avPlayer.replaceCurrentItemWithPlayerItem(AVPlayerItem(uRL = url))
        avPlayer.play()
        MPNowPlayingInfoCenter.defaultCenter().nowPlayingInfo = metadata.toMacNowPlayingMap()
    }
}`,
      windows: `// composeApp/src/jvmDesktopMain/kotlin/com/metrolist/music/playback/PlatformAudioEngine.desktop.kt
actual class PlatformAudioEngine {
    private val mpvHandle = LibMpv.INSTANCE.mpv_create()
    private val smtcBridge = WindowsSmtcNativeBridge() // Windows 11 Media Flyout & Hardware Keys

    init {
        LibMpv.INSTANCE.mpv_initialize(mpvHandle)
        LibMpv.INSTANCE.mpv_set_option_string(mpvHandle, "vid", "no")
    }

    actual fun prepareAndPlay(streamUrl: String, mimeType: String, metadata: TrackMetadata) {
        // Natively decodes YouTube itag 251 (WebM/Opus 160kbps @ 48kHz)
        LibMpv.INSTANCE.mpv_command(mpvHandle, arrayOf("loadfile", streamUrl, "replace"))
        smtcBridge.updateTimelineAndMetadata(metadata.title, metadata.artist, metadata.coverPath)
    }
}`,
      android: `// composeApp/src/androidMain/kotlin/com/metrolist/music/playback/PlatformAudioEngine.android.kt
actual class PlatformAudioEngine(context: Context) {
    private val exoPlayer = ExoPlayer.Builder(context)
        .setAudioAttributes(AudioAttributes.DEFAULT, /* handleAudioFocus = */ true)
        .build()

    actual fun prepareAndPlay(streamUrl: String, mimeType: String, metadata: TrackMetadata) {
        val mediaItem = MediaItem.Builder().setUri(streamUrl).setMimeType(mimeType).build()
        exoPlayer.setMediaItem(mediaItem)
        exoPlayer.prepare()
        exoPlayer.play()
    }
}`,
    },
  },
  {
    id: 'mod-innertube',
    name: 'InnerTube Ktor Client & Sandboxed Cipher Engine',
    layer: 'commonMain',
    reusePercentage: 98,
    originalAndroidPath: 'innertube/src/main/kotlin/com/metrolist/innertube/YouTube.kt',
    kmpTargetPath: 'innertube/src/commonMain/kotlin/com/metrolist/innertube/YouTube.kt',
    summary:
      '100% shared Kotlin networking module using Ktor ContentNegotiation, multi-client context spoofing (WEB_REMIX, IOS, TVHTML5), and sandboxed signature deciphering.',
    keyApis: [
      'Ktor HttpClient (Darwin / WinHttp / OkHttp)',
      'YouTubeClient.IOS & WEB_REMIX',
      'generateSapisidHash()',
      'SandboxedSignatureCipher',
    ],
    expectCode: `// innertube/src/commonMain/kotlin/com/metrolist/innertube/YouTubeClientEngine.kt
package com.metrolist.innertube

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngineFactory

expect fun platformHttpClientEngine(): HttpClientEngineFactory<*>

class InnerTubeRepository(private val vault: SecureCredentialVault) {
    suspend fun fetchPlayerResponse(videoId: String, targetOs: PlatformTarget): PlayerResponse {
        // Automatically negotiates Darwin engine on iOS/macOS and WinHttp/CIO on Windows
        val clientContext = if (targetOs.isApple) YouTubeClient.IOS else YouTubeClient.WEB_REMIX
        return httpClient.post("https://music.youtube.com/youtubei/v1/player") {
            header("Authorization", vault.buildSapisidAuthorizationHeader())
            setBody(PlayerRequest(context = clientContext, videoId = videoId))
        }.body()
    }
}`,
    actualCodeByPlatform: {
      ios: `// innertube/src/iosMain/kotlin/com/metrolist/innertube/YouTubeClientEngine.ios.kt
import io.ktor.client.engine.darwin.Darwin
actual fun platformHttpClientEngine() = Darwin // Uses NSURLSession with TLS 1.3 & HTTP/3`,
      macos: `// innertube/src/macosMain/kotlin/com/metrolist/innertube/YouTubeClientEngine.macos.kt
import io.ktor.client.engine.darwin.Darwin
actual fun platformHttpClientEngine() = Darwin // Shared Apple NSURLSession stack`,
      windows: `// innertube/src/jvmDesktopMain/kotlin/com/metrolist/innertube/YouTubeClientEngine.desktop.kt
import io.ktor.client.engine.okhttp.OkHttp
actual fun platformHttpClientEngine() = OkHttp // Connection pooling + Brotli compression`,
      android: `// innertube/src/androidMain/kotlin/com/metrolist/innertube/YouTubeClientEngine.android.kt
import io.ktor.client.engine.okhttp.OkHttp
actual fun platformHttpClientEngine() = OkHttp`,
    },
  },
  {
    id: 'mod-database',
    name: 'Room KMP Persistence (song.db) & Validated Backup Vault',
    layer: 'commonMain',
    reusePercentage: 94,
    originalAndroidPath: 'app/src/main/kotlin/com/metrolist/music/db/MusicDatabase.kt',
    kmpTargetPath: 'composeApp/src/commonMain/kotlin/com/metrolist/music/db/MusicDatabase.kt',
    summary:
      'Migrates Android Room SQLite database to Room 2.7+ KMP using BundledSQLiteDriver so identical @Entity and @Dao queries run across iOS, macOS, Windows, and Android.',
    keyApis: [
      '@ConstructedBy(MusicDatabaseConstructor::class)',
      'BundledSQLiteDriver()',
      'PRAGMA integrity_check',
      'ZipSlipGuardValidator',
    ],
    expectCode: `// composeApp/src/commonMain/kotlin/com/metrolist/music/db/MusicDatabase.kt
@Database(entities = [SongEntity::class, PlaylistEntity::class, LyricsEntity::class], version = 24)
@ConstructedBy(MusicDatabaseConstructor::class)
abstract class MusicDatabase : RoomDatabase() {
    abstract fun songDao(): SongDao
}

fun buildCrossPlatformRoomDb(builder: RoomDatabase.Builder<MusicDatabase>): MusicDatabase {
    return builder
        .setDriver(BundledSQLiteDriver())
        .setQueryCoroutineContext(Dispatchers.IO)
        .build()
}`,
    actualCodeByPlatform: {
      ios: `// composeApp/src/iosMain/kotlin/com/metrolist/music/db/DatabaseBuilder.ios.kt
fun getIosDatabaseBuilder(): RoomDatabase.Builder<MusicDatabase> {
    val docDir = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, true).first() as String
    return Room.databaseBuilder<MusicDatabase>(name = "$docDir/metrolist_song.db")
}`,
      macos: `// composeApp/src/macosMain/kotlin/com/metrolist/music/db/DatabaseBuilder.macos.kt
fun getMacOsDatabaseBuilder(): RoomDatabase.Builder<MusicDatabase> {
    val appSupport = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, true).first() as String
    return Room.databaseBuilder<MusicDatabase>(name = "$appSupport/Metrolist/song.db")
}`,
      windows: `// composeApp/src/jvmDesktopMain/kotlin/com/metrolist/music/db/DatabaseBuilder.desktop.kt
fun getWindowsDatabaseBuilder(): RoomDatabase.Builder<MusicDatabase> {
    val appData = System.getenv("LOCALAPPDATA") ?: System.getProperty("user.home")
    val dbFile = File(appData, "Metrolist/databases/song.db")
    return Room.databaseBuilder<MusicDatabase>(name = dbFile.absolutePath)
}`,
      android: `// composeApp/src/androidMain/kotlin/com/metrolist/music/db/DatabaseBuilder.android.kt
fun getAndroidDatabaseBuilder(ctx: Context): RoomDatabase.Builder<MusicDatabase> {
    return Room.databaseBuilder<MusicDatabase>(ctx, ctx.getDatabasePath("song.db").absolutePath)
}`,
    },
  },
  {
    id: 'mod-security',
    name: 'SecureCredentialVault (OS Keychain & Cookie Protection)',
    layer: 'commonMain',
    reusePercentage: 82,
    originalAndroidPath: 'app/src/main/kotlin/com/metrolist/music/utils/DataStore.kt',
    kmpTargetPath: 'composeApp/src/commonMain/kotlin/com/metrolist/music/security/SecureCredentialVault.kt',
    summary:
      'Eliminates plaintext SAPISID cookie storage in unencrypted preferences by delegating to Apple Keychain Services, Windows DPAPI Credential Locker, and AndroidKeyStore.',
    keyApis: [
      'SecItemAdd / kSecClassGenericPassword (Apple)',
      'CryptProtectData DPAPI (Windows)',
      'AES-256-GCM MasterKey (Android)',
    ],
    expectCode: `// composeApp/src/commonMain/kotlin/com/metrolist/music/security/SecureCredentialVault.kt
expect class SecureCredentialVault {
    fun storeSapisidCookie(rawCookie: String)
    fun readSapisidCookie(): String?
    fun wipeCredentials()
}`,
    actualCodeByPlatform: {
      ios: `// Uses Apple Security.framework Keychain with kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`,
      macos: `// Uses macOS Keychain Services scoped to com.metrolist.music.kmp application group`,
      windows: `// Uses Windows Crypt32 DPAPI (CryptProtectData) bound to current NT user SID`,
      android: `// Uses AndroidKeyStore AES-256-GCM hardware-backed MasterKey cipher`,
    },
  },
];

export const SECURITY_VULNERABILITIES: SecurityVulnerabilityItem[] = [
  {
    id: 'vuln-01',
    code: 'VULN-01',
    title: 'Plaintext Google Account Cookie & SAPISID Storage in Preferences',
    severity: 'CRITICAL',
    affectedModule: 'utils/DataStore.kt -> security/SecureCredentialVault.kt',
    cwe: 'CWE-312: Cleartext Storage of Sensitive Information',
    legacyRiskDescription:
      'In the original Android architecture, InnerTube authentication cookies (SAPISID, __Secure-3PAPISID, VISITOR_INFO1_LIVE) are persisted in unencrypted DataStore preferences_pb files. On desktop (macOS/Windows) or rooted/backed-up mobile devices, any local process can read the file and hijack the Google account session.',
    kmpRemediationSummary:
      'Replaced plaintext DataStore cookie keys with expect class SecureCredentialVault backed by iOS/macOS Keychain (kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly), Windows DPAPI (CryptProtectData), and AndroidKeyStore AES-256-GCM.',
    exploitPayloadSample: 'Read ~/.local/share/Metrolist/datastore/settings.preferences_pb -> Extract SAPISID=8f92a_live_cookie',
    vulnerableCodeSnippet: `// LEGACY VULNERABLE: Plaintext Preferences DataStore
val InnerTubeCookieKey = stringPreferencesKey("inner_tube_cookie")
suspend fun saveCookie(context: Context, cookie: String) {
    context.dataStore.edit { prefs ->
        prefs[InnerTubeCookieKey] = cookie // Stored unencrypted on disk!
    }
}`,
    hardenedKmpSnippet: `// HARDENED KMP: Hardware/OS Keychain Vault + Short-Lived SAPISIDHASH
actual fun storeSapisidCookie(rawCookie: String) {
    val encryptedBytes = osHardwareKeychain.encryptAesGcm(rawCookie.encodeToByteArray())
    keychainStore.write("com.metrolist.auth.sapisid", encryptedBytes)
}`,
  },
  {
    id: 'vuln-02',
    code: 'VULN-02',
    title: 'Unvalidated Backup .zip Restore (Zip-Slip Traversal & SQLite Injection)',
    severity: 'HIGH',
    affectedModule: 'ui/screens/settings/BackupRestoreViewModel.kt',
    cwe: 'CWE-22: Improper Limitation of a Pathname to a Restricted Directory',
    legacyRiskDescription:
      'Metrolist exports and imports user databases as .zip archives containing song.db and settings. Without canonical path verification, a crafted .backup zip entry named "../../LaunchAgents/evil.plist" (macOS) or "../../song.db" overwrites arbitrary files or injects a corrupted SQLite binary that crashes Room.',
    kmpRemediationSummary:
      'Added strict entry allowlisting (song.db, settings.preferences_pb), canonical path prefix checks, a 50 MB decompression ceiling (blocking Zip-Bombs), and SQLite 16-byte magic header + PRAGMA integrity_check before database swap.',
    exploitPayloadSample: 'Archive Entry: "../../Users/shared/Library/LaunchAgents/com.metrolist.backdoor.plist" (Ratio 240:1)',
    vulnerableCodeSnippet: `// LEGACY VULNERABLE: Direct ZipInputStream copy without canonical path check
ZipInputStream(inputStream).use { zip ->
    var entry = zip.nextEntry
    while (entry != null) {
        val targetFile = File(filesDir, entry.name) // Vulnerable to "../../" Zip-Slip!
        zip.copyTo(FileOutputStream(targetFile))
        entry = zip.nextEntry
    }
}`,
    hardenedKmpSnippet: `// HARDENED KMP: Canonical Path Guard + SQLite Header & Integrity Verification
val report = validateBackupArchive(entries, hardenedMode = true)
require(report.valid) { report.blockedReason ?: "Invalid backup archive" }
sqliteTempDb.execSQL("PRAGMA integrity_check;") // Verified in sandbox before swap`,
  },
  {
    id: 'vuln-03',
    code: 'VULN-03',
    title: 'Unauthenticated "Listen Together" Jam SessionHijacking & Queue Poisoning',
    severity: 'HIGH',
    affectedModule: 'playback/jam/ListenTogetherClient.kt',
    cwe: 'CWE-306: Missing Authentication for Critical Function',
    legacyRiskDescription:
      'Synchronized Jam rooms rely on short room codes over WebSockets. Without per-command HMAC signing and host role enforcement, any peer guessing a room code can flood SKIP/SEEK commands or inject malicious stream URLs into all connected listeners.',
    kmpRemediationSummary:
      'Implemented ephemeral room shared secrets derived on join, HMAC-SHA256 command envelope signatures with monotonic replay nonces, and strict Host-Only vs. Collaborative permission gates.',
    exploitPayloadSample: '{"roomId":"METRO-88A","senderId":"spoofed-peer","senderRole":"GUEST","action":"SKIP","hmacSignature":"UNSIGNED_FORGED"}',
    vulnerableCodeSnippet: `// LEGACY VULNERABLE: Trusting raw WebSocket JSON action without signature or role check
webSocket.incoming.consumeEach { frame ->
    val cmd = Json.decodeFromString<JamCommand>(frame.readText())
    if (cmd.action == "SKIP") player.seekToNext() // Any unverified guest can hijack playback!
}`,
    hardenedKmpSnippet: `// HARDENED KMP: HMAC-SHA256 Verification + Role Permission Gate
val auth = verifyJamCommandAuthorization(envelope, roomSecret, allowGuestControl, hardenedMode = true)
if (!auth.authorized) {
    securityLogger.warnRejectedCommand(envelope.senderId, auth.reason)
    return
}`,
  },
  {
    id: 'vuln-04',
    code: 'VULN-04',
    title: 'Synced Lyrics Parser ReDoS & Unbounded Memory Allocation (Kugou / LRCLIB)',
    severity: 'MEDIUM',
    affectedModule: 'lrclib/src/main/kotlin/com/metrolist/lrclib/LrcParser.kt',
    cwe: 'CWE-1333: Inefficient Regular Expression Complexity',
    legacyRiskDescription:
      'Fetching third-party synced lyrics from Kugou or LRCLIB and parsing timecodes with nested catastrophic backtracking regexes can freeze the UI thread or trigger OutOfMemoryError when a malformed 10 MB payload is returned.',
    kmpRemediationSummary:
      'Replaced nested regex matching with a deterministic O(N) linear-time character scanner, capped lyric payloads at 64 KB (max 500 lines), and isolated parsing on Dispatchers.Default.',
    exploitPayloadSample: '[00:01.00]' + '[[[[00:02.00]]]]'.repeat(15) + ' Malformed nested timecode payload',
    vulnerableCodeSnippet: `// LEGACY VULNERABLE: Unbounded regex matching on untrusted third-party HTTP response
val regex = Regex("""^((\\[\\d+:\\d+([.:]\\d+)?\\])+)(.*)$""")
rawResponse.lines().forEach { line ->
    regex.matchEntire(line) // Catastrophic backtracking on malformed bracket sequences!
}`,
    hardenedKmpSnippet: `// HARDENED KMP: O(N) Bounded Scanner (Max 64 KB / 500 Lines)
val parsed = parseSyncedLrc(rawResponse, hardenedMode = true)
// Rejects malformed tags in O(1) per line without regular expression backtracking`,
  },
  {
    id: 'vuln-05',
    code: 'VULN-05',
    title: 'Cleartext HTTP Fallback & Session Metadata Leakage to Lyrics Providers',
    severity: 'MEDIUM',
    affectedModule: 'kugou/src/main/kotlin/com/metrolist/kugou/Kugou.kt',
    cwe: 'CWE-319: Cleartext Transmission of Sensitive Information',
    legacyRiskDescription:
      'Legacy Kugou API endpoints occasionally default to cleartext http:// URLs and pass unsanitized track metadata (including private YouTube playlist tokens or bracketed user notes) in third-party search queries.',
    kmpRemediationSummary:
      'Enforced strict HTTPS/TLS 1.3 upgrading across Darwin and OkHttp engines, and added a query sanitizer that strips session tokens, visitor_data, and bracketed annotations before querying Kugou or LRCLIB.',
    exploitPayloadSample: 'http://lyrics.kugou.com/search?track=Night+Prism+[token= secret]&sapisid=3PAPISID_9981',
    vulnerableCodeSnippet: `// LEGACY VULNERABLE: Cleartext HTTP request with unsanitized parameters
httpClient.get("http://lyrics.kugou.com/search") {
    parameter("keyword", "$rawTrackTitle - $rawArtist")
}`,
    hardenedKmpSnippet: `// HARDENED KMP: Automatic HTTPS Upgrade + Sensitive Parameter Stripper
val sanitized = buildSanitizedLyricsRequest(endpoint, title, artist, extraParams, hardenedMode = true)
httpClient.get(sanitized.finalUrl) // Guaranteed https:// with sensitive keys stripped`,
  },
  {
    id: 'vuln-06',
    code: 'VULN-06',
    title: 'Dynamic JavaScript Evaluation in InnerTube Signature Cipher Decryption',
    severity: 'MEDIUM',
    affectedModule: 'innertube/src/main/kotlin/com/metrolist/innertube/SignatureCipher.kt',
    cwe: 'CWE-94: Improper Control of Generation of Code (Code Injection)',
    legacyRiskDescription:
      'Many third-party YouTube clients download player base.js and execute deobfuscated functions inside a hidden WebView or Rhino/QuickJS engine without sandboxing, exposing the client to remote code execution if base.js is MITM-tampered.',
    kmpRemediationSummary:
      'Eliminated dynamic JS evaluation in favor of a pure Kotlin deterministic slice/swap/reverse AST interpreter (`decipherInnerTubeSignature`) that only executes integer array permutations.',
    exploitPayloadSample: 'cipherOps: [{ op: "slice", arg: 2 }, { op: "reverse", arg: 0 }, { op: "swap", arg: 5 }]',
    vulnerableCodeSnippet: `// LEGACY VULNERABLE: Executing remote player JS inside WebView / ScriptEngine
webView.evaluateJavascript("decipherSig('$obfuscatedSig')", callback) // Arbitrary JS execution risk!`,
    hardenedKmpSnippet: `// HARDENED KMP: Pure Kotlin Deterministic Array Permutation (Zero JS Eval)
val result = decipherInnerTubeSignature(obfuscatedSig, verifiedCipherOps)
// Only allows bounded character array reverse, slice, and modulo swap operations`,
  },
];

export const MIGRATION_STEP_CHECKLIST = [
  {
    phase: 'Phase 1',
    title: 'Extract Pure Kotlin Networking Modules (innertube, lrclib, kugou) to commonMain',
    duration: 'Week 1–2',
    status: 'VERIFIED',
    details:
      'Replace JVM-only java.net.URLEncoder and OkHttp-specific interceptors with Ktor multiplatform HttpClient, kotlinx.serialization, and Ktor Darwin (iOS/macOS) + OkHttp (Windows/Android) engines.',
  },
  {
    phase: 'Phase 2',
    title: 'Migrate song.db Persistence to AndroidX Room KMP 2.7+ & BundledSQLiteDriver',
    duration: 'Week 3',
    status: 'VERIFIED',
    details:
      'Annotate MusicDatabase with @ConstructedBy, replace Android Context file paths with platform-native NSDocumentDirectory (iOS), NSApplicationSupportDirectory (macOS), and LOCALAPPDATA (Windows), and add Zip-Slip backup validation.',
  },
  {
    phase: 'Phase 3',
    title: 'Implement expect/actual PlatformAudioEngine & Native OS Media Session Bridges',
    duration: 'Week 4–5',
    status: 'VERIFIED',
    details:
      'Bind AVQueuePlayer + MPNowPlayingInfoCenter + MPRemoteCommandCenter on iOS/macOS (routing itag 140 AAC streams) and libmpv FFI + Windows SMTC on Windows 11 (routing itag 251 Opus streams).',
  },
  {
    phase: 'Phase 4',
    title: 'Port Jetpack Compose Material 3 Screens to Compose Multiplatform & Adaptive Shell',
    duration: 'Week 6–7',
    status: 'VERIFIED',
    details:
      'Move UI screens to composeApp/src/commonMain, replace Android BackHandler/Intent with multiplatform navigation, and add adaptive NavigationRail + native window titlebar insets for macOS and Windows.',
  },
  {
    phase: 'Phase 5',
    title: 'Security Hardening Audit, OS Keychain Integration & CI/CD Signing',
    duration: 'Week 8',
    status: 'VERIFIED',
    details:
      'Migrate SAPISID cookies to Keychain/DPAPI, harden LRC parser against ReDoS, add HMAC-SHA256 signing to Listen Together Jam rooms, and package signed .dmg (macOS), .ipa (iOS), and .msix/.exe (Windows).',
  },
];
