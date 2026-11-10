import React from 'react';
import { Download, Heart } from 'lucide-react';
import type { Route } from '../app/router';
import { countRender } from '../utils/renderProbe';
import { MAIN_TABS } from './BottomNav';
import { NavLink } from './NavLink';

interface SidebarProps {
  route: Route;
  likedCount: number;
  downloadedCount: number;
}

export const songCount = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`;

/** Desktop: brand, Home / Search / Library, then the Liked Songs and Downloads shortcuts. */
export const Sidebar = React.memo(function Sidebar({ route, likedCount, downloadedCount }: SidebarProps) {
  countRender('Sidebar');
  const shortcuts = [
    { label: 'Liked Songs', to: { name: 'liked' } as Route, count: likedCount, icon: <Heart className="w-5 h-5 fill-current" />, tile: 'from-indigo-500 to-emerald-400' },
    { label: 'Downloads', to: { name: 'downloads' } as Route, count: downloadedCount, icon: <Download className="w-5 h-5" />, tile: 'from-emerald-600 to-teal-400' },
  ];
  return (
    <aside className="hidden lg:flex fixed left-0 top-0 bottom-[var(--bar-h)] w-64 flex-col gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pl-[max(0.5rem,env(safe-area-inset-left))] z-30">
      <div className="rounded-lg bg-zinc-900/80 px-3 py-4">
        <div className="flex items-center gap-2 px-3 pb-4 text-white font-display font-extrabold text-lg tracking-tight">
          <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
          <span>Metrolist</span>
        </div>
        <nav aria-label="Main">
          <ul className="space-y-1">
            {MAIN_TABS.map(({ label, icon: Icon, to }) => {
              const current = route.name === to.name;
              return (
                <li key={label}>
                  <NavLink
                    to={to}
                    current={current}
                    className={`flex items-center gap-4 px-3 py-2 rounded-md text-[15px] font-semibold transition-colors ${
                      current ? 'text-white bg-white/[0.08]' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    <Icon className="w-6 h-6" strokeWidth={current ? 2.4 : 1.8} aria-hidden="true" />
                    <span>{label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
      <div className="rounded-lg bg-zinc-900/80 p-2 flex-1 min-h-0">
        <nav aria-label="Your Library">
          <ul className="space-y-1">
            {shortcuts.map((item) => {
              const current = route.name === item.to.name;
              return (
                <li key={item.label}>
                  <NavLink
                    to={item.to}
                    current={current}
                    className={`flex items-center gap-3 p-2 rounded-md transition-colors ${current ? 'bg-white/[0.1]' : 'hover:bg-white/[0.06]'}`}
                  >
                    <span aria-hidden="true" className={`w-12 h-12 rounded-md bg-gradient-to-br ${item.tile} text-white flex items-center justify-center shrink-0`}>
                      {item.icon}
                    </span>
                    <span className="min-w-0">
                      <span className={`block truncate text-[15px] font-semibold ${current ? 'text-emerald-400' : 'text-white'}`}>{item.label}</span>
                      <span className="block truncate text-[13px] text-zinc-400">{songCount(item.count)}</span>
                    </span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </aside>
  );
});
