import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface ShelfProps {
  title: string;
  /** Small line above the title ("Because you listened to"). */
  eyebrow?: string;
  busy?: boolean;
  children: React.ReactNode;
}

let shelfCounter = 0;

/** A titled, horizontally scrolling row of cards (arrow buttons on wide screens). */
export function Shelf({ title, eyebrow, busy = false, children }: ShelfProps) {
  const [id] = React.useState(() => `shelf-${++shelfCounter}`);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const scroll = (direction: -1 | 1) => {
    const list = listRef.current;
    if (!list) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    list.scrollBy({ left: direction * list.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' });
  };
  const arrow = 'tap-target hidden lg:inline-flex w-8 h-8 items-center justify-center rounded-full bg-white/[0.07] hover:bg-white/15 text-zinc-300 hover:text-white cursor-pointer';
  return (
    <section aria-labelledby={id} aria-busy={busy} className="min-w-0">
      <div className="flex items-end justify-between gap-3 mb-3 lg:mb-1">
        <div className="min-w-0">
          {eyebrow && <p className="text-xs font-medium text-zinc-400 truncate">{eyebrow}</p>}
          <h2 id={id} className="text-xl short:text-lg lg:text-2xl font-bold tracking-tight text-white truncate">
            {title}
          </h2>
        </div>
        <div className="flex gap-2 shrink-0">
          <button type="button" aria-label={`Scroll ${title} back`} onClick={() => scroll(-1)} className={arrow}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" aria-label={`Scroll ${title} forward`} onClick={() => scroll(1)} className={arrow}>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <ul
        ref={listRef}
        className="flex gap-4 lg:gap-0 overflow-x-auto no-scrollbar snap-x snap-mandatory lg:snap-none -mx-[var(--page-px)] px-[var(--page-px)] lg:-mx-3 lg:px-0 scroll-px-[var(--page-px)]"
      >
        {children}
      </ul>
    </section>
  );
}
