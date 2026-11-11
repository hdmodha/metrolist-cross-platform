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
  const { parseInnerTubeWatchNextPage } = await import('./metrolistCore');
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

  const { tracks: recommendations } = parseInnerTubeWatchNextPage(mockWatchNextTree, 'a5uQMwRMHcs');
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
  const { parseInnerTubeWatchNextPage } = await import('./metrolistCore');
  const item = (videoId: string, length: string) => ({
    playlistPanelVideoRenderer: {
      videoId,
      title: { runs: [{ text: `Track ${videoId}` }] },
      shortBylineText: { runs: [{ text: 'Artist' }] },
      longBylineText: { runs: [{ text: 'Artist • 5M views • 190K likes' }] },
      lengthText: { runs: [{ text: length }] },
    },
  });
  const { tracks: recs } = parseInnerTubeWatchNextPage({
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


/* ---------------------------------- Radio continuation pages ---------------------------------- */

function panelItem(videoId: string, title = `Song ${videoId}`) {
  return {
    playlistPanelVideoRenderer: {
      videoId,
      title: { runs: [{ text: title }] },
      shortBylineText: { runs: [{ text: 'Artist' }] },
      lengthText: { runs: [{ text: '3:30' }] },
    },
  };
}

const radioToken = (n: number) => `CBkSJRILc2VlZFZpZGVvMDE${n}%3D`;

/** First WatchNext page, shaped like the live `RDAMVM` answer. */
function firstRadioPage(videoIds: string[], token: string | null) {
  return {
    contents: {
      singleColumnMusicWatchNextResultsRenderer: {
        tabbedRenderer: {
          watchNextTabbedResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    musicQueueRenderer: {
                      content: {
                        playlistPanelRenderer: {
                          contents: videoIds.map((id) => panelItem(id)),
                          ...(token
                            ? { continuations: [{ nextRadioContinuationData: { continuation: token } }] }
                            : {}),
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
}

test('WatchNext page parser returns the tracks and the radio continuation token of a first page', async () => {
  const { parseInnerTubeWatchNextPage } = await import('./metrolistCore');
  const page = parseInnerTubeWatchNextPage(
    firstRadioPage(['seedVideo01', 'aaaaaaaaaa1', 'aaaaaaaaaa2'], radioToken(1)),
    'seedVideo01'
  );
  assert.deepEqual(page.tracks.map((t) => t.videoId), ['aaaaaaaaaa1', 'aaaaaaaaaa2']);
  assert.equal(page.continuation, radioToken(1));
});

test('WatchNext page parser reads ONLY continuationContents of a continuation answer', async () => {
  const { parseInnerTubeWatchNextPage } = await import('./metrolistCore');
  // The live service repeats the first page under `contents` next to the continuation page
  const answer = {
    ...firstRadioPage(['seedVideo01', 'aaaaaaaaaa1', 'aaaaaaaaaa2'], radioToken(1)),
    continuationContents: {
      playlistPanelContinuation: {
        contents: [panelItem('bbbbbbbbbb1'), panelItem('aaaaaaaaaa1'), panelItem('bbbbbbbbbb2')],
        continuations: [{ nextRadioContinuationData: { continuation: radioToken(2) } }],
      },
    },
  };
  const page = parseInnerTubeWatchNextPage(answer, 'seedVideo01');
  assert.deepEqual(page.tracks.map((t) => t.videoId), ['bbbbbbbbbb1', 'aaaaaaaaaa1', 'bbbbbbbbbb2']);
  assert.equal(page.continuation, radioToken(2));
});

test('WatchNext page parser reports an exhausted radio as a null continuation', async () => {
  const { parseInnerTubeWatchNextPage } = await import('./metrolistCore');
  assert.equal(parseInnerTubeWatchNextPage(firstRadioPage(['aaaaaaaaaa1'], null)).continuation, null);
  assert.equal(
    parseInnerTubeWatchNextPage({
      continuationContents: { playlistPanelContinuation: { contents: [panelItem('bbbbbbbbbb1')] } },
    }).continuation,
    null
  );
  // Unexpected / malicious tokens are dropped rather than forwarded
  assert.equal(parseInnerTubeWatchNextPage(firstRadioPage([], 'bad token<script>')).continuation, null);
  assert.deepEqual(parseInnerTubeWatchNextPage(null), { tracks: [], continuation: null });
});

test('Radio continuation tokens are validated with a linear character check', async () => {
  const { sanitizeRadioContinuation } = await import('./metrolistCore');
  assert.equal(sanitizeRadioContinuation(radioToken(1)), radioToken(1));
  assert.equal(sanitizeRadioContinuation('abc-_.%=XYZ019'), 'abc-_.%=XYZ019');
  assert.equal(sanitizeRadioContinuation(''), '');
  assert.equal(sanitizeRadioContinuation('a b'), '');
  assert.equal(sanitizeRadioContinuation('a/b+c'), '');
  assert.equal(sanitizeRadioContinuation('x'.repeat(1024)), 'x'.repeat(1024));
  assert.equal(sanitizeRadioContinuation('x'.repeat(1025)), '');
  assert.equal(sanitizeRadioContinuation(42), '');
  assert.equal(sanitizeRadioContinuation(['abc']), '');
});

test('WatchNext request body carries the URL-decoded continuation token only when paging', async () => {
  const { buildInnerTubeNextBody } = await import('./metrolistCore');
  const first = buildInnerTubeNextBody('seedVideo01');
  assert.equal(first.playlistId, 'RDAMVMseedVideo01');
  assert.equal(first.videoId, 'seedVideo01');
  assert.equal('continuation' in first, false);

  const next = buildInnerTubeNextBody('seedVideo01', 'CBkSAbc%3D%3D');
  assert.equal(next.continuation, 'CBkSAbc==');
  assert.equal(next.playlistId, 'RDAMVMseedVideo01');
  // A malformed escape is sent as-is instead of throwing
  assert.equal(buildInnerTubeNextBody('seedVideo01', 'abc%E0%A4%A').continuation, 'abc%E0%A4%A');
});

test('Radio page fetcher sends the right body and parses tracks and the next token', async () => {
  const { fetchInnerTubeRadioPage } = await import('./metrolistCore');
  const bodies: Array<Record<string, unknown>> = [];
  const transport = async (endpoint: string, body: Record<string, unknown>) => {
    assert.equal(endpoint, 'next');
    bodies.push(body);
    if (body.continuation) {
      return {
        continuationContents: {
          playlistPanelContinuation: { contents: [panelItem('bbbbbbbbbb1'), panelItem('seedVideo01')] },
        },
      };
    }
    return firstRadioPage(['seedVideo01', 'aaaaaaaaaa1'], radioToken(1));
  };
  const first = await fetchInnerTubeRadioPage(transport, 'seedVideo01');
  assert.deepEqual(first.tracks.map((t) => t.videoId), ['aaaaaaaaaa1']);
  assert.equal(first.continuation, radioToken(1));

  const second = await fetchInnerTubeRadioPage(transport, 'seedVideo01', first.continuation!);
  assert.deepEqual(second.tracks.map((t) => t.videoId), ['bbbbbbbbbb1']);
  assert.equal(second.continuation, null);
  assert.equal(bodies[1].continuation, decodeURIComponent(radioToken(1)));
});

/* ------------------------------- InnerTube retry on timeout / network ------------------------------- */

function timeoutError(): Error {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
}

test('An InnerTube call that times out is retried once, with the attempt timeout passed on', async () => {
  const { withInnerTubeRetry } = await import('./metrolistCore');
  const timeouts: Array<number | undefined> = [];
  let calls = 0;
  const flaky = async (_endpoint: string, _body: Record<string, unknown>, options?: { timeoutMs?: number }) => {
    calls++;
    timeouts.push(options?.timeoutMs);
    if (calls === 1) throw timeoutError();
    return { ok: true };
  };
  const transport = withInnerTubeRetry(flaky, { attemptTimeoutMs: 8000, budgetMs: 20000, now: () => 0 });
  assert.deepEqual(await transport('search', {}), { ok: true });
  assert.equal(calls, 2);
  assert.deepEqual(timeouts, [8000, 8000]);
});

test('A network error is retried once at most; an HTTP error status is never retried', async () => {
  const { withInnerTubeRetry, InnerTubeHttpError } = await import('./metrolistCore');
  let calls = 0;
  const offline = withInnerTubeRetry(
    async () => {
      calls++;
      throw new TypeError('fetch failed');
    },
    { attemptTimeoutMs: 8000, budgetMs: 20000, now: () => 0 }
  );
  await assert.rejects(offline('search', {}), /fetch failed/);
  assert.equal(calls, 2);

  calls = 0;
  const refused = withInnerTubeRetry(
    async () => {
      calls++;
      throw new InnerTubeHttpError(403, 'InnerTube search upstream returned 403');
    },
    { attemptTimeoutMs: 8000, budgetMs: 20000, now: () => 0 }
  );
  await assert.rejects(refused('search', {}), /403/);
  assert.equal(calls, 1, 'YouTube answered: asking again would not help');

  // A body that is not JSON is an answer too
  calls = 0;
  const garbled = withInnerTubeRetry(
    async () => {
      calls++;
      throw new SyntaxError('Unexpected token <');
    },
    { attemptTimeoutMs: 8000, budgetMs: 20000, now: () => 0 }
  );
  await assert.rejects(garbled('search', {}), SyntaxError);
  assert.equal(calls, 1);
});

test('All calls through one retrying transport share a bounded time budget', async () => {
  const { withInnerTubeRetry } = await import('./metrolistCore');
  let clock = 0;
  const timeouts: Array<number | undefined> = [];
  const hanging = async (_endpoint: string, _body: Record<string, unknown>, options?: { timeoutMs?: number }) => {
    timeouts.push(options?.timeoutMs);
    clock += options?.timeoutMs ?? 0; // every attempt runs into its timeout
    throw timeoutError();
  };
  const transport = withInnerTubeRetry(hanging, { attemptTimeoutMs: 8000, budgetMs: 16000, minAttemptMs: 2000, now: () => clock });
  await assert.rejects(transport('search', {}));
  assert.deepEqual(timeouts, [8000, 8000]);
  // The budget is spent: the next call fails at once, without another upstream request
  await assert.rejects(transport('search', {}), /did not answer in time/);
  assert.equal(timeouts.length, 2);

  // The last attempt only gets what is left of the budget, and a retry needs a useful minimum
  clock = 0;
  timeouts.length = 0;
  const short = withInnerTubeRetry(hanging, { attemptTimeoutMs: 8000, budgetMs: 11000, minAttemptMs: 2000, now: () => clock });
  await assert.rejects(short('search', {}));
  assert.deepEqual(timeouts, [8000, 3000]);
  clock = 0;
  timeouts.length = 0;
  const tooShort = withInnerTubeRetry(hanging, { attemptTimeoutMs: 8000, budgetMs: 9000, minAttemptMs: 2000, now: () => clock });
  await assert.rejects(tooShort('search', {}));
  assert.deepEqual(timeouts, [8000], 'no retry with only 1 s left');
});

test('One upstream timeout no longer fails a search: the Songs filter is asked again', async () => {
  const { searchInnerTubeTracks, withInnerTubeRetry, INNERTUBE_SEARCH_FILTERS } = await import('./metrolistCore');
  const seenParams: string[] = [];
  let failedOnce = false;
  const transport = async (_endpoint: string, body: Record<string, unknown>) => {
    seenParams.push(String(body.params));
    if (!failedOnce) {
      failedOnce = true;
      throw timeoutError();
    }
    return { contents: [videoShelfItem('yKNxeF4KMsY', 'Yellow', 'Coldplay • 1.3B views • 4:33')] };
  };
  const tracks = await searchInnerTubeTracks(
    withInnerTubeRetry(transport, { attemptTimeoutMs: 8000, budgetMs: 16000, now: () => 0 }),
    'coldplay yellow'
  );
  assert.equal(tracks.length, 1);
  assert.deepEqual(seenParams, [INNERTUBE_SEARCH_FILTERS[0].params, INNERTUBE_SEARCH_FILTERS[0].params]);
});
