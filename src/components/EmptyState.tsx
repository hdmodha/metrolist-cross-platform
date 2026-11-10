import React from 'react';

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-12 short:py-6">
      <div className="w-16 h-16 rounded-full bg-white/[0.07] text-zinc-300 flex items-center justify-center mb-4">{icon}</div>
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <p className="mt-1.5 text-sm text-zinc-400 max-w-xs">{children}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="tap-target mt-5 px-6 py-2.5 rounded-full bg-white text-zinc-950 text-sm font-bold hover:scale-[1.03] active:scale-95 transition-transform cursor-pointer"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
