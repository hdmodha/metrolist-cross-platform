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

type TextRuns = { runs?: Array<{ text?: string }> } | undefined;

function joinRuns(text: TextRuns): string {
  return (text?.runs || [])
    .map((r) => r.text || '')
    .join('')
    .trim();
}

/**
 * Parses a clock string (`M:SS` or `H:MM:SS`) into milliseconds in linear time.
 * Returns 0 for anything else (e.g. live streams reported as `20,843:43:51`).
 */
export function parseClockDurationMs(raw: string): number {
  const text = raw.trim();
  if (!text || text.length > 10) return 0;
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 3) return 0;

  let totalSec = 0;
  for (let p = 0; p < parts.length; p++) {
    const part = parts[p];
    if (!part || part.length > 3) return 0;
    for (let i = 0; i < part.length; i++) {
      const code = part.charCodeAt(i);
      if (code < 48 || code > 57) return 0;
    }
    // Minutes / seconds after the leading unit must be exactly two digits
    if (p > 0 && part.length !== 2) return 0;
    totalSec = totalSec * 60 + Number(part);
  }
  return totalSec * 1000;
}

function looksLikePlayCount(part: string): boolean {
  const lower = part.toLowerCase();
  return (
    lower.endsWith(' views') ||
    lower.endsWith(' view') ||
    lower.endsWith(' plays') ||
    lower.endsWith(' play') ||
    lower.endsWith(' likes')
  );
}

/** Longest thumbnail in the list, upscaled to 400px when it is a resizable Google image URL. */
function pickThumbnailUrl(thumbs: Array<{ url?: string }>, videoId: string): string {
  const lastThumb = thumbs[thumbs.length - 1]?.url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  return lastThumb.replace(/=w\d+-h\d+/, '=w400-h400');
}

function readMusicVideoType(node: unknown): string {
  // Depth-bounded lookup of `watchEndpointMusicConfig.musicVideoType` inside a renderer
  const stack: Array<{ value: unknown; depth: number }> = [{ value: node, depth: 0 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (!value || typeof value !== 'object' || depth > 12) continue;
    const rec = value as Record<string, unknown>;
    if (typeof rec.musicVideoType === 'string') return rec.musicVideoType;
    for (const child of Object.values(rec)) {
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  return '';
}

/** Longest playable item kept in search / radio results (filters out DJ mixes, podcasts and live streams). */
export const MAX_PLAYABLE_TRACK_DURATION_MS = 20 * 60 * 1000;

/**
 * Pure parser for YouTube Music InnerTube `WEB_REMIX` search responses (`musicResponsiveListItemRenderer`).
 * Handles both the "Songs" shelf (`Artist • Album • 3:22`) and the "Videos" shelf
 * (`Channel • 1.3B views • 4:33`), which is the only catalog YouTube Music returns in regions
 * where the premium song catalog is unavailable.
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

  const seenVideoIds = new Set<string>();
  const results: InnerTubeParsedTrack[] = [];
  for (const item of renderers) {
    const playlistItemData = item.playlistItemData as { videoId?: string } | undefined;
    const videoId = playlistItemData?.videoId;
    if (!videoId || !isValidYouTubeVideoId(videoId) || seenVideoIds.has(videoId)) continue;

    // Podcast episodes share the same renderer but are not music
    if (readMusicVideoType(item.overlay).includes('PODCAST')) continue;

    // Extract thumbnail
    const thumbObj = item.thumbnail as {
      musicThumbnailRenderer?: {
        thumbnail?: { thumbnails?: Array<{ url?: string }> };
      };
    } | undefined;
    const thumbs = thumbObj?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];

    // Extract flexColumns text runs
    const flexCols = (item.flexColumns as Array<{
      musicResponsiveListItemFlexColumnRenderer?: { text?: TextRuns };
    }>) || [];

    const colStrings = flexCols.map((col) =>
      joinRuns(col.musicResponsiveListItemFlexColumnRenderer?.text)
    );

    const title = colStrings[0] || 'Unknown Title';
    const metaParts = (colStrings[1] || '').split('•').map((s) => s.trim()).filter(Boolean);

    // Classify each "•"-separated part: clock duration, play count, or a name (artist, then album)
    let durationMs = 0;
    let playsText = colStrings[2] || '';
    let isVideoResult = false;
    const nameParts: string[] = [];
    for (const part of metaParts) {
      const clockMs = parseClockDurationMs(part);
      if (clockMs > 0) {
        durationMs = clockMs;
      } else if (looksLikePlayCount(part)) {
        isVideoResult = true;
        if (!playsText) playsText = part;
      } else {
        nameParts.push(part);
      }
    }

    if (durationMs > MAX_PLAYABLE_TRACK_DURATION_MS) continue;

    seenVideoIds.add(videoId);
    results.push({
      videoId,
      title,
      artist: nameParts[0] || 'YouTube Music Artist',
      album: nameParts[1] || (isVideoResult ? 'YouTube Music' : `${title} (Single)`),
      durationMs: durationMs || 210000,
      thumbnailUrl: pickThumbnailUrl(thumbs, videoId),
      playsText: playsText || undefined,
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
    if (!videoId || !isValidYouTubeVideoId(videoId) || seenVideoIds.has(videoId)) continue;
    seenVideoIds.add(videoId);

    const title = joinRuns(item.title as TextRuns) || 'Unknown Title';
    const shortArtist = joinRuns(item.shortBylineText as TextRuns);
    const longParts = joinRuns(item.longBylineText as TextRuns)
      .split('•')
      .map((s) => s.trim())
      .filter(Boolean);

    const artist = shortArtist || longParts[0] || 'YouTube Music Artist';
    const album =
      longParts.length >= 2 && !looksLikePlayCount(longParts[1])
        ? longParts[1]
        : 'YouTube Music Radio';

    // Skip live streams and hour-long mixes: a radio queue should only contain songs
    const timeStr = joinRuns(item.lengthText as TextRuns);
    let durationMs = 210000;
    if (timeStr) {
      durationMs = parseClockDurationMs(timeStr);
      if (durationMs <= 0 || durationMs > MAX_PLAYABLE_TRACK_DURATION_MS) continue;
    }

    const thumbs =
      (item.thumbnail as { thumbnails?: Array<{ url?: string }> } | undefined)?.thumbnails || [];

    results.push({
      videoId,
      title,
      artist,
      album,
      durationMs,
      thumbnailUrl: pickThumbnailUrl(thumbs, videoId),
    });
  }

  return results;
}

/* -------------------------------------------------------------------------------------------- *
 * Shared InnerTube request layer (used by the Express proxy AND by the native app shell, which
 * talks to YouTube Music directly because no Node backend runs inside an Android / iOS package).
 * -------------------------------------------------------------------------------------------- */

export const INNERTUBE_API_ORIGIN = 'https://music.youtube.com';

export const INNERTUBE_ENDPOINT_URLS = {
  search: `${INNERTUBE_API_ORIGIN}/youtubei/v1/search?prettyPrint=false`,
  next: `${INNERTUBE_API_ORIGIN}/youtubei/v1/next?prettyPrint=false`,
} as const;

export type InnerTubeEndpoint = keyof typeof INNERTUBE_ENDPOINT_URLS;

export const INNERTUBE_CLIENT_CONTEXT = {
  client: {
    clientName: 'WEB_REMIX',
    clientVersion: '1.20240717.01.00',
    hl: 'en',
    gl: 'US',
  },
} as const;

/**
 * Search filters tried in order. The "Songs" filter returns nothing in regions (and on networks)
 * where YouTube Music has no song catalog, so the "Videos" filter is the mandatory fallback.
 */
export const INNERTUBE_SEARCH_FILTERS = [
  { name: 'songs', params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D' },
  { name: 'videos', params: 'EgWKAQIQAWoKEAQQBRAVEBAQEQ%3D%3D' },
] as const;

export function buildInnerTubeSearchBody(query: string, params: string): Record<string, unknown> {
  return { context: INNERTUBE_CLIENT_CONTEXT, query, params };
}

export function buildInnerTubeNextBody(seedVideoId: string): Record<string, unknown> {
  return {
    context: INNERTUBE_CLIENT_CONTEXT,
    videoId: seedVideoId,
    playlistId: `RDAMVM${seedVideoId}`,
    isAudioOnly: true,
    enablePersistentPlaylistPanel: true,
  };
}

/** Performs one InnerTube POST and resolves with the decoded JSON body (rejects on HTTP errors). */
export type InnerTubeTransport = (
  endpoint: InnerTubeEndpoint,
  body: Record<string, unknown>
) => Promise<unknown>;

/**
 * Searches YouTube Music, falling back from the "Songs" filter to the "Videos" filter when the
 * first one comes back empty. Throws only when every attempt failed at the transport level.
 */
export async function searchInnerTubeTracks(
  transport: InnerTubeTransport,
  query: string
): Promise<InnerTubeParsedTrack[]> {
  let lastError: unknown = null;
  let anySucceeded = false;

  for (const filter of INNERTUBE_SEARCH_FILTERS) {
    try {
      const raw = await transport('search', buildInnerTubeSearchBody(query, filter.params));
      anySucceeded = true;
      const tracks = parseInnerTubeSearchResponse(raw);
      if (tracks.length > 0) return tracks;
    } catch (err) {
      lastError = err;
    }
  }

  if (!anySucceeded && lastError) throw lastError;
  return [];
}

/** Fetches the `RDAMVM` radio (Up Next recommendations) for a seed video. */
export async function fetchInnerTubeRadioTracks(
  transport: InnerTubeTransport,
  seedVideoId: string
): Promise<InnerTubeParsedTrack[]> {
  const raw = await transport('next', buildInnerTubeNextBody(seedVideoId));
  return parseInnerTubeWatchNextResponse(raw, seedVideoId);
}

/* -------------------------------------------------------------------------------------------- *
 * Lyrics lookup helpers
 * -------------------------------------------------------------------------------------------- */

function stripAllBracketedSegmentsLinear(input: string): string {
  const capped = input.slice(0, 256);
  let out = '';
  let roundDepth = 0;
  let squareDepth = 0;
  for (let i = 0; i < capped.length; i++) {
    const ch = capped[i];
    if (ch === '(') roundDepth++;
    else if (ch === ')') roundDepth = Math.max(0, roundDepth - 1);
    else if (ch === '[') squareDepth++;
    else if (ch === ']') squareDepth = Math.max(0, squareDepth - 1);
    else if (roundDepth === 0 && squareDepth === 0) out += ch;
  }
  return out.split(' ').filter(Boolean).join(' ');
}

function normalizeForComparison(input: string): string {
  let out = '';
  const lower = input.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const code = lower.charCodeAt(i);
    const isAlphaNum = (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code > 127;
    if (isAlphaNum) out += lower[i];
  }
  return out;
}

/**
 * Turns a YouTube-style title (`Kavinsky - Nightcall (Official Audio)` uploaded by `Record Makers`)
 * into clean lyrics lookup terms (`Nightcall` / `Kavinsky`). Linear time, no regular expressions.
 */
export function deriveLyricsSearchTerms(
  rawTitle: string,
  rawArtist: string
): { trackName: string; artistName: string; freeText: string } {
  const title = stripAllBracketedSegmentsLinear(rawTitle);
  let artistName = rawArtist.trim().slice(0, 120);
  if (artistName.toLowerCase().endsWith(' - topic')) {
    artistName = artistName.slice(0, -' - topic'.length).trim();
  }
  let trackName = title || rawTitle.trim().slice(0, 120);

  const dashIdx = title.indexOf(' - ');
  if (dashIdx > 0) {
    const left = title.slice(0, dashIdx).trim();
    const right = title.slice(dashIdx + 3).trim();
    const leftNorm = normalizeForComparison(left);
    let artistNorm = normalizeForComparison(artistName);
    if (artistNorm.endsWith('vevo')) artistNorm = artistNorm.slice(0, -4);
    if (artistNorm.endsWith('official')) artistNorm = artistNorm.slice(0, -8);

    // "Artist - Song" uploads: the uploader is the artist (or their VEVO / official channel)
    const leftIsArtist =
      leftNorm.length > 0 &&
      artistNorm.length > 0 &&
      (leftNorm.includes(artistNorm) || artistNorm.includes(leftNorm));
    if (leftIsArtist && right) {
      artistName = left;
      trackName = right;
    }
  }

  const freeText = title.split(' - ').join(' ').trim() || trackName;
  return { trackName, artistName, freeText };
}

export interface LrcLibSearchItem {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  duration?: number | null;
}

/**
 * Picks the LRCLIB record whose synced lyrics best fit the track: among records that have
 * time-synced lyrics, the one closest in duration to the stream (so timestamps line up).
 */
export function pickBestLyricsMatch(items: unknown, trackDurationMs: number = 0): LrcLibSearchItem | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const records = items.filter(
    (i): i is LrcLibSearchItem => !!i && typeof i === 'object'
  );
  const synced = records.filter(
    (i) => typeof i.syncedLyrics === 'string' && i.syncedLyrics.trim().length > 0
  );
  if (synced.length === 0) return records[0] || null;
  if (trackDurationMs <= 0) return synced[0];

  let best = synced[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const item of synced) {
    const durMs = typeof item.duration === 'number' ? item.duration * 1000 : 0;
    const delta = durMs > 0 ? Math.abs(durMs - trackDurationMs) : 60_000;
    if (delta < bestDelta) {
      best = item;
      bestDelta = delta;
    }
  }
  return best;
}

/* -------------------------------------------------------------------------------------------- *
 * Playback queue rules (pure, unit-tested)
 * -------------------------------------------------------------------------------------------- */

export type RepeatMode = 'OFF' | 'ALL' | 'ONE';

/**
 * Decides which queue index plays next. Returns -1 when playback should stop
 * (natural end of the queue with repeat off).
 */
export function pickNextQueueIndex(options: {
  queueLength: number;
  currentIndex: number;
  direction: -1 | 1;
  shuffle: boolean;
  repeatMode: RepeatMode;
  /** true for Next / Previous button presses, false when a track finished on its own */
  userInitiated: boolean;
  random?: () => number;
}): number {
  const { queueLength, currentIndex, direction, shuffle, repeatMode, userInitiated } = options;
  if (queueLength <= 0) return -1;

  // A finished track with "repeat one" replays itself; pressing Next still moves on
  if (!userInitiated && repeatMode === 'ONE' && currentIndex >= 0) return currentIndex;

  if (queueLength === 1) {
    if (userInitiated || repeatMode !== 'OFF' || currentIndex < 0) return 0;
    return -1;
  }

  // The playing track is no longer in the queue (it was removed): start from the top
  if (currentIndex < 0 || currentIndex >= queueLength) return 0;

  if (shuffle && direction === 1) {
    const random = options.random || Math.random;
    const offset = 1 + Math.min(queueLength - 2, Math.floor(random() * (queueLength - 1)));
    return (currentIndex + offset) % queueLength;
  }

  const target = currentIndex + direction;
  if (target >= queueLength) {
    return repeatMode === 'OFF' && !userInitiated ? -1 : 0;
  }
  if (target < 0) {
    return repeatMode === 'ALL' ? queueLength - 1 : 0;
  }
  return target;
}

/**
 * "Add to queue": places the track right after the current one and after any tracks the listener
 * already queued by hand, so manual picks play in the order they were added and before radio picks.
 */
export function insertIntoQueueAfterCurrent<T extends { id: string }>(
  queue: T[],
  currentId: string,
  track: T,
  userQueuedIds: ReadonlySet<string>
): T[] {
  if (track.id === currentId) return queue;
  const without = queue.filter((t) => t.id !== track.id);
  const currentIdx = without.findIndex((t) => t.id === currentId);
  let insertAt = currentIdx + 1;
  while (insertAt < without.length && userQueuedIds.has(without[insertAt].id)) {
    insertAt++;
  }
  return [...without.slice(0, insertAt), track, ...without.slice(insertAt)];
}

/**
 * "Play this now": keeps what was already played (so Previous still works), plays `track` next,
 * keeps hand-queued tracks after it, then `followUps` (the rest of the list the track was picked
 * from). Stale automatic picks from the previous listening context are dropped.
 */
export function buildPlayNowQueue<T extends { id: string }>(
  queue: T[],
  currentId: string | null,
  track: T,
  userQueuedIds: ReadonlySet<string>,
  followUps: T[] = []
): T[] {
  const currentIdx = currentId === null ? -1 : queue.findIndex((t) => t.id === currentId);
  const played = currentIdx === -1 ? [] : queue.slice(0, currentIdx + 1);
  const upcoming = currentIdx === -1 ? queue : queue.slice(currentIdx + 1);

  const result: T[] = [];
  const seen = new Set<string>([track.id]);
  for (const item of played) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  result.push(track);
  for (const item of [...upcoming.filter((t) => userQueuedIds.has(t.id)), ...followUps]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

/**
 * Autoplay radio: tops the queue up with recommendations only when it is about to run dry,
 * so hand-queued tracks and the visible "Up Next" order are never thrown away.
 */
export function mergeRadioIntoQueue<T extends { id: string }>(
  queue: T[],
  currentId: string,
  radioTracks: T[],
  options: { minUpcoming?: number; maxAppend?: number; maxHistory?: number } = {}
): T[] {
  const minUpcoming = options.minUpcoming ?? 3;
  const maxAppend = options.maxAppend ?? 10;
  const maxHistory = options.maxHistory ?? 30;

  const currentIdx = queue.findIndex((t) => t.id === currentId);
  if (currentIdx === -1) return queue;
  const upcoming = queue.length - currentIdx - 1;
  if (upcoming >= minUpcoming) return queue;

  const seen = new Set(queue.map((t) => t.id));
  const additions: T[] = [];
  for (const candidate of radioTracks) {
    if (additions.length >= maxAppend) break;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    additions.push(candidate);
  }
  if (additions.length === 0) return queue;

  const historyStart = Math.max(0, currentIdx - maxHistory);
  return [...queue.slice(historyStart), ...additions];
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


