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



test('Clock duration parser handles M:SS and H:MM:SS and rejects live-stream / malformed values', async () => {
  const { parseClockDurationMs } = await import('./metrolistCore');
  assert.equal(parseClockDurationMs('3:22'), 202000);
  assert.equal(parseClockDurationMs('1:02:03'), 3723000);
  assert.equal(parseClockDurationMs('20,843:43:51'), 0);
  assert.equal(parseClockDurationMs('1.3B views'), 0);
  assert.equal(parseClockDurationMs('3:2'), 0);
  assert.equal(parseClockDurationMs(''), 0);
});

function videoShelfItem(videoId: string, title: string, meta: string, musicVideoType = 'MUSIC_VIDEO_TYPE_UGC') {
  return {
    musicResponsiveListItemRenderer: {
      playlistItemData: { videoId },
      overlay: {
        musicItemThumbnailOverlayRenderer: {
          content: {
            musicPlayButtonRenderer: {
              playNavigationEndpoint: {
                watchEndpoint: {
                  videoId,
                  watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType } },
                },
              },
            },
          },
        },
      },
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: meta }] } } },
      ],
    },
  };
}

test('InnerTube search parser understands the "Videos" shelf and drops podcasts, duplicates and long mixes', async () => {
  const { parseInnerTubeSearchResponse } = await import('./metrolistCore');
  const tree = {
    contents: [
      videoShelfItem('yKNxeF4KMsY', 'Yellow', 'Coldplay • 1.3B views • 4:33'),
      videoShelfItem('yKNxeF4KMsY', 'Yellow (duplicate)', 'Coldplay • 1.3B views • 4:33'),
      videoShelfItem('rYBVWb1jjpA', 'Some podcast', 'Host • 12K views • 9:10', 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE'),
      videoShelfItem('aaaaaaaaaaa', 'Two hour mix', 'DJ • 2M views • 2:00:00'),
      videoShelfItem('not-a-valid-video-id', 'Bad id', 'Nobody • 1 view • 1:00'),
    ],
  };
  const tracks = parseInnerTubeSearchResponse(tree);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].title, 'Yellow');
  assert.equal(tracks[0].artist, 'Coldplay');
  assert.equal(tracks[0].durationMs, 273000);
  assert.equal(tracks[0].playsText, '1.3B views');
  // A view count must never be mistaken for the album name
  assert.equal(tracks[0].album.includes('views'), false);
  assert.ok(tracks[0].thumbnailUrl.includes('yKNxeF4KMsY'));
});

test('WatchNext parser skips live streams and over-long mixes in radio recommendations', async () => {
  const { parseInnerTubeWatchNextResponse } = await import('./metrolistCore');
  const item = (videoId: string, length: string) => ({
    playlistPanelVideoRenderer: {
      videoId,
      title: { runs: [{ text: `Track ${videoId}` }] },
      shortBylineText: { runs: [{ text: 'Artist' }] },
      longBylineText: { runs: [{ text: 'Artist • 5M views • 190K likes' }] },
      lengthText: { runs: [{ text: length }] },
    },
  });
  const recs = parseInnerTubeWatchNextResponse({
    contents: [item('5qap5aO4i9A', '20,843:43:51'), item('bbbbbbbbbbb', '1:30:00'), item('ccccccccccc', '3:34')],
  });
  assert.deepEqual(recs.map((r) => r.videoId), ['ccccccccccc']);
  assert.equal(recs[0].album, 'YouTube Music Radio');
});

test('Search falls back from the Songs filter to the Videos filter when Songs returns nothing', async () => {
  const { searchInnerTubeTracks, INNERTUBE_SEARCH_FILTERS } = await import('./metrolistCore');
  const seenParams: string[] = [];
  const transport = async (_endpoint: string, body: Record<string, unknown>) => {
    seenParams.push(String(body.params));
    if (body.params === INNERTUBE_SEARCH_FILTERS[0].params) {
      // What YouTube Music answers where the song catalog is unavailable
      return { contents: { messageRenderer: { text: { runs: [{ text: 'No results' }] } } } };
    }
    return { contents: [videoShelfItem('yKNxeF4KMsY', 'Yellow', 'Coldplay • 1.3B views • 4:33')] };
  };
  const tracks = await searchInnerTubeTracks(transport, 'coldplay yellow');
  assert.equal(tracks.length, 1);
  assert.deepEqual(seenParams, INNERTUBE_SEARCH_FILTERS.map((f) => f.params));

  // Transport failures on every attempt surface as an error (so the UI can offer Retry) ...
  await assert.rejects(
    searchInnerTubeTracks(async () => {
      throw new Error('offline');
    }, 'x')
  );
  // ... while a clean "nothing found" resolves to an empty list
  assert.deepEqual(await searchInnerTubeTracks(async () => ({}), 'x'), []);
});

test('Lyrics lookup terms are derived from YouTube-style video titles', async () => {
  const { deriveLyricsSearchTerms, pickBestLyricsMatch } = await import('./metrolistCore');
  const vevo = deriveLyricsSearchTerms(
    'Daft Punk - Instant Crush (Official Video) ft. Julian Casablancas',
    'DaftPunkVEVO'
  );
  assert.equal(vevo.artistName, 'Daft Punk');
  assert.equal(vevo.trackName, 'Instant Crush ft. Julian Casablancas');

  // A song whose own title contains " - " must not be split when the left part is not the artist
  const remaster = deriveLyricsSearchTerms('Bohemian Rhapsody - Remastered 2011', 'Queen');
  assert.equal(remaster.artistName, 'Queen');
  assert.equal(remaster.trackName, 'Bohemian Rhapsody - Remastered 2011');

  const thirdParty = deriveLyricsSearchTerms(
    'Radiohead - Everything In Its Right Place [HD]',
    'Newfound Recordings'
  );
  assert.equal(thirdParty.freeText, 'Radiohead Everything In Its Right Place');

  const best = pickBestLyricsMatch(
    [
      { syncedLyrics: null, plainLyrics: 'plain only', duration: 252 },
      { syncedLyrics: '[00:01.00] live version', duration: 664 },
      { syncedLyrics: '[00:01.00] album version', duration: 252 },
    ],
    251000
  );
  assert.equal(best?.syncedLyrics, '[00:01.00] album version');
  assert.equal(pickBestLyricsMatch([], 1000), null);
});

test('Queue rules: next / previous, repeat modes, shuffle and end of queue', async () => {
  const { pickNextQueueIndex } = await import('./metrolistCore');
  const base = { queueLength: 4, shuffle: false, repeatMode: 'OFF' as const };

  // Natural end of a song
  assert.equal(pickNextQueueIndex({ ...base, currentIndex: 1, direction: 1, userInitiated: false }), 2);
  assert.equal(pickNextQueueIndex({ ...base, currentIndex: 3, direction: 1, userInitiated: false }), -1);
  assert.equal(
    pickNextQueueIndex({ ...base, repeatMode: 'ALL', currentIndex: 3, direction: 1, userInitiated: false }),
    0
  );
  assert.equal(
    pickNextQueueIndex({ ...base, repeatMode: 'ONE', currentIndex: 2, direction: 1, userInitiated: false }),
    2
  );

  // Pressing Next always moves on, even with repeat-one
  assert.equal(
    pickNextQueueIndex({ ...base, repeatMode: 'ONE', currentIndex: 2, direction: 1, userInitiated: true }),
    3
  );
  assert.equal(pickNextQueueIndex({ ...base, currentIndex: 0, direction: -1, userInitiated: true }), 0);
  assert.equal(
    pickNextQueueIndex({ ...base, repeatMode: 'ALL', currentIndex: 0, direction: -1, userInitiated: true }),
    3
  );

  // Shuffle never picks the song that is already playing (the old code could, with 2 songs)
  for (const queueLength of [2, 3, 7]) {
    for (const r of [0, 0.25, 0.5, 0.999]) {
      const idx = pickNextQueueIndex({
        queueLength,
        currentIndex: 1,
        direction: 1,
        shuffle: true,
        repeatMode: 'OFF',
        userInitiated: true,
        random: () => r,
      });
      assert.notEqual(idx, 1);
      assert.ok(idx >= 0 && idx < queueLength);
    }
  }

  // The playing song was removed from the queue / empty queue
  assert.equal(pickNextQueueIndex({ ...base, currentIndex: -1, direction: 1, userInitiated: false }), 0);
  assert.equal(
    pickNextQueueIndex({ ...base, queueLength: 0, currentIndex: -1, direction: 1, userInitiated: true }),
    -1
  );
  assert.equal(
    pickNextQueueIndex({ ...base, queueLength: 1, currentIndex: 0, direction: 1, userInitiated: false }),
    -1
  );
});

test('Queue rules: add-to-queue order, play-now context and radio top-up keep hand-queued songs', async () => {
  const { insertIntoQueueAfterCurrent, buildPlayNowQueue, mergeRadioIntoQueue } = await import(
    './metrolistCore'
  );
  const t = (id: string) => ({ id });
  const ids = (list: Array<{ id: string }>) => list.map((x) => x.id).join(',');

  // Manual picks play right after the current song, in the order they were added, before radio picks
  let queue = [t('now'), t('radio1'), t('radio2')];
  const manual = new Set<string>();
  queue = insertIntoQueueAfterCurrent(queue, 'now', t('a'), manual);
  manual.add('a');
  queue = insertIntoQueueAfterCurrent(queue, 'now', t('b'), manual);
  manual.add('b');
  assert.equal(ids(queue), 'now,a,b,radio1,radio2');
  // Queueing a song that is already further down moves it up instead of duplicating it
  queue = insertIntoQueueAfterCurrent(queue, 'now', t('radio2'), manual);
  assert.equal(ids(queue), 'now,a,b,radio2,radio1');
  assert.equal(insertIntoQueueAfterCurrent(queue, 'now', t('now'), manual), queue);

  // Playing a new song keeps history + manual picks and drops stale automatic picks
  const playNow = buildPlayNowQueue(
    [t('old1'), t('now'), t('a'), t('radio1')],
    'now',
    t('picked'),
    new Set(['a']),
    [t('ctx1'), t('a'), t('ctx2')]
  );
  assert.equal(ids(playNow), 'old1,now,picked,a,ctx1,ctx2');
  // Nothing has been played yet: no history is kept
  assert.equal(ids(buildPlayNowQueue([t('seed1'), t('seed2')], null, t('picked'), new Set())), 'picked');

  // Radio only tops up a queue that is about to run dry, and never duplicates
  const full = [t('now'), t('a'), t('b'), t('c')];
  assert.equal(mergeRadioIntoQueue(full, 'now', [t('r1')]), full);
  const low = [t('played'), t('now'), t('a')];
  assert.equal(ids(mergeRadioIntoQueue(low, 'now', [t('a'), t('r1'), t('now'), t('r2')])), 'played,now,a,r1,r2');
  // The current song must be in the queue for a top-up to make sense
  assert.equal(mergeRadioIntoQueue(low, 'missing', [t('r1')]), low);
});
