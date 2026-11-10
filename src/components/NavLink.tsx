import React from 'react';
import { useAppActions } from '../app/AppActionsContext';
import { formatRoute, type Route } from '../app/router';

interface NavLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: Route;
  current?: boolean;
}

/** A real link (`href="#/…"`, so it can be opened in a new tab) that navigates through the router. */
export function NavLink({ to, current = false, onClick, children, ...rest }: NavLinkProps) {
  const { go } = useAppActions();
  return (
    <a
      {...rest}
      href={formatRoute(to)}
      aria-current={current ? 'page' : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}
