/**
 * The one hook that owns the player's side effects. All playback / queue behaviour lives in the pure
 * `playerReducer`; this hook only talks to the outside world (network, storage, the YouTube player,
 * OS media keys, timers) and turns what happens there into actions. Randomness and time are
 * injected here, so the reducer stays pure.
 *
 * The playback position is NOT React state: it lives in a `PlaybackClock` that only the seek bar
 * bars subscribe to, so nothing else re-renders four times a second while music plays.
 */
import React from 'react';
import { STATIC_YTM_FALLBACK } from '../data/fallbackTracks';
import { connectBackgroundPlayback, getNativeBackgroundPlayback } from '../native/backgroundPlayback';
import {
  checkEmbeddable,
  fetchRadioContinuation,
  fetchRecommendations,
  peekEmbeddability,
  searchTracks,
} from '../utils/apiClient';
import { APP_BACKGROUND_EVENT, APP_FOREGROUND_EVENT } from '../shared/appBackgroundSignal';
import { appActivity } from './appActivity';
import { connectPlayerDebugLog, debugLog } from '../utils/debugLog';
import { LOW_QUALITY_HINT, readStreamQualityMode, writeStreamQualityMode, type StreamQualityMode } from './streamQuality';
import type { StreamQualityDetails } from '../components/YouTubeStreamBridge';
import {
  fromPersistedState,
  loadPlayerState,
  savePlaybackPosition,
  savePlayerState,
  toPersistedState,
  type PersistedAudioSettings,
} from '../utils/persistence';
import {
  KEYBOARD_SEEK_STEP_MS,
  STALL_BEFORE_WAITING_MS,
  alternateSearchQuery,
  isPositionSaveDue,
  planEmbedPrecheck,
  planNetworkRetry,
  planStreamErrorRecovery,
  selectEmbedCheckTargets,
  shortcutForKey,
  shouldWaitForNetworkAfterStall,
} from './effectPolicies';
import { ALTERNATE_CANDIDATES_TO_CHECK, chooseAlternateUpload, rankAlternateUploads } from './alternateUploads';
import { createPlaybackClock, type PlaybackClock } from './playbackClock';
import {
  createInitialPlayerState,
  playerReducer,
  selectActiveTrack,
  selectCanRetryRadio,
  selectCanTryAlternateVideo,
  selectIsStreamLoading,
  selectRadioContinuationRequest,
  selectTriedVideoIds,
  type PlaySource,
  type PlayerState,
  type StreamStatus,
  type TrackInput,
} from './playerCore';
import { createPlayerStore, type PlayerStore } from './playerStore';
import { computeRetryDelayMs } from './retryPolicy';
import type { UnplayableReason } from './streamErrors';

const NOTICE_DURATION_MS = 4500;
const SAVE_DEBOUNCE_MS = 400;
const MEDIA_SEEK_STEP_MS = 10000;
const MEDIA_POSITION_BUCKET_MS = 5000;
const SEEK_END_MARGIN_MS = 500;

/** Everything `YouTubeStreamBridge` needs for the active track. */
export interface StreamBinding {
  videoId: string;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  seekRequest: { token: number; ms: number } | null;
  /** Where a newly created player starts (restore, network retry). */
  initialPositionMs: number;
  /** Changes whenever the player must be torn down and created again (network retry). */
  retryNonce: number;
  onStatusChange: (status: StreamStatus) => void;
  onTimeUpdateMs: (currentMs: number, durationMs?: number) => void;
  onEnded: () => void;
  onError: (code: number, videoId?: string) => void;
  onSeekHandled: (token: number) => void;
  onExternalPlayPause: (playing: boolean) => void;
  onPlaybackQuality: (quality: string, videoId: string, details: StreamQualityDetails) => void;
  /** Read once at start-up: a change (debug page) applies after a restart. */
  qualityMode: StreamQualityMode;
}

interface Runtime {
  store: PlayerStore;
  clock: PlaybackClock;
  audio: PersistedAudioSettings;
  positionMs: number;
}

/** Restores the last session (always paused) from storage. */
function bootRuntime(): Runtime {
  const persisted = loadPlayerState();
  const { player, positionMs } = fromPersistedState(persisted);
  let state: PlayerState = playerReducer(createInitialPlayerState(), {
    type: 'restore',
    snapshot: player,
    positionMs,
  });
  // The stream is created at the saved position instead (`initialPositionMs`): seeking a cued
  // YouTube video would start playing it.
  state = playerReducer(state, { type: 'seekHandled' });
  return {
    store: createPlayerStore(state),
    clock: createPlaybackClock(positionMs),
    audio: { volume: persisted.volume, isMuted: persisted.isMuted },
    positionMs,
  };
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'SUMMARY'].includes(tag)) return true;
  if (target.isContentEditable) return true;
  const role = target.getAttribute('role') ?? '';
  return ['button', 'tab', 'menu', 'menuitem', 'slider', 'option', 'switch', 'checkbox'].includes(role);
}

export function usePlayer() {
  const [runtime] = React.useState(bootRuntime);
  const { store, clock } = runtime;
  const send = store.dispatch;
  const state = React.useSyncExternalStore(store.subscribe, store.getState, store.getState);

  const [audio, setAudio] = React.useState<PersistedAudioSettings>(runtime.audio);
  const audioRef = React.useRef(audio);
  audioRef.current = audio;
  // Read once: the hidden player's size and quality request apply when a player is created
  const [qualityMode] = React.useState(() => readStreamQualityMode());
  const [isLoadingRecommendations, setIsLoadingRecommendations] = React.useState(false);
  const [streamStart, setStreamStart] = React.useState<{ nonce: number; positionMs: number; trackId: string | null }>({
    nonce: 0,
    positionMs: runtime.positionMs,
    trackId: state.activeTrackId,
  });

  const activeTrack = selectActiveTrack(state);

  /* ------------------------------------- stable actions -------------------------------------- */

  const reinitStream = React.useCallback(() => {
    setStreamStart((prev) => ({
      nonce: prev.nonce + 1,
      positionMs: clock.getPositionMs(),
      trackId: store.getState().activeTrackId,
    }));
  }, [clock, store]);

  const actions = React.useMemo(() => {
    const seekTo = (ms: number) => {
      const track = selectActiveTrack(store.getState());
      if (!track) return;
      const safe = Number.isFinite(ms) ? ms : 0;
      const clamped = Math.max(0, Math.min(safe, Math.max(0, track.durationMs - SEEK_END_MARGIN_MS)));
      clock.setPositionMs(clamped);
      send({ type: 'seekRequested', ms: clamped });
    };
    return {
      /** Plays one song now (search result, recommendation); the radio continues after it. */
      playSearchResult: (track: TrackInput, source?: PlaySource) => send({ type: 'playFromSearch', track, source }),
      /** Plays a song of a list, then continues through `context` (the list it was picked from). */
      playFromList: (track: TrackInput, context: TrackInput[], source?: PlaySource) =>
        send({ type: 'playFromList', track, context, source }),
      /** Shuffle on, start at a random song of the list. */
      shuffleList: (context: TrackInput[], source?: PlaySource) =>
        send({ type: 'shuffleList', context, random: Math.random(), source }),
      playQueueItem: (trackId: string) => send({ type: 'playQueueItem', trackId }),
      togglePlay: () => send({ type: 'togglePlay' }),
      setPlaying: (playing: boolean) => send({ type: 'setPlaying', playing }),
      next: () => send({ type: 'next', random: Math.random() }),
      previous: () => send({ type: 'previous', positionMs: clock.getPositionMs() }),
      seekTo,
      seekBy: (deltaMs: number) => seekTo(clock.getPositionMs() + deltaMs),
      addToQueue: (track: TrackInput) => send({ type: 'addToQueue', track }),
      playNext: (track: TrackInput) => send({ type: 'playNext', track }),
      removeFromQueue: (trackId: string) => send({ type: 'removeFromQueue', trackId }),
      moveQueueItem: (trackId: string, direction: -1 | 1) => send({ type: 'moveQueueItem', trackId, direction }),
      clearUpcoming: () => send({ type: 'clearUpcoming' }),
      toggleLike: (trackId: string, track?: TrackInput) => send({ type: 'toggleLike', trackId, track }),
      toggleDownloaded: (trackId: string, track?: TrackInput) =>
        send({ type: 'toggleDownloaded', trackId, track }),
      toggleShuffle: () => send({ type: 'toggleShuffle' }),
      cycleRepeat: () => send({ type: 'cycleRepeat' }),
      toggleAutoplayRadio: () => send({ type: 'toggleAutoplayRadio' }),
      /** The hidden player's video quality; saved now, applied after a restart (read once at start-up). */
      setStreamQualityMode: (mode: StreamQualityMode) => writeStreamQualityMode(mode),
      dismissNotice: (id?: number) => send({ type: 'dismissNotice', id }),
      setVolume: (volume: number) => setAudio((a) => ({ ...a, volume, isMuted: volume === 0 })),
      toggleMute: () =>
        setAudio((a) => {
          const nextMuted = !(a.isMuted || a.volume === 0);
          if (!nextMuted && a.volume === 0) return { ...a, volume: 0.5, isMuted: false };
          return { ...a, isMuted: nextMuted };
        }),
    };
  }, [clock, send, store]);

  /* ------------------------------ unplayable uploads --------------------------------------- */

  /**
   * One search for another upload per song upload (`trackId videoId`), shared by the stream error
   * recovery and the pre-check, so both never search twice or skip twice. It dispatches the outcome
   * itself: `alternateVideoFound` (same track id: queue, likes and history stay), or `trackUnplayable`
   * (the active song is skipped, an upcoming one is remembered and jumped over later).
   * `failed` (the search itself failed) and `stale` (the song changed meanwhile) dispatch nothing.
   */
  const replacementsRef = React.useRef(new Map<string, Promise<'replaced' | 'none' | 'failed' | 'stale'>>());
  const findReplacementUpload = React.useCallback(
    (trackId: string, videoId: string, reason: UnplayableReason) => {
      const key = `${trackId} ${videoId}`;
      const running = replacementsRef.current.get(key);
      if (running) return running;
      const isCurrentUpload = () => store.getState().tracksById[trackId]?.videoId === videoId;
      const job = (async (): Promise<'replaced' | 'none' | 'failed' | 'stale'> => {
        const state = store.getState();
        const track = state.tracksById[trackId];
        if (!track || track.videoId !== videoId) return 'stale';
        let chosen = null;
        if (selectCanTryAlternateVideo(state, trackId)) {
          let candidates;
          try {
            candidates = await searchTracks(alternateSearchQuery(track));
          } catch {
            return 'failed';
          }
          // Best matches first; the top ones are checked so a known-blocked upload is never chosen
          const ranked = rankAlternateUploads(track, candidates, selectTriedVideoIds(store.getState(), trackId));
          await checkEmbeddable(ranked.slice(0, ALTERNATE_CANDIDATES_TO_CHECK).map((r) => r.candidate.videoId));
          chosen = chooseAlternateUpload(ranked, peekEmbeddability);
        }
        if (!isCurrentUpload()) return 'stale';
        if (
          chosen &&
          send({
            type: 'alternateVideoFound',
            trackId,
            videoId: chosen.videoId,
            durationMs: chosen.durationMs,
            expectedVideoId: videoId,
          })
        ) {
          return 'replaced';
        }
        send({ type: 'trackUnplayable', trackId, random: Math.random(), reason, videoId });
        return 'none';
      })();
      replacementsRef.current.set(key, job);
      void job.then((outcome) => {
        // A failed search may be tried again later (e.g. by the stream error recovery)
        if (outcome === 'failed' || outcome === 'stale') replacementsRef.current.delete(key);
      });
      return job;
    },
    [send, store]
  );

  /* ------------------------------------ stream callbacks ------------------------------------- */

  /** True while a pause the YouTube player made itself is dispatched (read by the native plugin sync). */
  const playerPausingRef = React.useRef(false);

  /** `trackId videoId` pairs whose player was already re-created once after an error. */
  const retriedStreamsRef = React.useRef(new Set<string>());

  const recoverFromStreamError = React.useCallback(
    async (code: number, videoId?: string) => {
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      const current = selectActiveTrack(store.getState());
      const retryKey = current ? `${current.id} ${current.videoId}` : '';
      const plan = planStreamErrorRecovery(store.getState(), {
        code,
        online,
        retried: retriedStreamsRef.current.has(retryKey),
        videoId,
      });
      if (!plan || !current) return;
      if (plan.kind === 'waitForNetwork') {
        send({ type: 'networkLost' });
        return;
      }
      if (plan.kind === 'retry') {
        // A player error can be transient: create the player again for the same video, once
        retriedStreamsRef.current.add(retryKey);
        reinitStream();
        return;
      }
      if (plan.kind === 'findAlternate') {
        // Some uploads cannot be played outside youtube.com: look for another upload of the song
        const outcome = await findReplacementUpload(plan.trackId, plan.videoId, plan.reason);
        if (outcome !== 'failed' || store.getState().activeTrackId !== plan.trackId) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          send({ type: 'networkLost' });
          return;
        }
      }
      send({
        type: 'trackUnplayable',
        trackId: plan.trackId,
        random: Math.random(),
        reason: plan.reason,
        videoId: current.videoId,
      });
    },
    [findReplacementUpload, reinitStream, send, store]
  );

  /*
   * Embeddability pre-check: the active song and the next 3 are checked (YouTube's oEmbed) as soon
   * as the queue changes, so an upload its owner keeps off other apps is replaced BEFORE it is
   * reached. No React state: the result only feeds the store (no extra renders).
   */
  const pendingEmbedChecksRef = React.useRef(new Set<string>());
  const precheckedRef = React.useRef(new Set<string>());
  const runEmbedPrecheckRef = React.useRef<() => void>(() => {});
  runEmbedPrecheckRef.current = () => {
    const plan = planEmbedPrecheck(
      selectEmbedCheckTargets(store.getState()),
      peekEmbeddability,
      pendingEmbedChecksRef.current
    );
    for (const target of plan.blocked) {
      const key = `${target.trackId} ${target.videoId}`;
      if (precheckedRef.current.has(key)) continue;
      precheckedRef.current.add(key);
      void findReplacementUpload(target.trackId, target.videoId, 'embedDisabled');
    }
    if (plan.check.length === 0) return;
    for (const id of plan.check) pendingEmbedChecksRef.current.add(id);
    void checkEmbeddable(plan.check).finally(() => {
      for (const id of plan.check) pendingEmbedChecksRef.current.delete(id);
      runEmbedPrecheckRef.current();
    });
  };
  const embedCheckKey = selectEmbedCheckTargets(state)
    .map((target) => `${target.trackId}=${target.videoId}`)
    .join(' ');
  React.useEffect(() => {
    if (embedCheckKey) runEmbedPrecheckRef.current();
  }, [embedCheckKey]);

  const qualityLoggedRef = React.useRef(new Set<string>());
  const streamCallbacks = React.useMemo(
    () => ({
      onStatusChange: (status: StreamStatus) => {
        send({ type: 'streamStatusChanged', status });
      },
      onTimeUpdateMs: (currentMs: number, durationMs?: number) => {
        clock.setPositionMs(currentMs);
        const track = selectActiveTrack(store.getState());
        if (durationMs && track) send({ type: 'durationDiscovered', trackId: track.id, durationMs });
      },
      onEnded: () => {
        const trackId = store.getState().activeTrackId;
        if (trackId) send({ type: 'trackEnded', trackId, random: Math.random() });
      },
      onError: (code: number, videoId?: string) => {
        debugLog.add('player', `Stream error ${code}${videoId ? ` (${videoId})` : ''}`, 'warn');
        void recoverFromStreamError(code, videoId);
      },
      onSeekHandled: (token: number) => {
        send({ type: 'seekHandled', token });
      },
      onPlaybackQuality: (quality: string, videoId: string, details: StreamQualityDetails) => {
        const key = `${videoId} ${quality}`;
        if (qualityLoggedRef.current.has(key)) return;
        if (qualityLoggedRef.current.size > 200) qualityLoggedRef.current.clear();
        qualityLoggedRef.current.add(key);
        const { mode, width, height, dpr, asked, hinted } = details;
        debugLog.add(
          'player',
          `stream quality: ${quality} (video ${videoId}; mode ${mode}, player ${width}x${height} css, dpr ${Math.round(dpr * 100) / 100}${
            asked ? ', asked small' : mode === 'low' ? ', not asked' : ''
          }${hinted ? `, hints vq+suggestedQuality ${LOW_QUALITY_HINT}` : ''})`
        );
      },
      onExternalPlayPause: (playing: boolean) => {
        debugLog.add('player', `The YouTube player ${playing ? 'started' : 'paused'} by itself`);
        if (playing) {
          send({ type: 'setPlaying', playing });
          return;
        }
        // The background-playback plugin tells this pause apart from the listener's
        playerPausingRef.current = true;
        try {
          send({ type: 'setPlaying', playing });
        } finally {
          playerPausingRef.current = false;
        }
      },
    }),
    [clock, recoverFromStreamError, send, store]
  );

  /* ---------------------------------- position bookkeeping ----------------------------------- */

  // A different song starts from 0 (the restored song keeps its saved position)
  const previousTrackIdRef = React.useRef(state.activeTrackId);
  React.useEffect(() => {
    if (previousTrackIdRef.current === state.activeTrackId) return;
    previousTrackIdRef.current = state.activeTrackId;
    clock.setPositionMs(0);
    setStreamStart((prev) => (prev.trackId ? { ...prev, trackId: null, positionMs: 0 } : prev));
  }, [clock, state.activeTrackId]);

  // Seeks (and restarts) move the clock at once; the stream confirms them once applied
  const seekToken = state.seekRequest?.token;
  React.useEffect(() => {
    const request = store.getState().seekRequest;
    if (request) clock.setPositionMs(request.ms);
  }, [clock, seekToken, store]);

  /* ------------------------------ recommendations and radio --------------------------------- */

  React.useEffect(() => {
    const seed = selectActiveTrack(store.getState());
    if (!seed) return;
    const controller = new AbortController();
    setIsLoadingRecommendations(true);
    const fallback = () => send({ type: 'recommendationsFailed', trackId: seed.id, fallback: STATIC_YTM_FALLBACK });
    fetchRecommendations({ videoId: seed.videoId, title: seed.title, artist: seed.artist }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        if (page.tracks.length === 0) {
          fallback();
          return;
        }
        send({
          type: 'recommendationsLoaded',
          trackId: seed.id,
          tracks: page.tracks,
          continuation: page.continuation,
          seedVideoId: page.seedVideoId,
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) fallback();
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingRecommendations(false);
      });
    return () => controller.abort();
  }, [send, store, state.activeTrackId, state.autoplayRadio]);

  // Endless radio: fetch the next page whenever the queue runs low
  const radioRequest = selectRadioContinuationRequest(state);
  const radioKey = radioRequest ? `${radioRequest.seedVideoId} ${radioRequest.continuation}` : '';
  const radioInflightRef = React.useRef<{
    controller: AbortController;
    request: { seedVideoId: string; continuation: string };
  } | null>(null);
  const [radioTick, setRadioTick] = React.useState(0);
  React.useEffect(() => {
    const request = selectRadioContinuationRequest(store.getState());
    if (!request || radioInflightRef.current) return;
    if (!send({ type: 'radioPageRequested', ...request })) return;
    const controller = new AbortController();
    radioInflightRef.current = { controller, request };
    fetchRadioContinuation(request, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        send({ type: 'radioPageLoaded', ...request, tracks: page.tracks, nextContinuation: page.continuation });
      })
      .catch(() => {
        if (!controller.signal.aborted) send({ type: 'radioPageFailed', ...request });
      })
      .finally(() => {
        if (radioInflightRef.current?.controller !== controller) return;
        radioInflightRef.current = null;
        setRadioTick((tick) => tick + 1);
      });
  }, [radioKey, radioTick, send, store]);

  // An aborted page request must be reported, or the radio would wait for it forever
  React.useEffect(
    () => () => {
      const inflight = radioInflightRef.current;
      if (!inflight) return;
      radioInflightRef.current = null;
      inflight.controller.abort();
      send({ type: 'radioPageFailed', ...inflight.request });
    },
    [send]
  );

  const radioCanRetry = selectCanRetryRadio(state);
  const radioFailures = state.radio?.failedAttempts ?? 0;
  React.useEffect(() => {
    if (!radioCanRetry) return;
    const timer = window.setTimeout(() => send({ type: 'radioRetry' }), computeRetryDelayMs(radioFailures - 1));
    return () => window.clearTimeout(timer);
  }, [radioCanRetry, radioFailures, send]);

  /* ---------------------------------- network back-off --------------------------------------- */

  const retryNetworkNow = React.useCallback(() => {
    const current = store.getState();
    const plan = planNetworkRetry({
      waiting: current.network.waiting,
      streamStatus: current.streamStatus,
      retryAttempt: current.network.retryAttempt,
    });
    if (plan === 'restored') {
      // The stream plays again on its own: never re-create a playing player (audible gap)
      send({ type: 'networkRestored' });
    } else if (plan === 'retry') {
      send({ type: 'networkRetryAttempted' });
      reinitStream();
    } else if (plan === 'giveUp') {
      send({ type: 'networkRetriesExhausted' });
    }
  }, [reinitStream, send, store]);

  const { waiting: networkWaiting, retryAttempt } = state.network;
  React.useEffect(() => {
    if (!networkWaiting) return;
    const timer = window.setTimeout(retryNetworkNow, computeRetryDelayMs(retryAttempt));
    return () => window.clearTimeout(timer);
  }, [networkWaiting, retryAttempt, retryNetworkNow]);

  // A stream stuck loading / buffering for 8 s while offline waits for the network. An
  // `offline` event alone (a blip while the player plays from its buffer) changes nothing.
  const stalledSinceRef = React.useRef<number | null>(null);
  const checkStall = React.useCallback(() => {
    const current = store.getState();
    const since = stalledSinceRef.current;
    if (since === null || current.network.waiting) return;
    const wait = shouldWaitForNetworkAfterStall({
      isPlaying: current.isPlaying,
      streamStatus: current.streamStatus,
      stalledForMs: Date.now() - since,
      online: typeof navigator === 'undefined' || navigator.onLine !== false,
    });
    if (wait) send({ type: 'networkLost' });
  }, [send, store]);

  const isStalled = state.isPlaying && (state.streamStatus === 'loading' || state.streamStatus === 'buffering');
  React.useEffect(() => {
    if (!isStalled) {
      stalledSinceRef.current = null;
      return;
    }
    stalledSinceRef.current = Date.now();
    const timer = window.setTimeout(checkStall, STALL_BEFORE_WAITING_MS);
    return () => window.clearTimeout(timer);
  }, [isStalled, checkStall]);

  React.useEffect(() => {
    const onOnline = () => retryNetworkNow();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', checkStall);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', checkStall);
    };
  }, [checkStall, retryNetworkNow]);

  /* --------------------------------------- persistence --------------------------------------- */

  const lastSavedAtRef = React.useRef<number | null>(null);
  const saveNow = React.useCallback(() => {
    savePlayerState(toPersistedState(store.getState(), clock.getPositionMs(), audioRef.current));
    lastSavedAtRef.current = Date.now();
  }, [clock, store]);

  React.useEffect(() => {
    const timer = window.setTimeout(saveNow, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [state, audio, saveNow]);

  // The periodic save while playing writes only the position (a few bytes), not the whole library
  React.useEffect(
    () =>
      clock.subscribe(() => {
        const current = store.getState();
        if (current.isPlaying && current.activeTrackId && isPositionSaveDue(lastSavedAtRef.current, Date.now())) {
          const track = selectActiveTrack(current);
          const positionMs = clock.getPositionMs();
          savePlaybackPosition(
            current.activeTrackId,
            track ? Math.max(0, Math.min(positionMs, track.durationMs)) : positionMs
          );
          lastSavedAtRef.current = Date.now();
        }
      }),
    [clock, store]
  );

  React.useEffect(() => {
    if (!state.isPlaying) saveNow();
  }, [state.isPlaying, saveNow]);

  React.useEffect(() => {
    const onVisibility = () => {
      debugLog.add('page', `Visibility ${document.visibilityState}`);
      appActivity.setBackground(document.visibilityState === 'hidden');
      if (document.visibilityState === 'hidden') saveNow();
    };
    const onPageHide = () => {
      debugLog.add('page', 'Page hide');
      saveNow();
    };
    // The desktop app's window was minimised / hidden (it keeps playing, the page stays visible)
    const onAppBackground = () => {
      debugLog.add('page', 'Desktop window minimised or hidden: saved');
      appActivity.setBackground(true);
      saveNow();
    };
    const onAppForeground = () => appActivity.setBackground(document.visibilityState === 'hidden');
    appActivity.setBackground(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener(APP_BACKGROUND_EVENT, onAppBackground);
    window.addEventListener(APP_FOREGROUND_EVENT, onAppForeground);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener(APP_BACKGROUND_EVENT, onAppBackground);
      window.removeEventListener(APP_FOREGROUND_EVENT, onAppForeground);
    };
  }, [saveNow]);

  /* ----------------------------------------- notices ----------------------------------------- */

  const noticeId = state.notice?.id;
  React.useEffect(() => {
    if (noticeId === undefined) return;
    const timer = window.setTimeout(() => send({ type: 'dismissNotice', id: noticeId }), NOTICE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [noticeId, send]);

  /* ------------------------------------ OS media session ------------------------------------- */

  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const handlers: Array<[MediaSessionAction, MediaSessionActionHandler]> = [
      ['play', () => actions.setPlaying(true)],
      ['pause', () => actions.setPlaying(false)],
      ['previoustrack', () => actions.previous()],
      ['nexttrack', () => actions.next()],
      ['seekbackward', () => actions.seekBy(-MEDIA_SEEK_STEP_MS)],
      ['seekforward', () => actions.seekBy(MEDIA_SEEK_STEP_MS)],
      [
        'seekto',
        (details) => {
          if (typeof details.seekTime === 'number') actions.seekTo(Math.round(details.seekTime * 1000));
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Action not supported by this browser
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // ignore
        }
      }
    };
  }, [actions]);

  React.useEffect(() => {
    if (!activeTrack || typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    if (typeof MediaMetadata === 'undefined') return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: activeTrack.title,
        artist: activeTrack.artist,
        album: activeTrack.album,
        artwork: [{ src: activeTrack.coverUrl }],
      });
    } catch {
      // Ignore artwork / metadata errors on older browsers
    }
  }, [activeTrack]);

  const durationMs = activeTrack?.durationMs ?? 0;
  React.useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const update = () => {
      try {
        navigator.mediaSession.playbackState = store.getState().isPlaying ? 'playing' : 'paused';
        const durationSec = durationMs / 1000;
        if (durationSec > 0 && typeof navigator.mediaSession.setPositionState === 'function') {
          navigator.mediaSession.setPositionState({
            duration: durationSec,
            playbackRate: 1,
            position: Math.min(durationSec, clock.getPositionMs() / 1000),
          });
        }
      } catch {
        // ignore
      }
    };
    update();
    let bucket = Math.floor(clock.getPositionMs() / MEDIA_POSITION_BUCKET_MS);
    return clock.subscribe(() => {
      const next = Math.floor(clock.getPositionMs() / MEDIA_POSITION_BUCKET_MS);
      if (next !== bucket) {
        bucket = next;
        update();
      }
    });
  }, [clock, durationMs, state.isPlaying, store]);

  /* ---------------------------------- native background play -------------------------------- */

  // The packaged Android / iOS app only (a no-op on the web and the desktop app): the local Capacitor
  // plugin keeps playing in the background, sends the notification / headset commands back, and
  // says when the app leaves the foreground (saved here: the page may stay "visible" meanwhile)
  React.useEffect(() => {
    const plugin = getNativeBackgroundPlayback();
    if (!plugin) return;
    debugLog.add('plugin', `Background playback plugin (${plugin.platform}) connected`);
    return connectBackgroundPlayback({
      plugin,
      store,
      clock,
      actions,
      pauseOrigin: () => (playerPausingRef.current ? 'player' : 'user'),
      onSave: saveNow,
      onActivity: (activity) => appActivity.setBackground(activity === 'background'),
      log: (message) => debugLog.add('plugin', message),
    });
  }, [actions, clock, saveNow, store]);

  /* --------------------------------------- debug log ----------------------------------------- */

  // The hidden debug log (#/debug): player changes and network events, in memory only
  React.useEffect(() => connectPlayerDebugLog(store), [store]);
  React.useEffect(() => {
    const onOnline = () => debugLog.add('page', 'Online');
    const onOffline = () => debugLog.add('page', 'Offline', 'warn');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  /* --------------------------------------- keyboard ------------------------------------------ */

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const command = shortcutForKey(e, isInteractiveTarget(e.target));
      if (!command) return;
      if (command === 'togglePlay') {
        e.preventDefault();
        actions.togglePlay();
      } else {
        actions.seekBy(command === 'seekForward' ? KEYBOARD_SEEK_STEP_MS : -KEYBOARD_SEEK_STEP_MS);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);

  /* ----------------------------------------- output ------------------------------------------ */

  const stream: StreamBinding | null =
    activeTrack
      ? {
          videoId: activeTrack.videoId,
          isPlaying: state.isPlaying,
          volume: audio.volume,
          isMuted: audio.isMuted,
          seekRequest: state.seekRequest,
          initialPositionMs: streamStart.trackId === activeTrack.id ? streamStart.positionMs : 0,
          retryNonce: streamStart.nonce,
          qualityMode,
          ...streamCallbacks,
        }
      : null;

  return {
    state,
    activeTrack,
    isStreamLoading: selectIsStreamLoading(state),
    isLoadingRecommendations,
    audio,
    clock,
    actions,
    stream,
  };
}

export type PlayerActions = ReturnType<typeof usePlayer>['actions'];
