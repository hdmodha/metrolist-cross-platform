import React from 'react';
import { WifiOff } from 'lucide-react';

interface PlayerNoticesProps {
  notice: { id: number; message: string } | null;
  /** The stream is waiting for the network and will retry on its own. */
  waitingForNetwork: boolean;
}

/** Transient messages above the now-playing bar: queue changes, playback problems, connection state. */
export const PlayerNotices = React.memo(function PlayerNotices({ notice, waitingForNetwork }: PlayerNoticesProps) {
  if (!notice && !waitingForNetwork) return null;
  return (
    <div className="fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none bottom-[calc(7rem+env(safe-area-inset-bottom))] sm:bottom-[calc(5.75rem+env(safe-area-inset-bottom))]">
      {waitingForNetwork && (
        <div
          role="status"
          aria-live="assertive"
          className="max-w-md inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-300 text-zinc-950 text-xs sm:text-sm font-semibold shadow-2xl text-center"
        >
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Waiting for connection… retrying</span>
        </div>
      )}
      {notice && (
        <div role="status" aria-live="polite" className="max-w-md px-4 py-2.5 rounded-xl bg-zinc-100 text-zinc-950 text-xs sm:text-sm font-semibold shadow-2xl text-center">
          {notice.message}
        </div>
      )}
    </div>
  );
});
