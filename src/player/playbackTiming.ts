/**
 * Pure tracker behind the "time to sound" line of the debug log: how long the listener waits between
 * asking for sound (a new song, or a resume) and the stream reporting `playing`. The clock is injected.
 */
import type { PlayerState } from './playerCore';

/** A measurement older than this is dropped (the network was down, the song was blocked, ...). */
export const MAX_TIME_TO_SOUND_MS = 60_000;

type Label = 'new song' | 'resume';

interface Pending {
  trackId: string;
  label: Label;
  startedAt: number;
  /** A stream that still says `playing` from before the request must not complete it. */
  sawNotPlaying: boolean;
}

export interface PlaybackTimingTracker {
  /** Feed every state change; returns a log line when a measurement completes, else null. */
  observe: (previous: PlayerState | null, next: PlayerState) => string | null;
}

export function formatTimeToSound(ms: number, label: Label): string {
  return `time to sound: ${Math.round(ms)} ms (${label})`;
}

export function createPlaybackTimingTracker(now: () => number): PlaybackTimingTracker {
  let pending: Pending | null = null;
  return {
    observe: (previous, next) => {
      const trackId = next.activeTrackId;
      if (trackId === null || !next.isPlaying) {
        pending = null;
        return null;
      }
      if (previous === null || previous.activeTrackId !== trackId) {
        pending = { trackId, label: 'new song', startedAt: now(), sawNotPlaying: next.streamStatus !== 'playing' };
      } else if (!previous.isPlaying) {
        pending = { trackId, label: 'resume', startedAt: now(), sawNotPlaying: next.streamStatus !== 'playing' };
      }
      if (!pending || pending.trackId !== trackId) return null;
      if (next.streamStatus !== 'playing') {
        pending.sawNotPlaying = true;
        if (now() - pending.startedAt > MAX_TIME_TO_SOUND_MS) pending = null;
        return null;
      }
      if (!pending.sawNotPlaying) return null;
      const elapsed = now() - pending.startedAt;
      const label = pending.label;
      pending = null;
      return elapsed > MAX_TIME_TO_SOUND_MS ? null : formatTimeToSound(elapsed, label);
    },
  };
}
