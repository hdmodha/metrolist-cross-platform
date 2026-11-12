import React from 'react';
import { WifiOff } from 'lucide-react';
import { EXIT_MS, usePresence } from '../app/usePresence';

interface NoticesProps {
  notice: { id: number; message: string } | null;
  /** The stream is waiting for the network and will retry on its own. */
  waitingForNetwork: boolean;
}

/** Transient messages above the docked player: queue changes, playback problems, connection state. */
export const Notices = React.memo(function Notices({ notice, waitingForNetwork }: NoticesProps) {
  // The last notice stays on screen while it fades out
  const lastNotice = React.useRef(notice);
  if (notice) lastNotice.current = notice;
  const toast = usePresence(notice !== null, EXIT_MS.toast);
  const banner = usePresence(waitingForNetwork, EXIT_MS.toast);
  const shown = notice ?? lastNotice.current;
  if (!banner.render && !(toast.render && shown)) return null;
  return (
    <div className="fixed inset-x-0 z-[75] flex flex-col items-center gap-2 px-4 pointer-events-none bottom-[calc(var(--chrome-bottom)+0.75rem)]">
      {banner.render && (
        <div
          role="status"
          aria-live="assertive"
          data-state={banner.state}
          className="toast max-w-md inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-300 text-zinc-950 text-sm font-semibold shadow-2xl"
        >
          <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Waiting for connection… retrying</span>
        </div>
      )}
      {toast.render && shown && (
        <div
          key={shown.id}
          role="status"
          aria-live="polite"
          data-state={toast.state}
          className="toast max-w-md px-4 py-2.5 rounded-xl bg-white text-zinc-950 text-sm font-semibold shadow-2xl text-center"
        >
          {shown.message}
        </div>
      )}
    </div>
  );
});
