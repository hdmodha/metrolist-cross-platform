/** Pure helpers for pop-up menus: roving keyboard focus and on-screen placement. */

/** Index to focus after a navigation key, or `null` when the key is not a navigation key. */
export function nextMenuIndex(current: number, key: string, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Places a menu next to its trigger inside the visible area between the sticky header (`insets.top`)
 * and the fixed bottom bar (`insets.bottom`): below the trigger when it fits, otherwise above,
 * otherwise clamped with a smaller `maxHeight` (the menu then scrolls). Right-aligned with the
 * trigger and kept `margin` px away from the screen edges.
 */
export function placeMenu(options: {
  trigger: Box;
  menu: { width: number; height: number };
  viewport: { width: number; height: number };
  insets: { top: number; bottom: number };
  gap?: number;
  margin?: number;
}): { top: number; left: number; maxHeight: number; placement: 'below' | 'above' } {
  const { trigger, menu, viewport, insets } = options;
  const gap = options.gap ?? 4;
  const margin = options.margin ?? 8;

  const maxLeft = Math.max(margin, viewport.width - menu.width - margin);
  const left = Math.min(Math.max(trigger.right - menu.width, margin), maxLeft);

  const areaTop = insets.top + margin;
  const areaBottom = viewport.height - insets.bottom - margin;
  const spaceBelow = areaBottom - (trigger.bottom + gap);
  const spaceAbove = trigger.top - gap - areaTop;

  if (menu.height <= spaceBelow) {
    return { top: trigger.bottom + gap, left, maxHeight: menu.height, placement: 'below' };
  }
  if (menu.height <= spaceAbove) {
    return { top: trigger.top - gap - menu.height, left, maxHeight: menu.height, placement: 'above' };
  }
  const area = Math.max(0, areaBottom - areaTop);
  if (spaceBelow >= spaceAbove) {
    const maxHeight = Math.max(0, Math.min(menu.height, Math.max(spaceBelow, area)));
    const top = Math.max(areaTop, Math.min(trigger.bottom + gap, areaBottom - maxHeight));
    return { top, left, maxHeight, placement: 'below' };
  }
  const maxHeight = Math.max(0, Math.min(menu.height, Math.max(spaceAbove, area)));
  const top = Math.max(areaTop, trigger.top - gap - maxHeight);
  return { top, left, maxHeight, placement: 'above' };
}
