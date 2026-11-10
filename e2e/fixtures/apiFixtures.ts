/**
 * Deterministic stand-ins for YouTube Music: the JSON the Express backend returns
 * (`/api/innertube/*`) and, for the no-backend app-shell spec, raw InnerTube answers shaped like the
 * live service (so the app's real parsers run on them).
 */
import type { InnerTubeParsedTrack } from '../../src/utils/metrolistCore';

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A stable, valid 11-character video id derived from `seed`. */
export function fixtureVideoId(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x5bd1e995) >>> 0;
  }
  let id = '';
  for (let i = 0; i < 11; i++) {
    const mixed = i % 2 === 0 ? h1 >>> (i * 3) : h2 >>> (i * 2);
    id += ID_ALPHABET[(mixed ^ (i * 7)) & 63];
  }
  return id;
}

function titleCase(text: string): string {
  return text
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

export const FIXTURE_DURATION_MS = 200000;

function track(seed: string, title: string, artist: string): InnerTubeParsedTrack {
  const videoId = fixtureVideoId(seed);
  return {
    videoId,
    title,
    artist,
    album: `${artist} Album`,
    durationMs: FIXTURE_DURATION_MS,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

/** Twelve results for any query; the first one is the query itself, title-cased. */
export function searchResultsFor(query: string): InnerTubeParsedTrack[] {
  const words = titleCase(query.trim().toLowerCase());
  const artist = words.split(' ')[0] || 'Artist';
  return Array.from({ length: 12 }, (_, i) =>
    track(`search:${query.toLowerCase()}:${i}`, i === 0 ? words : `${words} Part ${i + 1}`, artist)
  );
}

export const RADIO_PAGE_SIZE = 10;
export const RADIO_LAST_PAGE = 4;

/** Page `page` (1 = first) of the radio built from `seedVideoId`. */
export function radioPage(seedVideoId: string, page: number): { tracks: InnerTubeParsedTrack[]; continuation: string | null } {
  return {
    tracks: Array.from({ length: RADIO_PAGE_SIZE }, (_, i) =>
      track(`radio:${seedVideoId}:${page}:${i}`, `Radio ${seedVideoId.slice(0, 4)} P${page}-${i + 1}`, 'Radio Artist')
    ),
    continuation: page < RADIO_LAST_PAGE ? `RADIO${page + 1}.${seedVideoId}` : null,
  };
}

/** Page number encoded in a continuation token produced by `radioPage`. */
export function pageOfContinuation(token: string): number {
  return Number(token.slice('RADIO'.length, token.indexOf('.'))) || 2;
}

/* ------------------------------- raw InnerTube answers (app shell) ------------------------------ */

const runs = (text: string) => ({ runs: [{ text }] });

function clock(ms: number): string {
  const sec = Math.round(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** `youtubei/v1/search` answer ("Songs" shelf of `musicResponsiveListItemRenderer`). */
export function innerTubeSearchJson(tracks: InnerTubeParsedTrack[]): unknown {
  return {
    contents: {
      tabbedSearchResultsRenderer: {
        tabs: [
          {
            tabRenderer: {
              content: {
                sectionListRenderer: {
                  contents: [
                    {
                      musicShelfRenderer: {
                        contents: tracks.map((t) => ({
                          musicResponsiveListItemRenderer: {
                            playlistItemData: { videoId: t.videoId },
                            thumbnail: { musicThumbnailRenderer: { thumbnail: { thumbnails: [{ url: t.thumbnailUrl }] } } },
                            flexColumns: [
                              { musicResponsiveListItemFlexColumnRenderer: { text: runs(t.title) } },
                              {
                                musicResponsiveListItemFlexColumnRenderer: {
                                  text: runs(`${t.artist} • ${t.album} • ${clock(t.durationMs)}`),
                                },
                              },
                            ],
                          },
                        })),
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
}

function panelItems(tracks: InnerTubeParsedTrack[]): unknown[] {
  return tracks.map((t) => ({
    playlistPanelVideoRenderer: {
      videoId: t.videoId,
      title: runs(t.title),
      shortBylineText: runs(t.artist),
      longBylineText: runs(`${t.artist} • ${t.album}`),
      lengthText: runs(clock(t.durationMs)),
      thumbnail: { thumbnails: [{ url: t.thumbnailUrl }] },
    },
  }));
}

function continuations(token: string | null): Record<string, unknown> {
  return token ? { continuations: [{ nextRadioContinuationData: { continuation: token } }] } : {};
}

/** `youtubei/v1/next` answer: the first radio page, or — with a continuation — the next page
 * (which, like the live service, also repeats the first page under `contents`). */
export function innerTubeNextJson(seedVideoId: string, continuation?: string): unknown {
  const first = radioPage(seedVideoId, 1);
  const firstPage = {
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
                          contents: panelItems([track(`seed:${seedVideoId}`, 'Seed', 'Seed Artist'), ...first.tracks]),
                          ...continuations(first.continuation),
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
  if (!continuation) return firstPage;
  const next = radioPage(seedVideoId, pageOfContinuation(continuation));
  return {
    ...firstPage,
    continuationContents: {
      playlistPanelContinuation: { contents: panelItems(next.tracks), ...continuations(next.continuation) },
    },
  };
}
