import React from 'react';
import { Radio } from 'lucide-react';
import { countRender } from '../utils/renderProbe';

export type LibraryFilter = 'ALL' | 'LIKED' | 'CACHED';

interface AppHeaderProps {
  libraryFilter: LibraryFilter;
  onLibraryFilterChange: (filter: LibraryFilter) => void;
  onHome: () => void;
  autoplayRadio: boolean;
  onToggleAutoplayRadio: () => void;
}

const FILTERS = [
  { id: 'ALL', label: 'Home & Music', mobileLabel: 'Home' },
  { id: 'LIKED', label: 'Liked Songs', mobileLabel: 'Liked' },
  { id: 'CACHED', label: 'Downloaded', mobileLabel: 'Saved' },
] as const;

/** Sticky top bar: brand · library filters · Autoplay Radio toggle. */
export const AppHeader = React.memo(function AppHeader({
  libraryFilter,
  onLibraryFilterChange,
  onHome,
  autoplayRadio,
  onToggleAutoplayRadio,
}: AppHeaderProps) {
  countRender('AppHeader');
  return (
    <header
      data-chrome="top"
      className="sticky top-0 z-30 bg-[#09090B]/95 backdrop-blur-md border-b border-white/5 pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
    >
      <div className="h-14 short:h-12 sm:h-16 px-3 max-[359px]:px-2 sm:px-6 flex items-center justify-between gap-2 max-[359px]:gap-1 sm:gap-4">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            onHome();
          }}
          className="flex items-center gap-2 text-white font-display font-extrabold text-base sm:text-lg tracking-tight shrink-0 whitespace-nowrap rounded-md"
        >
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <span>Metrolist</span>
        </a>

        <nav aria-label="Primary Library Filter Navigation" className="flex items-center gap-0.5 sm:gap-2 overflow-x-auto no-scrollbar min-w-0">
          {FILTERS.map((item) => {
            const active = libraryFilter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => onLibraryFilterChange(item.id)}
                className={`tap-target px-2 max-[359px]:px-1.5 sm:px-3.5 py-2 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 border-b-2 ${
                  active ? 'border-emerald-400 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <span className="sm:hidden">{item.mobileLabel}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          aria-pressed={autoplayRadio}
          aria-label={`Autoplay Radio ${autoplayRadio ? 'on' : 'off'}`}
          onClick={onToggleAutoplayRadio}
          className={`tap-target inline-flex items-center justify-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            autoplayRadio ? 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
          title="Keep the music going with similar songs when your queue runs out"
        >
          <Radio className="w-3.5 h-3.5 max-[359px]:hidden" />
          <span className="hidden sm:inline">Autoplay Radio:</span>
          <span>{autoplayRadio ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </header>
  );
});
