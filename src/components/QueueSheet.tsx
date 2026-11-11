import React from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import type { MetrolistTrack } from '../data/track';
import { unplayableShortReason, type UnplayableReason } from '../player/streamErrors';
import { countRender } from '../utils/renderProbe';
import { Artwork } from './Artwork';
import { PlayingBars } from './PlayingBars';

interface QueueSheetProps {
  id: string;
  /** The whole queue in play order (played songs, the current one, upcoming ones). */
  queue: MetrolistTrack[];
  /** Songs the player found it cannot play: marked "Unavailable" (they are jumped over). */
  unplayableTracks: Readonly<Record<string, UnplayableReason>>;
  activeTrackId: string;
  isPlaying: boolean;
  autoplayRadio: boolean;
  onPlayQueueItem: (trackId: string) => void;
  onMoveQueueItem: (trackId: string, direction: -1 | 1) => void;
  onRemoveQueueItem: (trackId: string) => void;
  onClearUpcoming: () => void;
  onToggleAutoplayRadio: () => void;
  onClose: () => void;
}

const smallButton =
  'tap-target inline-flex items-center justify-center w-8 h-8 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:pointer-events-none cursor-pointer';

interface QueueRowProps {
  track: MetrolistTrack;
  isFirst: boolean;
  isLast: boolean;
  unavailableReason?: UnplayableReason;
  onPlay: (trackId: string) => void;
  onMove: (trackId: string, direction: -1 | 1) => void;
  onRemove: (trackId: string) => void;
}

const QueueRow = React.memo(function QueueRow({ track, isFirst, isLast, unavailableReason, onPlay, onMove, onRemove }: QueueRowProps) {
  const label = `Play ${track.title} by ${track.artist}`;
  return (
    <li className="song-row flex items-center gap-1 rounded-md hover:bg-white/[0.06]">
      <button
        type="button"
        onClick={() => onPlay(track.id)}
        aria-label={unavailableReason ? `${label}. Unavailable: ${unplayableShortReason(unavailableReason)}` : label}
        title={unavailableReason ? unplayableShortReason(unavailableReason) : undefined}
        className="flex flex-1 min-w-0 items-center gap-3 py-1.5 pl-1 text-left cursor-pointer rounded-md"
      >
        <Artwork src={track.coverUrl} className={`w-10 h-10 rounded shrink-0 ${unavailableReason ? 'opacity-50' : ''}`} />
        <span className={`min-w-0 flex-1 ${unavailableReason ? 'opacity-50' : ''}`}>
          <span className="song-title block truncate text-sm font-medium text-white">{track.title}</span>
          <span className="block truncate text-xs text-zinc-400 mt-0.5">{track.artist}</span>
        </span>
        {unavailableReason && (
          <span className="song-unavailable shrink-0 rounded-full border border-white/20 px-2 py-0.5 text-[11px] font-medium text-zinc-300">
            Unavailable
          </span>
        )}
      </button>
      <button type="button" aria-label={`Move ${track.title} up in queue`} disabled={isFirst} onClick={() => onMove(track.id, -1)} className={smallButton}>
        <ArrowUp className="w-4 h-4" />
      </button>
      <button type="button" aria-label={`Move ${track.title} down in queue`} disabled={isLast} onClick={() => onMove(track.id, 1)} className={smallButton}>
        <ArrowDown className="w-4 h-4" />
      </button>
      <button type="button" aria-label={`Remove ${track.title} from queue`} onClick={() => onRemove(track.id)} className={smallButton}>
        <X className="w-4 h-4" />
      </button>
    </li>
  );
});

/** "Up next": the current song, the upcoming ones (reorder / remove / clear) and the autoplay switch. */
export const QueueSheet = React.memo(function QueueSheet({
  id,
  queue,
  unplayableTracks,
  activeTrackId,
  isPlaying,
  autoplayRadio,
  onPlayQueueItem,
  onMoveQueueItem,
  onRemoveQueueItem,
  onClearUpcoming,
  onToggleAutoplayRadio,
  onClose,
}: QueueSheetProps) {
  countRender('QueueSheet');
  const activeIdx = queue.findIndex((t) => t.id === activeTrackId);
  const current = activeIdx >= 0 ? queue[activeIdx] : null;
  const upcoming = queue.slice(activeIdx + 1);

  return (
    <section
      id={id}
      aria-label="Queue"
      data-no-swipe
      className="slide-up absolute inset-x-0 bottom-0 z-10 h-[88%] short:h-full flex flex-col rounded-t-2xl short:rounded-none bg-[#18181b] shadow-[0_-12px_40px_rgba(0,0,0,0.5)] pb-[env(safe-area-inset-bottom)] lg:static lg:z-auto lg:h-auto lg:w-[24rem] lg:shrink-0 lg:my-6 lg:rounded-xl lg:shadow-none lg:pb-0 lg:bg-black/40 lg:backdrop-blur"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]">
        <h2 className="text-lg font-bold text-white">Queue</h2>
        <button type="button" aria-label="Close queue" onClick={onClose} className={`${smallButton} w-10 h-10`}>
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y px-3 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        {current && (
          <div className="mb-4">
            <h3 className="px-1 mb-1 text-sm font-semibold text-zinc-300">Now playing</h3>
            <div aria-current="true" className="flex items-center gap-3 py-1.5 px-1">
              <Artwork src={current.coverUrl} className="w-10 h-10 rounded shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-emerald-400 min-w-0">
                  <PlayingBars playing={isPlaying} />
                  <span className="song-title truncate text-sm font-medium">{current.title}</span>
                </div>
                <div className="truncate text-xs text-zinc-400 mt-0.5">{current.artist}</div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 px-1 mb-1">
          <h3 className="text-sm font-semibold text-zinc-300">Next up</h3>
          {upcoming.length > 0 && (
            <button
              type="button"
              aria-label="Clear upcoming songs"
              onClick={onClearUpcoming}
              className="group tap-target inline-flex items-center justify-center -mr-1 px-1 cursor-pointer"
            >
              <span className="px-3 py-1 rounded-full text-xs font-semibold text-zinc-300 border border-white/15 group-hover:border-white/40 group-hover:text-white">
                Clear
              </span>
            </button>
          )}
        </div>
        {upcoming.length === 0 ? (
          <p className="px-1 py-3 text-sm text-zinc-400">
            Nothing is queued. {autoplayRadio ? 'Similar songs will play next.' : 'Playback stops after this song.'}
          </p>
        ) : (
          <ul aria-label="Next up" className="pb-3">
            {upcoming.map((track, idx) => (
              <QueueRow
                key={track.id}
                track={track}
                isFirst={idx === 0}
                isLast={idx === upcoming.length - 1}
                unavailableReason={unplayableTracks[track.id]}
                onPlay={onPlayQueueItem}
                onMove={onMoveQueueItem}
                onRemove={onRemoveQueueItem}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-white/10 px-4 py-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
        <button
          type="button"
          role="switch"
          aria-checked={autoplayRadio}
          onClick={onToggleAutoplayRadio}
          className="w-full min-h-11 flex items-center justify-between gap-4 text-left cursor-pointer rounded-md"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-white">Autoplay similar songs</span>
            <span className="block text-xs text-zinc-400 mt-0.5">Keeps the music going when your queue ends</span>
          </span>
          <span
            aria-hidden="true"
            className={`relative w-11 h-6 rounded-full shrink-0 transition-colors ${autoplayRadio ? 'bg-emerald-500' : 'bg-zinc-600'}`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                autoplayRadio ? 'translate-x-5' : ''
              }`}
            />
          </span>
        </button>
      </div>
    </section>
  );
});
