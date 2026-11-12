import React from 'react';
import { useAppActions } from '../app/AppActionsContext';
import { formatRoute, type NavigationIntent, type Route } from '../app/router';
import type { TabName } from '../app/tabMemory';

interface NavLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: Route;
  current?: boolean;
  /** A main tab: the press follows the tab rules (last location, re-tap → root / top). */
  tab?: TabName;
  /** How the page is entered (default `push`: a fresh visit at the top; `tab` restores its scroll). */
  intent?: NavigationIntent;
}

/** A real link (`href="#/…"`, so it can be opened in a new tab) that navigates through the router. */
export function NavLink({ to, current = false, tab, intent, onClick, children, ...rest }: NavLinkProps) {
  const { go, goTab } = useAppActions();
  return (
    <a
      {...rest}
      className={`press ${rest.className ?? ''}`}
      href={formatRoute(to)}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (tab) goTab(tab);
        else go(to, intent ? { intent } : undefined);
      }}
    >
      {children}
    </a>
  );
}
