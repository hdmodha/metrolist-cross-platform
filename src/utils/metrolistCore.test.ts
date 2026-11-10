import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSapisidHash,
  decipherInnerTubeSignature,
  resolveOptimalAudioStream,
  parseSyncedLrc,
  findActiveLyricIndex,
  calculateJamDriftSync,
  validateBackupArchive,
  signJamCommand,
  verifyJamCommandAuthorization,
  buildSanitizedLyricsRequest,
  formatDurationMs,
  type StreamFormatCandidate,
} from './metrolistCore';

test('InnerTube SAPISIDHASH generates deterministic token and rejects insecure origins', () => {
  const valid = generateSapisidHash('3PAPISID_LIVE_COOKIE_998123', 'https://music.youtube.com', 1762748000);
  assert.equal(valid.isValidInput, true);
  assert.ok(valid.headerValue.startsWith('SAPISIDHASH 1762748000_'));
  assert.equal(valid.digestHex.length, 40);

  const insecureOrigin = generateSapisidHash('3PAPISID_LIVE_COOKIE_998123', 'http://music.youtube.com', 1762748000);
  assert.equal(insecureOrigin.isValidInput, false);
});

test('InnerTube stream resolver picks AAC (itag 140) on iOS/macOS AVPlayer and Opus (itag 251) on Windows/Android', () => {
  const candidates: StreamFormatCandidate[] = [
    {
      itag: 251,
      mimeType: 'audio/webm; codecs="opus"',
      codec: 'opus',
      container: 'webm',
      bitrateKbps: 160,
      sampleRateHz: 48000,
      channels: 2,
      signatureCipher: 'AABBCDEFGHIJKLMN',
    },
    {
      itag: 140,
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      codec: 'aac',
      container: 'mp4',
      bitrateKbps: 128,
      sampleRateHz: 44100,
      channels: 2,
      signatureCipher: 'AABBCDEFGHIJKLMN',
    },
  ];

  const iosStream = resolveOptimalAudioStream('ios', candidates);
  assert.equal(iosStream.selectedItag, 140);
  assert.equal(iosStream.codec, 'aac');
  assert.ok(iosStream.nativeEngine.includes('AVQueuePlayer'));

  const macosStream = resolveOptimalAudioStream('macos', candidates);
  assert.equal(macosStream.selectedItag, 140);
  assert.equal(macosStream.container, 'mp4');

  const winStream = resolveOptimalAudioStream('windows', candidates);
  assert.equal(winStream.selectedItag, 251);
  assert.equal(winStream.codec, 'opus');
  assert.ok(winStream.nativeEngine.includes('libmpv'));
});

test('Sandboxed InnerTube signature cipher deobfuscates deterministically without eval', () => {
  const res = decipherInnerTubeSignature('XX9876543210', [
    { op: 'slice', arg: 2 },
    { op: 'reverse', arg: 0 },
  ]);
  assert.equal(res.safeAstExecution, true);
  assert.equal(res.signature, '0123456789');
});

test('Hardened O(N) LRC parser parses synced timestamps, sorts lines, and rejects malformed lines', () => {
  const sampleLrc = [
    '[00:12.50] Neon reflections on glass // ガラスのネオン反射',
    '[00:04.00] Static in the midnight air',
    '[invalid:tag] Should be rejected cleanly',
    '[999:99.99] Out of range timestamp',
    '[00:24.10] Signals crossing the ocean',
  ].join('\n');

  const parsed = parseSyncedLrc(sampleLrc, true);
  assert.equal(parsed.lines.length, 3);
  assert.equal(parsed.rejectedLines, 2);
  assert.equal(parsed.lines[0].timeMs, 4000);
  assert.equal(parsed.lines[1].timeMs, 12500);
  assert.equal(parsed.lines[1].translation, 'ガラスのネオン反射');

  assert.equal(findActiveLyricIndex(parsed.lines, 2000), -1);
  assert.equal(findActiveLyricIndex(parsed.lines, 5000), 0);
  assert.equal(findActiveLyricIndex(parsed.lines, 15000), 1);
  assert.equal(findActiveLyricIndex(parsed.lines, 30000), 2);
});

test('Listen Together Jam drift calculator computes IN_SYNC, MICRO_RATE_ADJUST, and HARD_SEEK accurately', () => {
  const inSync = calculateJamDriftSync(60000, 60030, 40); // target 60020, drift -10ms
  assert.equal(inSync.action, 'IN_SYNC');
  assert.equal(inSync.recommendedPlaybackRate, 1.0);

  const softCatchUp = calculateJamDriftSync(60000, 59400, 100); // target 60050, drift +650ms
  assert.equal(softCatchUp.action, 'MICRO_RATE_ADJUST');
  assert.ok(softCatchUp.recommendedPlaybackRate > 1.0);

  const hardSeek = calculateJamDriftSync(60000, 57000, 80); // target 60040, drift +3040ms
  assert.equal(hardSeek.action, 'HARD_SEEK');
  assert.equal(hardSeek.targetSeekMs, 60040);
});

test('Security Hardening Validators block Zip-Slip traversal, unsigned Jam commands, and HTTP cookie leaks', () => {
  // 1. Zip-Slip Backup Validator
  const maliciousBackup = validateBackupArchive(
    [
      {
        fileName: '../../data/data/com.metrolist.music/databases/song.db',
        compressedBytes: 1024,
        uncompressedBytes: 4096,
      },
    ],
    true
  );
  assert.equal(maliciousBackup.valid, false);
  assert.equal(maliciousBackup.vulnerabilityTriggered, 'VULN-02 (Zip-Slip Path Traversal)');

  // 2. Jam Command HMAC & Host Role Check
  const secret = 'ROOM_KEY_991';
  const validGuestPlay = {
    roomId: 'METRO-88A',
    senderId: 'peer-win11',
    senderRole: 'GUEST' as const,
    action: 'SKIP' as const,
    timestampMs: 1700000000,
    nonce: 'n1',
  };
  const sig = signJamCommand(validGuestPlay, secret);
  const blockedGuestSkip = verifyJamCommandAuthorization(
    { ...validGuestPlay, hmacSignature: sig },
    secret,
    false,
    true
  );
  assert.equal(blockedGuestSkip.authorized, false);

  // 3. Lyrics Query Sanitizer
  const sanitized = buildSanitizedLyricsRequest(
    'http://lyrics.kugou.com/search',
    'Night Prism [token=secret]',
    'Obsidian Sound',
    { sapisid: 'LEAKED_COOKIE_123', duration: '218' },
    true
  );
  assert.equal(sanitized.upgradedToHttps, true);
  assert.ok(sanitized.finalUrl.startsWith('https://'));
  assert.deepEqual(sanitized.strippedSecrets, ['sapisid']);
  assert.equal(formatDurationMs(218000), '03:38');
});

test('InnerTube WEB_REMIX search parser extracts videoId, title, artist, album, and durationMs', async () => {
  const { parseInnerTubeSearchResponse } = await import('./metrolistCore');
  const mockInnerTubeTree = {
    contents: {
      sectionListRenderer: {
        contents: [
          {
            musicShelfRenderer: {
              contents: [
                {
                  musicResponsiveListItemRenderer: {
                    playlistItemData: { videoId: 'J7p4bzqLvCw' },
                    thumbnail: {
                      musicThumbnailRenderer: {
                        thumbnail: {
                          thumbnails: [{ url: 'https://yt3.googleusercontent.com/abc=w120-h120-l90-rj' }],
                        },
                      },
                    },
                    flexColumns: [
                      {
                        musicResponsiveListItemFlexColumnRenderer: {
                          text: { runs: [{ text: 'Blinding Lights' }] },
                        },
                      },
                      {
                        musicResponsiveListItemFlexColumnRenderer: {
                          text: { runs: [{ text: 'The Weeknd • After Hours • 3:22' }] },
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  };

  const tracks = parseInnerTubeSearchResponse(mockInnerTubeTree);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].videoId, 'J7p4bzqLvCw');
  assert.equal(tracks[0].title, 'Blinding Lights');
  assert.equal(tracks[0].artist, 'The Weeknd');
  assert.equal(tracks[0].album, 'After Hours');
  assert.equal(tracks[0].durationMs, 202000);
  assert.ok(tracks[0].thumbnailUrl.includes('=w400-h400'));
});

test('InnerTube RDAMVM WatchNext recommendation parser extracts YouTube Music Up Next recommendations', async () => {
  const { parseInnerTubeWatchNextResponse } = await import('./metrolistCore');
  const mockWatchNextTree = {
    contents: {
      singleColumnMusicWatchNextResultsRenderer: {
        playlistPanelRenderer: {
          contents: [
            {
              playlistPanelVideoRenderer: {
                videoId: 'a5uQMwRMHcs',
                title: { runs: [{ text: 'Instant Crush' }] },
                shortBylineText: { runs: [{ text: 'Daft Punk' }] },
                lengthText: { runs: [{ text: '5:38' }] },
              },
            },
            {
              playlistPanelVideoRenderer: {
                videoId: 'qFLhGq0060w',
                title: { runs: [{ text: 'I Feel It Coming ft. Daft Punk' }] },
                shortBylineText: { runs: [{ text: 'The Weeknd' }] },
                longBylineText: { runs: [{ text: 'The Weeknd • Starboy • 1.4B views' }] },
                lengthText: { runs: [{ text: '4:58' }] },
              },
            },
          ],
        },
      },
    },
  };

  const recommendations = parseInnerTubeWatchNextResponse(mockWatchNextTree, 'a5uQMwRMHcs');
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].videoId, 'qFLhGq0060w');
  assert.equal(recommendations[0].title, 'I Feel It Coming ft. Daft Punk');
  assert.equal(recommendations[0].artist, 'The Weeknd');
  assert.equal(recommendations[0].album, 'Starboy');
  assert.equal(recommendations[0].durationMs, 298000);
});

test('Production API input sanitizer strips control chars, angle brackets, and validates 11-char YouTube videoIds', async () => {
  const { sanitizeApiQueryText, isValidYouTubeVideoId } = await import('./metrolistCore');
  const dirtyQuery = '  Daft\u0000Punk <script>alert(1)</script>   Instant   Crush  ';
  const cleaned = sanitizeApiQueryText(dirtyQuery, 40);
  assert.equal(cleaned.includes('<'), false);
  assert.equal(cleaned.includes('\u0000'), false);
  assert.ok(cleaned.length <= 40);

  assert.equal(isValidYouTubeVideoId('a5uQMwRMHcs'), true);
  assert.equal(isValidYouTubeVideoId('invalid_id_too_long'), false);
  assert.equal(isValidYouTubeVideoId('../../../etc'), false);
});


