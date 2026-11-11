import React from 'react';
import { House, LibraryBig, Search } from 'lucide-react';
import { getTabMemory } from '../app/navigationMemory';
import type { Route } from '../app/router';
import { tabOf, tabTarget, type TabName } from '../app/tabMemory';
import { countRender } from '../utils/renderProbe';
import { NavLink } from './NavLink';

export const MAIN_TABS = [
  { label: 'Home', icon: House, tab: 'home' },
  { label: 'Search', icon: Search, tab: 'search' },
  { label: 'Library', icon: LibraryBig, tab: 'library' },
] as const satisfies ReadonlyArray<{ label: string; icon: typeof House; tab: TabName }>;

/**
 * Phones and tablets: Home · Search · Library tabs along the bottom edge. Each tab links to where a
 * press leads: its last location, or its root when it is the current tab (`tabMemory.ts`).
 */
export const BottomNav = React.memo(function BottomNav({ route }: { route: Route }) {
  countRender('BottomNav');
  const memory = getTabMemory();
  return (
    <nav aria-label="Main" className="h-[var(--nav-h)] grid grid-cols-3">
      {MAIN_TABS.map(({ label, icon: Icon, tab }) => {
        const current = tabOf(route) === tab;
        return (
          <NavLink
            key={label}
            to={tabTarget(memory, route, tab)}
            tab={tab}
            current={current}
            className={`flex flex-col short:flex-row items-center justify-center gap-1 short:gap-2 text-[11px] short:text-xs font-medium transition-colors ${
              current ? 'text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Icon className="w-6 h-6 short:w-5 short:h-5" strokeWidth={current ? 2.4 : 1.8} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
});
