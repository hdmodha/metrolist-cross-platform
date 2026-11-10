import React from 'react';
import { ChevronDown, ListMusic } from 'lucide-react';
import { useAppActions } from '../app/AppActionsContext';
import type { MetrolistTrack } from '../data/track';
import type { PlaybackClock } from '../player/playbackClock';
import type { PlaySource } from '../player/playerCore';
import type { RepeatMode } from '../player/queueRules';
import { countRender } from '../utils/renderProbe';
import { Artwork } from './Artwork';
import { LikeButton, TransportControls } from './PlayerButtons';
import { QueueSheet } from './QueueSheet';
import { SeekBar } from './SeekBar';
import { TrackMenu } from './TrackMenu';
import { buildTrackMenuItems } from './trackMenuItems';

export const PLAY_SOURCE_LABELS: Record<PlaySource, string> = {
  home: 'Home',
  search: 'Search',
  liked: 'Liked Songs',
  downloads: 'Downloads',
  library: 'Your Library',
  radio: 'Radio',
};

/** Downward swipe that closes the view: this far, or a fast flick. */
const SWIPE_CLOSE_PX = 120;
const FLICK_MIN_PX = 40;
const FLICK_PX_PER_MS = 0.6;
const SWIPE_OUT_MS = 180;

interface NowPlayingProps {
  track: MetrolistTrack;
  clock: PlaybackClock;
  queue: MetrolistTrack[];
  isPlaying: boolean;
  isLoading: boolean;
  liked: boolean;
  downloaded: boolean;
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
  autoplayRadio: boolean;
  playingFrom: PlaySource | null;
  /** Open with the queue showing (desktop "Queue" button). */
  initialQueueOpen: boolean;
  onClose: () => void;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Full-screen Now Playing (a modal dialog). Closes with the chevron, Escape, Back (see
 * `useNowPlaying`) or a downward swipe on touch screens. Only its seek bar re-renders on ticks.
 */
export const NowPlaying = React.memo(function NowPlaying({
  track,
  clock,
  queue,
  isPlaying,
  isLoading,
  liked,
  downloaded,
  shuffleEnabled,
  repeatMode,
  autoplayRadio,
  playingFrom,
  initialQueueOpen,
  onClose,
}: NowPlayingProps) {
  countRender('NowPlaying');
  const actions = useAppActions();
  const { player } = actions;
  const [queueOpen, setQueueOpen] = React.useState(initialQueueOpen);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const queueButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const queueId = React.useId();

  React.useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    // The page behind must not scroll while the dialog is open
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, []);

  const closeQueue = React.useCallback(() => {
    setQueueOpen(false);
    queueButtonRef.current?.focus({ preventScroll: true });
  }, []);

  /* ------------------------------------ swipe down to close ----------------------------------- */

  const dragCleanupRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => () => dragCleanupRef.current?.(), []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || !e.isPrimary) return;
    const target = e.target as Element | null;
    // Scrolling the queue, dragging a slider or using a menu never closes the view
    if (target?.closest('[data-no-swipe], input, [role="menu"]')) return;
    const sheet = dialogRef.current;
    if (!sheet) return;
    dragCleanupRef.current?.();
    const pointerId = e.pointerId;
    const startY = e.clientY;
    const startedAt = e.timeStamp;
    let dy = 0;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      dy = Math.max(0, ev.clientY - startY);
      sheet.style.transition = 'none';
      sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
    };
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      const elapsed = Math.max(1, ev.timeStamp - startedAt);
      const flick = dy >= FLICK_MIN_PX && dy / elapsed >= FLICK_PX_PER_MS;
      if (dy > 8) {
        // A drag is not a tap: swallow the click that may follow on a button
        const swallow = (click: MouseEvent) => {
          click.preventDefault();
          click.stopPropagation();
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
      if (!cancelled && (dy >= SWIPE_CLOSE_PX || flick)) {
        if (prefersReducedMotion()) {
          onCloseRef.current();
          return;
        }
        sheet.style.transition = `transform ${SWIPE_OUT_MS}ms ease-in`;
        sheet.style.transform = 'translateY(100%)';
        window.setTimeout(() => onCloseRef.current(), SWIPE_OUT_MS);
        return;
      }
      sheet.style.transition = 'transform 200ms ease-out';
      sheet.style.transform = '';
    };
    const onUp = (ev: PointerEvent) => finish(ev, false);
    const onCancel = (ev: PointerEvent) => finish(ev, true);
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      dragCleanupRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    dragCleanupRef.current = cleanup;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    e.preventDefault();
    if (queueOpen) closeQueue();
    else onClose();
  };

  const menuItems = React.useMemo(
    () => buildTrackMenuItems(track, { liked, downloaded }, actions),
    [track, liked, downloaded, actions]
  );
  const activeIdx = queue.findIndex((t) => t.id === track.id);
  const nextUp = activeIdx >= 0 ? queue[activeIdx + 1] : undefined;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Now Playing"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      className="slide-up fixed inset-0 z-50 flex bg-zinc-950 text-white overflow-hidden touch-none select-none"
    >
      {/* A soft, blurred copy of the artwork as the backdrop (no pixel reading: thumbnails are cross-origin) */}
      <div aria-hidden="true" className="absolute inset-0 overflow-hidden pointer-events-none">
        <img
          src={track.coverUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover scale-150 blur-3xl opacity-60 saturate-150"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-zinc-950/70 to-zinc-950" />
      </div>

      <div className="relative flex-1 min-w-0 flex lg:gap-8 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] lg:px-8">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col w-full max-w-xl lg:max-w-3xl mx-auto px-5 short:px-4">
          <header className="h-14 short:h-11 shrink-0 grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-2">
            <button
              ref={closeRef}
              type="button"
              aria-label="Close Now Playing"
              onClick={onClose}
              className="tap-target -ml-2 w-10 h-10 inline-flex items-center justify-center rounded-full text-white hover:bg-white/10 cursor-pointer"
            >
              <ChevronDown className="w-7 h-7" />
            </button>
            <div className="min-w-0 text-center leading-tight">
              {playingFrom ? (
                <>
                  <div className="text-[11px] uppercase tracking-wider text-zinc-300">Playing from</div>
                  <div className="truncate text-sm font-semibold text-white">{PLAY_SOURCE_LABELS[playingFrom]}</div>
                </>
              ) : (
                <div className="truncate text-sm font-semibold text-white">Now Playing</div>
              )}
            </div>
            <TrackMenu trackTitle={track.title} items={menuItems} className="w-10 h-10 -mr-2 text-white" />
          </header>

          <div className="flex-1 min-h-0 flex flex-col short:flex-row short:items-center gap-6 short:gap-6 py-4 short:py-2">
            <div className="art-box flex-1 min-h-0 min-w-0 short:h-full flex items-center justify-center">
              <div className="art-square">
                <Artwork src={track.coverUrl} eager className="w-full h-full rounded-lg shadow-2xl shadow-black/60" />
              </div>
            </div>

            <div className="shrink-0 short:flex-1 short:min-w-0 flex flex-col gap-4 short:gap-2">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h2 data-current-title className="truncate text-2xl short:text-lg lg:text-3xl font-bold tracking-tight">
                    {track.title}
                  </h2>
                  <p className="truncate text-base short:text-sm text-zinc-300">{track.artist}</p>
                </div>
                <LikeButton liked={liked} onToggle={() => player.toggleLike(track.id, track)} className="w-11 h-11 -mr-2" iconClassName="w-7 h-7 short:w-6 short:h-6" />
              </div>

              <SeekBar clock={clock} durationMs={track.durationMs} onSeek={player.seekTo} layout="stacked" />

              <div className="-mx-2">
                <TransportControls
                  size="lg"
                  isPlaying={isPlaying}
                  isLoading={isLoading}
                  shuffleEnabled={shuffleEnabled}
                  repeatMode={repeatMode}
                  onTogglePlay={player.togglePlay}
                  onNext={player.next}
                  onPrevious={player.previous}
                  onToggleShuffle={player.toggleShuffle}
                  onCycleRepeat={player.cycleRepeat}
                />
              </div>

              <button
                ref={queueButtonRef}
                type="button"
                aria-expanded={queueOpen}
                aria-controls={queueOpen ? queueId : undefined}
                onClick={() => setQueueOpen((open) => !open)}
                className="tap-target self-stretch flex items-center gap-3 rounded-lg bg-white/[0.08] hover:bg-white/[0.12] px-3 py-2.5 short:py-1.5 text-left cursor-pointer"
              >
                <ListMusic className="w-5 h-5 shrink-0 text-zinc-300" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Up next</span>
                  <span className="block truncate text-xs text-zinc-400">
                    {nextUp ? `${nextUp.title} · ${nextUp.artist}` : autoplayRadio ? 'Similar songs' : 'Nothing queued'}
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>

        {queueOpen && (
          <QueueSheet
            id={queueId}
            queue={queue}
            activeTrackId={track.id}
            isPlaying={isPlaying}
            autoplayRadio={autoplayRadio}
            onPlayQueueItem={player.playQueueItem}
            onMoveQueueItem={player.moveQueueItem}
            onRemoveQueueItem={player.removeFromQueue}
            onClearUpcoming={player.clearUpcoming}
            onToggleAutoplayRadio={player.toggleAutoplayRadio}
            onClose={closeQueue}
          />
        )}
      </div>
    </div>
  );
});
