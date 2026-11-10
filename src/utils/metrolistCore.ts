/**
 * Decoupled Pure Core Logic for Metrolist KMP Cross-Platform Client & Security Auditor.
 * Mirrors the shared `commonMain` Kotlin modules (`innertube`, `lrclib`, `kugou`, `security`, `playback`).
 */

export type TargetPlatformOS = 'macos' | 'windows' | 'ios' | 'android';

export interface StreamFormatCandidate {
  itag: number;
  mimeType: string;
  codec: 'opus' | 'aac';
  container: 'webm' | 'mp4';
  bitrateKbps: number;
  sampleRateHz: number;
  channels: number;
  signatureCipher?: string;
  url?: string;
}

export interface ResolvedStreamResult {
  selectedItag: number;
  codec: 'opus' | 'aac';
  container: 'webm' | 'mp4';
  bitrateKbps: number;
  sampleRateHz: number;
  nativeEngine: string;
  resolvedUrl: string;
  decipheredSignature: string;
  rationale: string;
}

export interface LyricLine {
  timeMs: number;
  formattedTime: string;
  text: string;
  translation?: string;
}

export interface ParsedLrcResult {
  lines: LyricLine[];
  rejectedLines: number;
  truncatedPayload: boolean;
  executionMode: 'LINEAR_O_N_HARDENED' | 'LEGACY_UNBOUNDED';
}

export interface JamSyncAdjustment {
  driftMs: number;
  absDriftMs: number;
  action: 'IN_SYNC' | 'MICRO_RATE_ADJUST' | 'HARD_SEEK';
  recommendedPlaybackRate: number;
  targetSeekMs: number | null;
  summary: string;
}

export interface BackupArchiveEntry {
  fileName: string;
  compressedBytes: number;
  uncompressedBytes: number;
  sqliteHeaderHex?: string;
}

export interface BackupValidationReport {
  valid: boolean;
  blockedReason: string | null;
  vulnerabilityTriggered: string | null;
  checkedEntries: number;
  totalUncompressedBytes: number;
}

export interface JamCommandEnvelope {
  roomId: string;
  senderId: string;
  senderRole: 'HOST' | 'GUEST';
  action: 'PLAY' | 'PAUSE' | 'SEEK' | 'SKIP' | 'REORDER_QUEUE';
  timestampMs: number;
  nonce: string;
  hmacSignature: string;
}

/**
 * Deterministic lightweight SHA-256 / HMAC simulation (pure synchronous implementation
 * so it runs identically in Node unit tests and browser without async SubtleCrypto race conditions).
 */
export function computeDeterministicHashHex(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  let h3 = 0x9e3779b9 ^ input.length;
  let h4 = 0x85ebca6b ^ input.length;

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
    h3 = Math.imul(h3 ^ (ch << 3), 2246822507);
    h4 = Math.imul(h4 ^ (ch << 7), 3266489909);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2246822507) ^ Math.imul(h4 ^ (h4 >>> 13), 3266489909);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2246822507) ^ Math.imul(h3 ^ (h3 >>> 13), 3266489909);

  const toHex8 = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${toHex8(h1)}${toHex8(h2)}${toHex8(h3)}${toHex8(h4)}${toHex8(h1 ^ h3)}`;
}

/**
 * 1. InnerTube SAPISIDHASH Authorization Header Generator
 * Format: `SAPISIDHASH <unix_epoch_sec>_<sha1_hex(epoch + " " + sapisid + " " + origin)>`
 */
export function generateSapisidHash(
  sapisidCookie: string,
  originUrl: string = 'https://music.youtube.com',
  timestampSec: number = Math.floor(Date.now() / 1000)
): { headerValue: string; timestampSec: number; digestHex: string; isValidInput: boolean } {
  const trimmedToken = sapisidCookie.trim();
  let cleanOrigin = originUrl.trim();
  while (cleanOrigin.endsWith('/')) {
    cleanOrigin = cleanOrigin.slice(0, -1);
  }
  if (!trimmedToken || trimmedToken.length < 8 || !cleanOrigin.startsWith('https://')) {
    return {
      headerValue: '',
      timestampSec,
      digestHex: '',
      isValidInput: false,
    };
  }
  const payload = `${timestampSec} ${trimmedToken} ${cleanOrigin}`;
  const digestHex = computeDeterministicHashHex(payload);
  return {
    headerValue: `SAPISIDHASH ${timestampSec}_${digestHex}`,
    timestampSec,
    digestHex,
    isValidInput: true,
  };
}

/**
 * 2. Sandboxed InnerTube Signature Cipher Deobfuscator (VULN-06 Mitigation)
 * Never uses `eval()` or WebView JS execution; applies deterministic slice/swap/reverse operations.
 */
export function decipherInnerTubeSignature(
  obfuscatedSig: string,
  cipherOps: Array<{ op: 'reverse' | 'slice' | 'swap'; arg: number }>
): { signature: string; safeAstExecution: boolean } {
  if (!obfuscatedSig || obfuscatedSig.length > 512) {
    return { signature: '', safeAstExecution: true };
  }
  const chars = obfuscatedSig.split('');
  for (const step of cipherOps) {
    if (step.op === 'reverse') {
      chars.reverse();
    } else if (step.op === 'slice') {
      const count = Math.max(0, Math.min(chars.length, step.arg));
      chars.splice(0, count);
    } else if (step.op === 'swap' && chars.length > 0) {
      const idx = Math.abs(step.arg) % chars.length;
      const temp = chars[0];
      chars[0] = chars[idx];
      chars[idx] = temp;
    }
  }
  return {
    signature: chars.join(''),
    safeAstExecution: true,
  };
}

/**
 * 3. Cross-Platform Stream Resolver (`expect class PlatformAudioEngine` stream selection)
 * - On Android (`ExoPlayer`) and Windows (`libmpv` JNA): selects highest bitrate WebM/Opus (`itag 251`).
 * - On iOS & macOS (`AVQueuePlayer`): selects native MP4/AAC (`itag 140`) or remuxed HLS stream
 *   because Apple's `AVPlayer` does not play raw WebM/Opus (`itag 251`) out-of-the-box without CAF remuxing.
 */
export function resolveOptimalAudioStream(
  platform: TargetPlatformOS,
  candidates: StreamFormatCandidate[],
  preferHighBitrate: boolean = true
): ResolvedStreamResult {
  const defaultOps: Array<{ op: 'reverse' | 'slice' | 'swap'; arg: number }> = [
    { op: 'slice', arg: 2 },
    { op: 'reverse', arg: 0 },
    { op: 'swap', arg: 5 },
  ];

  const isAppleNativeAvPlayer = platform === 'ios' || platform === 'macos';

  const compatible = candidates.filter((c) =>
    isAppleNativeAvPlayer ? c.container === 'mp4' && c.codec === 'aac' : true
  );

  const pool = compatible.length > 0 ? compatible : candidates;

  const sorted = [...pool].sort((a, b) => {
    if (!isAppleNativeAvPlayer) {
      // Prefer Opus on Windows (libmpv) and Android (ExoPlayer)
      if (a.codec !== b.codec) {
        return a.codec === 'opus' ? -1 : 1;
      }
    }
    return preferHighBitrate ? b.bitrateKbps - a.bitrateKbps : a.bitrateKbps - b.bitrateKbps;
  });

  const chosen = sorted[0] ?? {
    itag: isAppleNativeAvPlayer ? 140 : 251,
    mimeType: isAppleNativeAvPlayer ? 'audio/mp4; codecs="mp4a.40.2"' : 'audio/webm; codecs="opus"',
    codec: isAppleNativeAvPlayer ? 'aac' : 'opus',
    container: isAppleNativeAvPlayer ? 'mp4' : 'webm',
    bitrateKbps: isAppleNativeAvPlayer ? 128 : 160,
    sampleRateHz: isAppleNativeAvPlayer ? 44100 : 48000,
    channels: 2,
    signatureCipher: 'XX9876543210METROLISTKMP',
  };

  const deciphered = decipherInnerTubeSignature(
    chosen.signatureCipher || 'ZZMETROLIST_SIG_99481A',
    defaultOps
  );

  const engineMap: Record<TargetPlatformOS, string> = {
    macos: 'AVQueuePlayer + MPNowPlayingInfoCenter (macOS Native)',
    ios: 'AVQueuePlayer + AVAudioSession + MPRemoteCommandCenter (iOS Native)',
    windows: 'libmpv FFI + Windows.Media.SystemMediaTransportControls (SMTC)',
    android: 'AndroidX Media3 ExoPlayer + MediaSessionService',
  };

  const rationale = isAppleNativeAvPlayer
    ? `Selected itag ${chosen.itag} (${chosen.container.toUpperCase()}/${chosen.codec.toUpperCase()} ${chosen.bitrateKbps}kbps) for zero-copy hardware decoding on Apple AVPlayer.`
    : `Selected itag ${chosen.itag} (${chosen.container.toUpperCase()}/${chosen.codec.toUpperCase()} ${chosen.bitrateKbps}kbps) for highest fidelity Opus decoding on ${platform === 'windows' ? 'Windows libmpv' : 'Android ExoPlayer'}.`;

  return {
    selectedItag: chosen.itag,
    codec: chosen.codec,
    container: chosen.container,
    bitrateKbps: chosen.bitrateKbps,
    sampleRateHz: chosen.sampleRateHz,
    nativeEngine: engineMap[platform],
    resolvedUrl: `https://rr3---sn-metrolist.googlevideo.com/videoplayback?itag=${chosen.itag}&sig=${deciphered.signature}&ratebypass=yes`,
    decipheredSignature: deciphered.signature,
    rationale,
  };
}

/**
 * 4. Hardened O(N) Linear-Time LRC Lyrics Parser (VULN-04 Mitigation)
 * Prevents Regular Expression Denial of Service (ReDoS) and OutOfMemoryError on malformed Kugou/LRCLIB responses.
 */
const MAX_LRC_PAYLOAD_BYTES = 64 * 1024; // 64 KB ceiling per song lyric file
const MAX_LRC_LINES = 500;

export function parseSyncedLrc(rawLrc: string, hardenedMode: boolean = true): ParsedLrcResult {
  if (!rawLrc) {
    return {
      lines: [],
      rejectedLines: 0,
      truncatedPayload: false,
      executionMode: hardenedMode ? 'LINEAR_O_N_HARDENED' : 'LEGACY_UNBOUNDED',
    };
  }

  let workingText = rawLrc;
  let truncatedPayload = false;

  if (hardenedMode && workingText.length > MAX_LRC_PAYLOAD_BYTES) {
    workingText = workingText.slice(0, MAX_LRC_PAYLOAD_BYTES);
    truncatedPayload = true;
  }

  const rawRows = workingText.split(/\r?\n/);
  const lines: LyricLine[] = [];
  let rejectedLines = 0;

  for (let i = 0; i < rawRows.length; i++) {
    if (hardenedMode && lines.length >= MAX_LRC_LINES) {
      truncatedPayload = true;
      break;
    }

    const row = rawRows[i].trim();
    if (!row) continue;

    // Linear-time bracket check: [mm:ss.xx] or [mm:ss:xx]
    if (!row.startsWith('[') || row.length > 400) {
      rejectedLines++;
      continue;
    }

    const closeIdx = row.indexOf(']');
    if (closeIdx <= 1 || closeIdx > 12) {
      rejectedLines++;
      continue;
    }

    const timeTag = row.slice(1, closeIdx);
    const colonIdx = timeTag.indexOf(':');
    if (colonIdx === -1) {
      // Metadata tag like [ar:Artist] or invalid tag
      rejectedLines++;
      continue;
    }

    const minStr = timeTag.slice(0, colonIdx);
    const secStr = timeTag.slice(colonIdx + 1).replace(':', '.');

    const minutes = Number(minStr);
    const seconds = Number(secStr);

    if (
      !Number.isFinite(minutes) ||
      !Number.isFinite(seconds) ||
      minutes < 0 ||
      minutes > 99 ||
      seconds < 0 ||
      seconds >= 60
    ) {
      rejectedLines++;
      continue;
    }

    const timeMs = Math.round((minutes * 60 + seconds) * 1000);
    const lyricBody = row.slice(closeIdx + 1).trim();

    if (!lyricBody) continue;

    // Optional translation split via " / " or " | "
    const parts = lyricBody.split(' // ');
    const mm = String(Math.floor(minutes)).padStart(2, '0');
    const ss = String(Math.floor(seconds)).padStart(2, '0');

    lines.push({
      timeMs,
      formattedTime: `${mm}:${ss}`,
      text: parts[0].trim(),
      translation: parts[1]?.trim(),
    });
  }

  lines.sort((a, b) => a.timeMs - b.timeMs);

  return {
    lines,
    rejectedLines,
    truncatedPayload,
    executionMode: hardenedMode ? 'LINEAR_O_N_HARDENED' : 'LEGACY_UNBOUNDED',
  };
}

/**
 * Binary-search active lyric line index for current playback time in milliseconds.
 */
export function findActiveLyricIndex(lines: LyricLine[], currentTimeMs: number): number {
  if (!lines.length || currentTimeMs < lines[0].timeMs) {
    return -1;
  }
  let low = 0;
  let high = lines.length - 1;
  let result = 0;

  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].timeMs <= currentTimeMs) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return result;
}

/**
 * 5. Listen Together (Jam Session) Clock Drift & NTP Synchronization Calculator
 * - Drift <= 45ms: In-sync, keep rate at 1.00x
 * - Drift 46ms .. 1500ms: Smooth proportional pitch-preserving rate adjustment (0.96x .. 1.04x)
 * - Drift > 1500ms: Hard seek to host's authoritative timestamp + network RTT/2
 */
export function calculateJamDriftSync(
  hostPositionMs: number,
  clientPositionMs: number,
  networkRttMs: number
): JamSyncAdjustment {
  const oneWayLatencyMs = Math.max(0, Math.round(networkRttMs / 2));
  const authoritativeTargetMs = hostPositionMs + oneWayLatencyMs;
  const driftMs = authoritativeTargetMs - clientPositionMs;
  const absDriftMs = Math.abs(driftMs);

  if (absDriftMs <= 45) {
    return {
      driftMs,
      absDriftMs,
      action: 'IN_SYNC',
      recommendedPlaybackRate: 1.0,
      targetSeekMs: null,
      summary: `Locked within ${absDriftMs}ms tolerance (1.00x nominal rate).`,
    };
  }

  if (absDriftMs <= 1500) {
    // Proportional micro-rate adjustment between 0.96x and 1.04x
    const direction = driftMs > 0 ? 1 : -1;
    const magnitude = Math.min(0.04, Math.max(0.01, Number(((absDriftMs / 1500) * 0.04).toFixed(3))));
    const rate = Number((1.0 + direction * magnitude).toFixed(3));
    return {
      driftMs,
      absDriftMs,
      action: 'MICRO_RATE_ADJUST',
      recommendedPlaybackRate: rate,
      targetSeekMs: null,
      summary: `Drift ${driftMs > 0 ? '+' : ''}${driftMs}ms detected; applying ${rate.toFixed(2)}x soft catch-up rate.`,
    };
  }

  return {
    driftMs,
    absDriftMs,
    action: 'HARD_SEEK',
    recommendedPlaybackRate: 1.0,
    targetSeekMs: authoritativeTargetMs,
    summary: `Drift ${driftMs > 0 ? '+' : ''}${driftMs}ms exceeds 1500ms threshold; executing immediate seek to ${authoritativeTargetMs}ms.`,
  };
}

/**
 * 6. Security Hardening Validators (VULN-02, VULN-03, VULN-05)
 */

const SQLITE3_MAGIC_HEX = '53514c69746520666f726d6174203300'; // "SQLite format 3\0"
const MAX_BACKUP_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB max

export function validateBackupArchive(
  entries: BackupArchiveEntry[],
  hardenedMode: boolean = true
): BackupValidationReport {
  let totalBytes = 0;

  for (const entry of entries) {
    totalBytes += entry.uncompressedBytes;

    if (!hardenedMode) {
      continue;
    }

    // 1. Zip-Slip Path Traversal Check
    const normalized = entry.fileName.replace(/\\/g, '/');
    if (
      normalized.includes('../') ||
      normalized.startsWith('/') ||
      normalized.includes('..') ||
      !['song.db', 'settings.preferences_pb', 'metrolist_meta.json'].includes(normalized)
    ) {
      return {
        valid: false,
        blockedReason: `Rejected path traversal or unauthorized archive entry: "${entry.fileName}"`,
        vulnerabilityTriggered: 'VULN-02 (Zip-Slip Path Traversal)',
        checkedEntries: entries.length,
        totalUncompressedBytes: totalBytes,
      };
    }

    // 2. Zip Bomb Compression Ratio & Max Size Check
    const ratio =
      entry.compressedBytes > 0 ? entry.uncompressedBytes / entry.compressedBytes : 9999;
    if (totalBytes > MAX_BACKUP_UNCOMPRESSED_BYTES || ratio > 100) {
      return {
        valid: false,
        blockedReason: `Archive exceeds 50 MB safety quota or compression ratio limit (ratio ${ratio.toFixed(0)}:1).`,
        vulnerabilityTriggered: 'VULN-02 (Zip-Bomb DoS)',
        checkedEntries: entries.length,
        totalUncompressedBytes: totalBytes,
      };
    }

    // 3. SQLite Header Integrity Verification
    if (
      normalized === 'song.db' &&
      entry.sqliteHeaderHex &&
      entry.sqliteHeaderHex.toLowerCase() !== SQLITE3_MAGIC_HEX
    ) {
      return {
        valid: false,
        blockedReason: `Corrupted or tampered SQLite header in song.db (expected SQLite format 3 magic bytes).`,
        vulnerabilityTriggered: 'VULN-02 (SQLite Binary Injection)',
        checkedEntries: entries.length,
        totalUncompressedBytes: totalBytes,
      };
    }
  }

  return {
    valid: true,
    blockedReason: null,
    vulnerabilityTriggered: null,
    checkedEntries: entries.length,
    totalUncompressedBytes: totalBytes,
  };
}

/**
 * Listen Together Room HMAC-SHA256 & Role Authorization Validator (VULN-03 Mitigation)
 */
export function signJamCommand(
  envelope: Omit<JamCommandEnvelope, 'hmacSignature'>,
  roomSecret: string
): string {
  const canonical = `${envelope.roomId}|${envelope.senderId}|${envelope.senderRole}|${envelope.action}|${envelope.timestampMs}|${envelope.nonce}`;
  return computeDeterministicHashHex(`${canonical}|${roomSecret}`);
}

export function verifyJamCommandAuthorization(
  envelope: JamCommandEnvelope,
  roomSecret: string,
  allowGuestTransportControl: boolean,
  hardenedMode: boolean = true
): { authorized: boolean; reason: string } {
  if (!hardenedMode) {
    return {
      authorized: true,
      reason: 'Legacy mode: unauthenticated WebSocket command accepted without HMAC verification.',
    };
  }

  const expectedSig = signJamCommand(envelope, roomSecret);
  if (envelope.hmacSignature !== expectedSig) {
    return {
      authorized: false,
      reason: 'Blocked: Invalid HMAC-SHA256 room signature (potential room hijacking attempt).',
    };
  }

  if (envelope.senderRole === 'GUEST' && !allowGuestTransportControl) {
    if (['SKIP', 'SEEK', 'PAUSE', 'REORDER_QUEUE'].includes(envelope.action)) {
      return {
        authorized: false,
        reason: `Blocked: Guest "${envelope.senderId}" lacks permission for transport action ${envelope.action} in Host-Locked mode.`,
      };
    }
  }

  return {
    authorized: true,
    reason: 'Verified HMAC-SHA256 room signature and role permissions.',
  };
}

/**
 * Third-Party Lyrics API Query Sanitizer & TLS Enforcer (VULN-05 Mitigation)
 */
export function buildSanitizedLyricsRequest(
  rawEndpointUrl: string,
  trackTitle: string,
  artistName: string,
  leakedQueryParams?: Record<string, string>,
  hardenedMode: boolean = true
): { finalUrl: string; strippedSecrets: string[]; upgradedToHttps: boolean } {
  let url = rawEndpointUrl.trim();
  let upgradedToHttps = false;

  if (hardenedMode && url.startsWith('http://')) {
    url = 'https://' + url.slice('http://'.length);
    upgradedToHttps = true;
  }

  // Strip bracketed personal annotations or tracking IDs from title in O(N) linear time (no regex ReDoS)
  const cleanTitle = hardenedMode
    ? stripBracketedAnnotationsLinear(trackTitle)
    : trackTitle;
  const cleanArtist = hardenedMode ? artistName.trim() : artistName;

  const strippedSecrets: string[] = [];
  const queryParts: string[] = [
    `track_name=${encodeURIComponent(cleanTitle)}`,
    `artist_name=${encodeURIComponent(cleanArtist)}`,
  ];

  if (leakedQueryParams) {
    for (const [key, val] of Object.entries(leakedQueryParams)) {
      const isSensitive = /sapisid|cookie|auth|session|playlist_id|visitor_data/i.test(key);
      if (hardenedMode && isSensitive) {
        strippedSecrets.push(key);
      } else {
        queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(val)}`);
      }
    }
  }

  return {
    finalUrl: `${url}?${queryParts.join('&')}`,
    strippedSecrets,
    upgradedToHttps,
  };
}

/**
 * Format duration milliseconds into tabular `MM:SS` string.
 */
export function formatDurationMs(ms: number): string {
  const safeSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(safeSec / 60);
  const secs = safeSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export interface InnerTubeParsedTrack {
  videoId: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  thumbnailUrl: string;
  playsText?: string;
}

/**
 * Pure parser for YouTube Music InnerTube `WEB_REMIX` search response (`musicResponsiveListItemRenderer`).
 */
export function parseInnerTubeSearchResponse(rawJson: unknown): InnerTubeParsedTrack[] {
  const renderers: Array<Record<string, unknown>> = [];

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    if (rec.musicResponsiveListItemRenderer && typeof rec.musicResponsiveListItemRenderer === 'object') {
      renderers.push(rec.musicResponsiveListItemRenderer as Record<string, unknown>);
      return;
    }
    for (const val of Object.values(rec)) {
      walk(val);
    }
  }

  walk(rawJson);

  const results: InnerTubeParsedTrack[] = [];
  for (const item of renderers) {
    const playlistItemData = item.playlistItemData as { videoId?: string } | undefined;
    const videoId = playlistItemData?.videoId;
    if (!videoId) continue;

    // Extract thumbnail
    const thumbObj = item.thumbnail as {
      musicThumbnailRenderer?: {
        thumbnail?: { thumbnails?: Array<{ url?: string }> };
      };
    } | undefined;
    const thumbs = thumbObj?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    const lastThumb = thumbs[thumbs.length - 1]?.url || '';
    const highResThumb = lastThumb.replace(/=w\d+-h\d+/, '=w400-h400');

    // Extract flexColumns text runs
    const flexCols = (item.flexColumns as Array<{
      musicResponsiveListItemFlexColumnRenderer?: {
        text?: { runs?: Array<{ text?: string }> };
      };
    }>) || [];

    const colStrings = flexCols.map((col) =>
      (col.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [])
        .map((r) => r.text || '')
        .join('')
        .trim()
    );

    const title = colStrings[0] || 'Unknown Title';
    const metaParts = (colStrings[1] || '').split('•').map((s) => s.trim()).filter(Boolean);

    const artist = metaParts[0] || 'YouTube Music Artist';
    let album = metaParts.length >= 3 ? metaParts[1] : `${title} (Single)`;
    const timeStr = metaParts[metaParts.length - 1] || '3:30';

    let durationMs = 210000;
    const timeMatch = timeStr.match(/^(\d+):(\d{2})$/);
    if (timeMatch) {
      durationMs = (Number(timeMatch[1]) * 60 + Number(timeMatch[2])) * 1000;
    } else if (metaParts.length === 2) {
      album = metaParts[1];
    }

    results.push({
      videoId,
      title,
      artist,
      album,
      durationMs,
      thumbnailUrl: highResThumb,
      playsText: colStrings[2] || undefined,
    });
  }

  return results;
}

/**
 * Pure parser for YouTube Music `youtubei/v1/next` (`playlistId: "RDAMVM" + videoId`)
 * algorithmic radio & "Up Next" song recommendations (`playlistPanelVideoRenderer`).
 */
export function parseInnerTubeWatchNextResponse(
  rawJson: unknown,
  excludeVideoId?: string
): InnerTubeParsedTrack[] {
  const renderers: Array<Record<string, unknown>> = [];

  function walk(node: unknown) {
    if (!node || typeof node !== 'object') return;
    const rec = node as Record<string, unknown>;
    if (rec.playlistPanelVideoRenderer && typeof rec.playlistPanelVideoRenderer === 'object') {
      renderers.push(rec.playlistPanelVideoRenderer as Record<string, unknown>);
      return;
    }
    for (const val of Object.values(rec)) {
      walk(val);
    }
  }

  walk(rawJson);

  const seenVideoIds = new Set<string>();
  if (excludeVideoId) {
    seenVideoIds.add(excludeVideoId);
  }

  const results: InnerTubeParsedTrack[] = [];
  for (const item of renderers) {
    const videoId = typeof item.videoId === 'string' ? item.videoId.trim() : '';
    if (!videoId || seenVideoIds.has(videoId)) continue;
    seenVideoIds.add(videoId);

    const titleRuns = (item.title as { runs?: Array<{ text?: string }> } | undefined)?.runs || [];
    const title = titleRuns.map((r) => r.text || '').join('').trim() || 'Unknown Title';

    const shortRuns =
      (item.shortBylineText as { runs?: Array<{ text?: string }> } | undefined)?.runs || [];
    const longRuns =
      (item.longBylineText as { runs?: Array<{ text?: string }> } | undefined)?.runs || [];

    const shortArtist = shortRuns.map((r) => r.text || '').join('').trim();
    const longParts = longRuns
      .map((r) => r.text || '')
      .join('')
      .split('•')
      .map((s) => s.trim())
      .filter(Boolean);

    const artist = shortArtist || longParts[0] || 'YouTube Music Artist';
    const album =
      longParts.length >= 2 && !/views|likes/i.test(longParts[1])
        ? longParts[1]
        : 'YouTube Music Radio';

    const lengthRuns =
      (item.lengthText as { runs?: Array<{ text?: string }> } | undefined)?.runs || [];
    const timeStr = lengthRuns.map((r) => r.text || '').join('').trim() || '3:30';

    let durationMs = 210000;
    const timeMatch = timeStr.match(/^(\d+):(\d{2})$/);
    if (timeMatch) {
      durationMs = (Number(timeMatch[1]) * 60 + Number(timeMatch[2])) * 1000;
    }

    const thumbs =
      (item.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined)?.thumbnails || [];
    const lastThumb = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const highResThumb = lastThumb.replace(/=w\d+-h\d+/, '=w400-h400');

    results.push({
      videoId,
      title,
      artist,
      album,
      durationMs,
      thumbnailUrl: highResThumb,
    });
  }

  return results;
}

function stripBracketedAnnotationsLinear(input: string): string {
  const capped = input.slice(0, 256);
  let out = '';
  let i = 0;
  while (i < capped.length) {
    const ch = capped[i];
    if (ch === '[') {
      const closeIdx = capped.indexOf(']', i + 1);
      if (closeIdx !== -1) {
        i = closeIdx + 1;
        continue;
      }
    } else if (ch === '(') {
      const closeIdx = capped.indexOf(')', i + 1);
      if (closeIdx !== -1) {
        const segment = capped.slice(i + 1, closeIdx).toLowerCase();
        if (segment.includes('token')) {
          i = closeIdx + 1;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return out.trim();
}

/**
 * 9. Production API Input Sanitizer & YouTube VideoID Validator
 * Strips control characters, HTML angle brackets, and enforces strict length bounds
 * in O(N) linear time without regular expressions.
 */
export function sanitizeApiQueryText(raw: unknown, maxLength: number = 120): string {
  if (typeof raw !== 'string') return '';
  const limit = Math.min(raw.length, 512);
  let out = '';
  let prevSpace = true;

  for (let i = 0; i < limit; i++) {
    const code = raw.charCodeAt(i);
    const ch = raw[i];
    const isControlOrBracket =
      code <= 0x1f || code === 0x7f || ch === '<' || ch === '>';
    const isWhitespace =
      isControlOrBracket || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

    if (isWhitespace) {
      if (!prevSpace && out.length < maxLength) {
        out += ' ';
        prevSpace = true;
      }
    } else {
      if (out.length < maxLength) {
        out += ch;
        prevSpace = false;
      }
    }
  }

  return out.trim();
}

export function isValidYouTubeVideoId(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return /^[A-Za-z0-9_-]{11}$/.test(raw.trim());
}


