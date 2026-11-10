import React from 'react';
import { createPortal } from 'react-dom';
import { EllipsisVertical } from 'lucide-react';
import { nextMenuIndex, placeMenu } from '../utils/menuNavigation';

export interface TrackMenuItem {
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

interface TrackMenuProps {
  trackTitle: string;
  items: TrackMenuItem[];
  /** Extra classes for the trigger button. */
  className?: string;
}

/** Fixed app chrome (sticky header, now-playing bar) the menu must not slide under. */
function readChromeInsets(): { top: number; bottom: number } {
  const header = document.querySelector('[data-chrome="top"]');
  const footer = document.querySelector('[data-chrome="bottom"]');
  const top = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  const bottom = footer ? Math.max(0, window.innerHeight - footer.getBoundingClientRect().top) : 0;
  return { top, bottom };
}

let menuCounter = 0;

/**
 * Per-track "More" menu (WAI-ARIA menu button): arrow keys / Home / End move between items,
 * Escape or a tap outside closes it, and focus returns to the trigger after a keyboard close or a
 * choice. Rendered in a portal with fixed positioning so cards, the bottom bar and the screen edges
 * never clip it.
 */
export const TrackMenu = React.memo(function TrackMenu({ trackTitle, items, className = '' }: TrackMenuProps) {
  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [menuId] = React.useState(() => `track-menu-${++menuCounter}`);

  const close = React.useCallback((returnFocus: boolean) => {
    setOpen(false);
    setPosition(null);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  /** Places the menu next to the trigger; returns false when the trigger is no longer visible. */
  const reposition = React.useCallback((): boolean => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return false;
    const triggerBox = trigger.getBoundingClientRect();
    const insets = readChromeInsets();
    if (triggerBox.bottom < insets.top || triggerBox.top > window.innerHeight - insets.bottom) return false;
    const placed = placeMenu({
      trigger: triggerBox,
      menu: { width: menu.offsetWidth, height: menu.scrollHeight },
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      insets,
    });
    setPosition({ top: placed.top, left: placed.left, maxHeight: placed.maxHeight });
    return true;
  }, []);

  // Place the menu once it is in the DOM (its size is known), then focus the first item
  React.useLayoutEffect(() => {
    if (!open) return;
    reposition();
    itemRefs.current[0]?.focus({ preventScroll: true });
  }, [open, reposition]);

  // An outside tap closes the menu; scrolling or resizing keeps it next to its trigger
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current?.contains(e.target as Node | null)) return;
      if (!reposition()) close(false);
    };
    const onResize = () => {
      if (!reposition()) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close, reposition]);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      close(true);
      return;
    }
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next = nextMenuIndex(current, e.key, items.length);
    if (next !== null) {
      e.preventDefault();
      itemRefs.current[next]?.focus();
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(true);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`More options for ${trackTitle}`}
        onClick={(e) => {
          e.stopPropagation();
          if (open) close(false);
          else setOpen(true);
        }}
        onKeyDown={onTriggerKeyDown}
        className={`tap-target inline-flex items-center justify-center rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0 ${className}`}
      >
        <EllipsisVertical className="w-4 h-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label={`Options for ${trackTitle}`}
            onKeyDown={onMenuKeyDown}
            onClick={(e) => e.stopPropagation()}
            style={
              position
                ? { top: position.top, left: position.left, maxHeight: position.maxHeight }
                : { top: 0, left: 0, opacity: 0 }
            }
            className="fixed z-[60] w-56 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-zinc-900 shadow-2xl py-1.5"
          >
            {items.map((item, idx) => (
              <button
                key={item.label}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
                className="tap-target w-full flex items-center gap-3 px-3.5 py-2.5 text-left text-sm text-zinc-200 hover:bg-white/10 focus-visible:bg-white/10 cursor-pointer"
              >
                <span className="text-zinc-400 shrink-0" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
});
