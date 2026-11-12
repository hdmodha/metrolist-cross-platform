import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
  /** Optional live-region role: `status` for a result, `alert` for a failure. */
  role?: 'status' | 'alert';
}

export function EmptyState({ icon, title, children, action, role }: EmptyStateProps) {
  return (
    <div role={role} className="flex flex-col items-center text-center px-6 py-12 short:py-6">
      <div className="w-16 h-16 rounded-full bg-white/8 text-zinc-400 flex items-center justify-center mb-4">{icon}</div>
      <h2 className="text-xl font-bold text-white">{title}</h2>
      <p className="mt-2 text-sm text-zinc-400 max-w-xs">{children}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="tap-target mt-5 px-6 py-2.5 rounded-full bg-white text-zinc-950 text-sm font-bold cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
