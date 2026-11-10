/**
 * The one hook that owns the player's side effects. All playback / queue behaviour lives in the pure
 * `playerReducer`; this hook only talks to the outside world (network, storage, the YouTube player,
 * the synth engine, OS media keys, timers) and turns what happens there into actions. Randomness
 * and time are injected here, so the reducer stays pure.
 *
 * The playback position is NOT React state: it lives in a `PlaybackClock` that only the seek bar
 * subscribes to, so nothing else re-renders four times a second while music plays.
 */
import React from 'react';
import { INITIAL_TRACKS, type MetrolistTrack } from '../data/metrolistData';
import { STATIC_YTM_FALLBACK } from '../data/fallbackTracks';
import { fetchRadioContinuation, fetchRecommendations, searchTracks } from '../utils/apiClient';
import type { InnerTubeParsedTrack } from '../utils/metrolistCore';
import {
  fromPersistedState,
  loadPlayerState,
  savePlayerState,
  toPersistedState,
  type PersistedAudioSettings,
} from '../utils/persistence';
import { sharedAudioEngine } from '../utils/webAudioSynth';
import {
  KEYBOARD_SEEK_STEP_MS,
  STALL_BEFORE_WAITING_MS,
  isPositionSaveDue,
  planNetworkRetry,
  pickAlternateUpload,
  planStreamErrorRecovery,
  shortcutForKey,
  shouldWaitForNetworkAfterStall,
} from './effectPolicies';
import { createPlaybackClock, type PlaybackClock } from './playbackClock';
import {
  createInitialPlayerState,
  playerReducer,
  selectActiveTrack,
  selectCanRetryRadio,
  selectIsStreamLoading,
  selectRadioContinuationRequest,
  type PlayerState,
  type StreamStatus,
  type TrackInput,
} from './playerCore';
import { createPlayerStore, type PlayerStore } from './playerStore';
import { computeRetryDelayMs } from './retryPolicy';

const NOTICE_DURATION_MS = 4500;
const SAVE_DEBOUNCE_MS = 400;
const SYNTH_TICK_MS = 250;
const MEDIA_SEEK_STEP_MS = 10000;
const MEDIA_POSITION_BUCKET_MS = 5000;
const SEEK_END_MARGIN_MS = 500;

/** Everything `YouTubeStreamBridge` needs for the active live track. */
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
  onError: (code: number) => void;
  onSeekHandled: (token: number) => void;
  onExternalPlayPause: (playing: boolean) => void;
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
  const { player, positionMs } = fromPersistedState(persisted, INITIAL_TRACKS);
  let state: PlayerState = playerReducer(createInitialPlayerState(INITIAL_TRACKS), {
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
    audio: { volume: persisted.volume, isMuted: persisted.isMuted, eqGains: persisted.eqGains },
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
  const [isLoadingRecommendations, setIsLoadingRecommendations] = React.useState(false);
  const [streamStart, setStreamStart] = React.useState({
    nonce: 0,
    positionMs: runtime.positionMs,
    trackId: state.activeTrackId,
  });

  const activeTrack = selectActiveTrack(state);
  const isLive = !!activeTrack?.isLiveInnerTube;

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
      playSearchResult: (track: InnerTubeParsedTrack) => send({ type: 'playFromSearch', track }),
      playFromList: (track: MetrolistTrack, context: MetrolistTrack[]) =>
        send({ type: 'playFromList', track, context }),
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
      dismissNotice: (id?: number) => send({ type: 'dismissNotice', id }),
      setVolume: (volume: number) => setAudio((a) => ({ ...a, volume, isMuted: volume === 0 })),
      toggleMute: () =>
        setAudio((a) => {
          const nextMuted = !(a.isMuted || a.volume === 0);
          if (!nextMuted && a.volume === 0) return { ...a, volume: 0.5, isMuted: false };
          return { ...a, isMuted: nextMuted };
        }),
      setEqGain: (band: number, gainDb: number) =>
        setAudio((a) => {
          const eqGains = [...a.eqGains];
          eqGains[band] = gainDb;
          return { ...a, eqGains };
        }),
      resetEq: () => setAudio((a) => ({ ...a, eqGains: a.eqGains.map(() => 0) })),
    };
  }, [clock, send, store]);

  /* ------------------------------------ stream callbacks ------------------------------------- */

  const recoverFromStreamError = React.useCallback(
    async (code: number) => {
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      const plan = planStreamErrorRecovery(store.getState(), { code, online });
      if (!plan) return;
      if (plan.kind === 'waitForNetwork') {
        send({ type: 'networkLost' });
        return;
      }
      if (plan.kind === 'findAlternate') {
        try {
          // Some uploads cannot be played outside youtube.com: look for another upload of the song
          const alternate = pickAlternateUpload(await searchTracks(plan.query), plan.tried);
          if (store.getState().activeTrackId !== plan.trackId) return;
          if (
            alternate &&
            send({
              type: 'alternateVideoFound',
              trackId: plan.trackId,
              videoId: alternate.videoId,
              durationMs: alternate.durationMs,
            })
          ) {
            return;
          }
        } catch {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            send({ type: 'networkLost' });
            return;
          }
        }
        if (store.getState().activeTrackId !== plan.trackId) return;
      }
      send({ type: 'trackUnplayable', trackId: plan.trackId, random: Math.random() });
    },
    [send, store]
  );

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
        send({ type: 'trackEnded', trackId: store.getState().activeTrackId, random: Math.random() });
      },
      onError: (code: number) => {
        void recoverFromStreamError(code);
      },
      onSeekHandled: (token: number) => {
        send({ type: 'seekHandled', token });
      },
      onExternalPlayPause: (playing: boolean) => {
        send({ type: 'setPlaying', playing });
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
    setStreamStart((prev) => (prev.trackId ? { ...prev, trackId: '', positionMs: 0 } : prev));
  }, [clock, state.activeTrackId]);

  // Seeks (and restarts) move the clock at once; local songs have no stream to confirm them
  const seekToken = state.seekRequest?.token;
  React.useEffect(() => {
    const request = store.getState().seekRequest;
    if (!request) return;
    clock.setPositionMs(request.ms);
    if (!selectActiveTrack(store.getState())?.isLiveInnerTube) {
      send({ type: 'seekHandled', token: request.token });
    }
  }, [clock, seekToken, send, store]);

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

  // A live stream stuck loading / buffering for 8 s while offline waits for the network. An
  // `offline` event alone (a blip while the player plays from its buffer) changes nothing.
  const stalledSinceRef = React.useRef<number | null>(null);
  const checkStall = React.useCallback(() => {
    const current = store.getState();
    const since = stalledSinceRef.current;
    if (since === null || current.network.waiting) return;
    const wait = shouldWaitForNetworkAfterStall({
      isPlaying: current.isPlaying,
      isLive: !!selectActiveTrack(current)?.isLiveInnerTube,
      streamStatus: current.streamStatus,
      stalledForMs: Date.now() - since,
      online: typeof navigator === 'undefined' || navigator.onLine !== false,
    });
    if (wait) send({ type: 'networkLost' });
  }, [send, store]);

  const isStalled = state.isPlaying && isLive && (state.streamStatus === 'loading' || state.streamStatus === 'buffering');
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

  // Only a live stream can wait for the network
  React.useEffect(() => {
    if (networkWaiting && !isLive) send({ type: 'networkRestored' });
  }, [isLive, networkWaiting, send]);

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

  React.useEffect(
    () =>
      clock.subscribe(() => {
        if (store.getState().isPlaying && isPositionSaveDue(lastSavedAtRef.current, Date.now())) saveNow();
      }),
    [clock, saveNow, store]
  );

  React.useEffect(() => {
    if (!state.isPlaying) saveNow();
  }, [state.isPlaying, saveNow]);

  React.useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', saveNow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', saveNow);
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

  /* --------------------------------- local synth engine -------------------------------------- */

  // Browsers only allow audio after a user gesture: unlock the Web Audio context on the first one
  React.useEffect(() => {
    const unlock = () => sharedAudioEngine.unlock();
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  React.useEffect(() => {
    sharedAudioEngine.setVolume(audio.isMuted ? 0 : audio.volume);
  }, [audio.isMuted, audio.volume]);

  React.useEffect(() => {
    audio.eqGains.forEach((gain, band) => sharedAudioEngine.setEqBandGain(band, gain));
  }, [audio.eqGains]);

  const synthKey =
    activeTrack && !isLive
      ? `${activeTrack.id}|${activeTrack.rootFreqHz}|${activeTrack.bpm}|${activeTrack.chordIntervals.join(',')}`
      : '';
  React.useEffect(() => {
    if (!state.isPlaying || !synthKey) {
      sharedAudioEngine.stop();
      return;
    }
    const track = selectActiveTrack(store.getState());
    if (!track) return;
    sharedAudioEngine.startTrack(track.rootFreqHz, track.chordIntervals, track.bpm, 1.0);
    // Local songs are clocked here (live songs are clocked by the stream itself)
    const timer = window.setInterval(() => {
      const current = selectActiveTrack(store.getState());
      if (!current) return;
      const next = clock.getPositionMs() + SYNTH_TICK_MS;
      if (next >= current.durationMs) {
        send({ type: 'trackEnded', trackId: current.id, random: Math.random() });
      } else {
        clock.setPositionMs(next);
      }
    }, SYNTH_TICK_MS);
    return () => {
      window.clearInterval(timer);
      sharedAudioEngine.stop();
    };
  }, [clock, send, state.isPlaying, store, synthKey]);

  /* ----------------------------------------- output ------------------------------------------ */

  const stream: StreamBinding | null =
    activeTrack && isLive
      ? {
          videoId: activeTrack.videoId,
          isPlaying: state.isPlaying,
          volume: audio.volume,
          isMuted: audio.isMuted,
          seekRequest: state.seekRequest,
          initialPositionMs: streamStart.trackId === activeTrack.id ? streamStart.positionMs : 0,
          retryNonce: streamStart.nonce,
          ...streamCallbacks,
        }
      : null;

  return {
    state,
    activeTrack,
    isLive,
    isStreamLoading: selectIsStreamLoading(state),
    isLoadingRecommendations,
    audio,
    clock,
    actions,
    stream,
  };
}

