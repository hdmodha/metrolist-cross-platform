import React from 'react';
import { House, LibraryBig, Search } from 'lucide-react';
import type { Route } from '../app/router';
import { countRender } from '../utils/renderProbe';
import { NavLink } from './NavLink';

export const MAIN_TABS = [
  { label: 'Home', icon: House, to: { name: 'home' } as Route, matches: (r: Route) => r.name === 'home' },
  { label: 'Search', icon: Search, to: { name: 'search', query: '' } as Route, matches: (r: Route) => r.name === 'search' },
  {
    label: 'Library',
    icon: LibraryBig,
    to: { name: 'library' } as Route,
    matches: (r: Route) => r.name === 'library' || r.name === 'liked' || r.name === 'downloads',
  },
] as const;

/** Phones and tablets: Home · Search · Library tabs along the bottom edge. */
export const BottomNav = React.memo(function BottomNav({ route }: { route: Route }) {
  countRender('BottomNav');
  return (
    <nav aria-label="Main" className="h-[var(--nav-h)] grid grid-cols-3">
      {MAIN_TABS.map(({ label, icon: Icon, to, matches }) => {
        const current = matches(route);
        return (
          <NavLink
            key={label}
            to={to}
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
