import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDurationMs } from './metrolistCore';

test('Duration formatter renders tabular MM:SS and clamps negative input', () => {
  assert.equal(formatDurationMs(218000), '03:38');
  assert.equal(formatDurationMs(-5000), '00:00');
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

test('Song search terms are derived from YouTube-style video titles', async () => {
  const { deriveSongSearchTerms } = await import('./metrolistCore');
  const vevo = deriveSongSearchTerms(
    'Daft Punk - Instant Crush (Official Video) ft. Julian Casablancas',
    'DaftPunkVEVO'
  );
  assert.deepEqual(vevo, { artistName: 'Daft Punk', trackName: 'Instant Crush ft. Julian Casablancas' });

  // A song whose own title contains " - " must not be split when the left part is not the artist
  const remaster = deriveSongSearchTerms('Bohemian Rhapsody - Remastered 2011', 'Queen');
  assert.equal(remaster.artistName, 'Queen');
  assert.equal(remaster.trackName, 'Bohemian Rhapsody - Remastered 2011');

  const thirdParty = deriveSongSearchTerms(
    'Radiohead - Everything In Its Right Place [HD]',
    'Newfound Recordings'
  );
  assert.equal(thirdParty.trackName, 'Radiohead - Everything In Its Right Place');
  assert.equal(thirdParty.artistName, 'Newfound Recordings');

  assert.equal(deriveSongSearchTerms('Nightcall', 'Kavinsky - Topic').artistName, 'Kavinsky');
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
