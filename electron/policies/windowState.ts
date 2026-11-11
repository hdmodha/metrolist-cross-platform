/**
 * The desktop window's size, position and maximised state, saved in `userData` and clamped to a
 * visible display on restore (a monitor may have been unplugged or rearranged since).
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Rect;
  maximized: boolean;
}

export const MIN_SIZE = { width: 360, height: 560 } as const;
export const DEFAULT_SIZE = { width: 1280, height: 820 } as const;
/** A window counts as visible on a display when at least this much of it is on that display. */
const MIN_VISIBLE = { width: 100, height: 50 } as const;
const MAX_COORDINATE = 100_000;
const MAX_SIZE = 16_384;

function isNumberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/** Validates what was read back from disk; anything unexpected is `null` (defaults are used). */
export function parseWindowState(raw: unknown): WindowState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { bounds, maximized } = raw as { bounds?: unknown; maximized?: unknown };
  if (typeof maximized !== 'boolean' || typeof bounds !== 'object' || bounds === null) return null;
  const { x, y, width, height } = bounds as Record<string, unknown>;
  if (
    !isNumberIn(x, -MAX_COORDINATE, MAX_COORDINATE) ||
    !isNumberIn(y, -MAX_COORDINATE, MAX_COORDINATE) ||
    !isNumberIn(width, 1, MAX_SIZE) ||
    !isNumberIn(height, 1, MAX_SIZE)
  ) {
    return null;
  }
  return { bounds: { x, y, width, height }, maximized };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

function fitSize(width: number, height: number, area: Rect): { width: number; height: number } {
  return {
    width: Math.round(clamp(width, MIN_SIZE.width, area.width)),
    height: Math.round(clamp(height, MIN_SIZE.height, area.height)),
  };
}

function centred(width: number, height: number, area: Rect): WindowState {
  const size = fitSize(width, height, area);
  return {
    bounds: {
      x: Math.round(area.x + (area.width - size.width) / 2),
      y: Math.round(area.y + (area.height - size.height) / 2),
      ...size,
    },
    maximized: false,
  };
}

/**
 * Where to open the window. `workAreas` are the displays' work areas (without menu bar / taskbar),
 * `primary` the primary display's. A saved window that is still visible stays on the display it mostly
 * covers, moved and shrunk to fit inside it; otherwise it is centred on the primary display.
 */
export function restoreWindowState(saved: WindowState | null, workAreas: readonly Rect[], primary: Rect): WindowState {
  if (!saved) return centred(DEFAULT_SIZE.width, DEFAULT_SIZE.height, primary);

  let best: Rect | null = null;
  let bestArea = 0;
  for (const area of workAreas) {
    const o = overlap(saved.bounds, area);
    if (o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height && o.width * o.height > bestArea) {
      best = area;
      bestArea = o.width * o.height;
    }
  }
  if (!best) return { ...centred(saved.bounds.width, saved.bounds.height, primary), maximized: saved.maximized };

  const size = fitSize(saved.bounds.width, saved.bounds.height, best);
  return {
    bounds: {
      x: Math.round(clamp(saved.bounds.x, best.x, best.x + best.width - size.width)),
      y: Math.round(clamp(saved.bounds.y, best.y, best.y + best.height - size.height)),
      ...size,
    },
    maximized: saved.maximized,
  };
}
