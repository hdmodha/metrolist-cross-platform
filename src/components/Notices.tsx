import React from 'react';
import { WifiOff } from 'lucide-react';

interface NoticesProps {
  notice: { id: number; message: string } | null;
  /** The stream is waiting for the network and will retry on its own. */
  waitingForNetwork: boolean;
}

/** Transient messages above the docked player: queue changes, playback problems, connection state. */
export const Notices = React.memo(function Notices({ notice, waitingForNetwork }: NoticesProps) {
  if (!notice && !waitingForNetwork) return null;
  return (
    <div className="fixed inset-x-0 z-[75] flex flex-col items-center gap-2 px-4 pointer-events-none bottom-[calc(var(--chrome-bottom)+0.75rem)]">
      {waitingForNetwork && (
        <div
          role="status"
          aria-live="assertive"
          className="max-w-md inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-300 text-zinc-950 text-sm font-semibold shadow-2xl"
        >
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Waiting for connection… retrying</span>
        </div>
      )}
      {notice && (
        <div role="status" aria-live="polite" className="max-w-md px-4 py-2.5 rounded-lg bg-white text-zinc-950 text-sm font-semibold shadow-2xl text-center">
          {notice.message}
        </div>
      )}
    </div>
  );
});
