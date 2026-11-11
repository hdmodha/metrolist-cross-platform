/**
 * Simulated YouTube IFrame Player API. The test fixture serves it in place of
 * `https://www.youtube.com/iframe_api`, so the app's real `YouTubeStreamBridge` runs against it.
 *
 * Tests steer it through `window.__yt` (set `blocked` / `errorIds` / `durations` / `speed` before
 * the app loads with `FakeYouTubeOptions`):
 * - `current().__debug()` → `{ state, time, videoId, destroyed }` of the newest player
 * - `instances` → every player ever created (a re-created stream shows up as a new instance)
 * - `loaded` → every video id a player was created with, loaded or cued
 * - `__userTap()` (a tap on the revealed player), `__externalPause()` (OS media key), `__stall()` (buffering forever)
 * - `lateErrorOnSwitch = true`: the next switch to another video first delivers an error 150 for the
 *   video it switches away from (like a real player whose error was still on its way), then plays
 * - `getVideoData()` names the video the player last reported, like the real API (it lags behind a
 *   `loadVideoById` until the player has taken the new video on)
 */

export interface FakeYouTubeOptions {
  /** Autoplay is refused until the player itself is tapped (iOS Safari style). */
  blocked?: boolean;
  /** Video ids that raise error 150 ("cannot be embedded"); `'*'` makes every video fail. */
  errorIds?: string[];
  /** Duration in seconds per video id (default 200). */
  durations?: Record<string, number>;
  /** Playback speed multiplier. */
  speed?: number;
  /** How long a new player takes to become ready (default 60 ms; slow networks take seconds). */
  readyDelayMs?: number;
  /**
   * URLs every new player requests from inside its iframe, like the real player's ad / stats
   * requests (the desktop suite checks which ones the ad blocker cancels). Outcomes land in `probes`.
   */
  probeUrls?: string[];
  /** The next switch to another video first raises error 150 for the previous one (see above). */
  lateErrorOnSwitch?: boolean;
}

export interface FakePlayerDebug {
  state: number;
  time: number;
  videoId: string;
  destroyed: boolean;
}

export interface FakePlayer {
  __debug: () => FakePlayerDebug;
  __userTap: () => void;
  __externalPause: () => void;
  __stall: () => void;
  seekTo: (seconds: number) => void;
  getDuration: () => number;
  loadVideoById: (id: string, startSeconds?: number) => void;
}

export interface FakeYouTubeControl extends Required<FakeYouTubeOptions> {
  /** `ok` / `failed` per probe URL (the newest player's request). */
  probes: Record<string, 'ok' | 'failed'>;
  instances: FakePlayer[];
  /** Every video id a player was created with, loaded or cued, in order. */
  loaded: string[];
  current: () => FakePlayer | undefined;
}

interface PlayerOptions {
  videoId: string;
  playerVars?: Record<string, string | number>;
  events: {
    onReady?: (ev: { target: unknown }) => void;
    onStateChange?: (ev: { data: number; target: unknown }) => void;
    onError?: (ev: { data: number; target?: unknown }) => void;
    onPlaybackQualityChange?: (ev: { data: string; target?: unknown }) => void;
  };
}

/** Runs in the page (serialized with `toString`): keep it self-contained. */
export function installFakeYouTubeApi(): void {
  const w = window as unknown as {
    __yt?: Partial<FakeYouTubeControl>;
    YT?: unknown;
    onYouTubeIframeAPIReady?: () => void;
  };
  const ctl = (w.__yt = w.__yt || {}) as FakeYouTubeControl;
  ctl.instances = [];
  ctl.loaded = [];
  ctl.speed = ctl.speed || 1;
  ctl.blocked = !!ctl.blocked;
  ctl.errorIds = ctl.errorIds || [];
  ctl.durations = ctl.durations || {};
  ctl.probeUrls = ctl.probeUrls || [];
  ctl.readyDelayMs = ctl.readyDelayMs || 60;
  ctl.lateErrorOnSwitch = !!ctl.lateErrorOnSwitch;
  ctl.probes = {};

  function Player(this: FakePlayer & Record<string, unknown>, el: HTMLElement, opts: PlayerOptions) {
    const self = this;
    let state = -1;
    let time = (opts.playerVars && Number(opts.playerVars.start)) || 0;
    let videoId = opts.videoId;
    /** What the player has "delivered" about its video so far (`getVideoData`). */
    let reportedVideoId = videoId;
    ctl.loaded.push(videoId);
    let destroyed = false;
    let stalled = false;
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-fake-yt', '1');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    el.replaceWith(iframe);
    const duration = () => ctl.durations[videoId] || 200;
    const setState = (next: number) => {
      if (destroyed) return;
      state = next;
      if (opts.events.onStateChange) opts.events.onStateChange({ data: next, target: self });
      if (next === 1 && opts.events.onPlaybackQualityChange) {
        opts.events.onPlaybackQualityChange({ data: 'tiny', target: self });
      }
    };
    const start = () => {
      if (ctl.blocked || destroyed) return;
      if (ctl.errorIds.indexOf(videoId) !== -1 || ctl.errorIds.indexOf('*') !== -1) {
        if (opts.events.onError) opts.events.onError({ data: 150, target: self });
        return;
      }
      setState(3);
      setTimeout(() => {
        if (state === 3 && !stalled) setState(1);
      }, 80);
    };
    const readArgs = (id: unknown, startSeconds?: number): [string, number] =>
      id && typeof id === 'object'
        ? [String((id as { videoId: string }).videoId), Number((id as { startSeconds?: number }).startSeconds) || 0]
        : [String(id), Number(startSeconds) || 0];
    self.loadVideoById = (id: unknown, startSeconds?: number) => {
      const previous = videoId;
      [videoId, time] = readArgs(id, startSeconds);
      ctl.loaded.push(videoId);
      stalled = false;
      const takeOn = () => {
        reportedVideoId = videoId;
        setState(-1);
        setTimeout(start, 30);
      };
      if (ctl.lateErrorOnSwitch && previous !== videoId) {
        ctl.lateErrorOnSwitch = false;
        // The previous video's error arrives first: the player still reports that video
        setTimeout(() => {
          if (destroyed) return;
          if (opts.events.onError) opts.events.onError({ data: 150, target: self });
          takeOn();
        }, 0);
        return;
      }
      takeOn();
    };
    self.cueVideoById = (id: unknown, startSeconds?: number) => {
      [videoId, time] = readArgs(id, startSeconds);
      reportedVideoId = videoId;
      ctl.loaded.push(videoId);
      setState(5);
    };
    self.getVideoData = () => ({ video_id: reportedVideoId });
    self.playVideo = () => {
      if (state === 1 || state === 3) return;
      if (state === 0) time = 0;
      if (state === 2) {
        if (!ctl.blocked) setState(1);
        return;
      }
      start();
    };
    self.pauseVideo = () => {
      if (state === 1 || state === 3) setState(2);
    };
    self.seekTo = (seconds: number) => {
      time = Math.max(0, Math.min(seconds, duration()));
      if (state === 0) setState(1);
    };
    self.setVolume = () => undefined;
    self.mute = () => undefined;
    self.unMute = () => undefined;
    self.getCurrentTime = () => time;
    self.getDuration = () => duration();
    self.getPlayerState = () => state;
    self.getPlaybackQuality = () => 'tiny';
    self.destroy = () => {
      destroyed = true;
      clearInterval(timer);
      iframe.remove();
    };
    self.__debug = () => ({ state, time, videoId, destroyed });
    self.__userTap = () => {
      ctl.blocked = false;
      if (state !== 1) start();
    };
    self.__externalPause = () => setState(2);
    self.__stall = () => {
      stalled = true;
      setState(3);
    };
    const timer = setInterval(() => {
      if (state === 1) {
        time += 0.1 * ctl.speed;
        if (time >= duration()) {
          time = duration();
          setState(0);
        }
      }
    }, 100);
    ctl.instances.push(self);
    const frameWindow = iframe.contentWindow as (Window & typeof globalThis) | null;
    for (const url of ctl.probeUrls) {
      // From the player's own frame, like the real player's requests (opaque `no-cors` answers count as ok)
      (frameWindow || window).fetch(url, { mode: 'no-cors', cache: 'no-store' }).then(
        () => {
          ctl.probes[url] = 'ok';
        },
        () => {
          ctl.probes[url] = 'failed';
        }
      );
    }
    setTimeout(() => {
      if (destroyed) return;
      if (opts.events.onReady) opts.events.onReady({ target: self });
      // Autoplay, unless onReady already told the player what to do (cue, play, load)
      if (opts.playerVars && opts.playerVars.autoplay && state === -1) start();
    }, ctl.readyDelayMs);
  }

  ctl.current = () => {
    const live = ctl.instances.filter((p) => !p.__debug().destroyed);
    return live[live.length - 1];
  };
  w.YT = { Player };
  if (w.onYouTubeIframeAPIReady) w.onYouTubeIframeAPIReady();
}

/** The script body served for `https://www.youtube.com/iframe_api`. */
export const FAKE_YOUTUBE_IFRAME_API = `(${installFakeYouTubeApi.toString()})();`;
