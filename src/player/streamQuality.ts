/**
 * Video quality of the hidden YouTube player. Only the audio is used, but the player streams video
 * as well; YouTube caps the resolution by the player's size in device pixels, and a 1x1 player was
 * seen streaming 480p ("large"). `low` gives the hidden player a ~320x180 device-pixel box (just
 * above 144p), asks for `small` and logs what happened; `auto` is the old 1x1 behaviour.
 * Pure; the storage is the same `KeyValueStorage` the other stores use.
 */
import type { KeyValueStorage } from '../utils/persistence';

export type StreamQualityMode = 'low' | 'auto';

export const STREAM_QUALITY_KEY = 'metrolist.streamQuality.v1';
export const DEFAULT_STREAM_QUALITY_MODE: StreamQualityMode = 'low';

const TARGET_DEVICE_WIDTH = 320;
const TARGET_DEVICE_HEIGHT = 180;

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readStreamQualityMode(storage: KeyValueStorage | null = defaultStorage()): StreamQualityMode {
  try {
    const raw = storage?.getItem(STREAM_QUALITY_KEY);
    return raw === 'auto' || raw === 'low' ? raw : DEFAULT_STREAM_QUALITY_MODE;
  } catch {
    return DEFAULT_STREAM_QUALITY_MODE;
  }
}

export function writeStreamQualityMode(mode: StreamQualityMode, storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(STREAM_QUALITY_KEY, mode);
  } catch {
    // storage full / blocked: the mode just applies to this session's reads
  }
}

/** The CSS size of the hidden player's box (`low`: about 320x180 device pixels, 16:9). */
export function hiddenPlayerCssSize(mode: StreamQualityMode, devicePixelRatio: number): { width: number; height: number } {
  if (mode === 'auto') return { width: 1, height: 1 };
  const dpr = Number.isFinite(devicePixelRatio) ? Math.min(4, Math.max(1, devicePixelRatio)) : 1;
  return {
    width: Math.max(64, Math.round(TARGET_DEVICE_WIDTH / dpr)),
    height: Math.max(36, Math.round(TARGET_DEVICE_HEIGHT / dpr)),
  };
}

const ABOVE_TARGET = new Set(['medium', 'large', 'hd720', 'hd1080', 'hd1440', 'hd2160', 'highres']);

/** Whether a reported quality is above 240p (`small`), the target of the low mode. */
export function isAboveTarget(quality: string): boolean {
  return ABOVE_TARGET.has(quality);
}
