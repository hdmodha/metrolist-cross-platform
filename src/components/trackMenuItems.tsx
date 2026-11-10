import { CircleCheck, Download, Heart, ListEnd, ListStart, MicVocal } from 'lucide-react';
import type { AppActions } from '../app/AppActionsContext';
import type { MetrolistTrack } from '../data/track';
import type { TrackMenuItem } from './TrackMenu';

/** The "⋮" menu of a song: Play next, Add to queue, Like / Unlike, Download / Remove download, Go to artist. */
export function buildTrackMenuItems(
  track: MetrolistTrack,
  flags: { liked: boolean; downloaded: boolean },
  actions: AppActions
): TrackMenuItem[] {
  const { player } = actions;
  return [
    { label: 'Play next', icon: <ListStart className="w-4 h-4" />, onSelect: () => player.playNext(track) },
    { label: 'Add to queue', icon: <ListEnd className="w-4 h-4" />, onSelect: () => player.addToQueue(track) },
    {
      label: flags.liked ? 'Unlike' : 'Like',
      icon: <Heart className={`w-4 h-4 ${flags.liked ? 'fill-emerald-400 text-emerald-400' : ''}`} />,
      onSelect: () => player.toggleLike(track.id, track),
    },
    {
      label: flags.downloaded ? 'Remove download' : 'Download',
      icon: flags.downloaded ? <CircleCheck className="w-4 h-4 text-emerald-400" /> : <Download className="w-4 h-4" />,
      onSelect: () => player.toggleDownloaded(track.id, track),
    },
    { label: 'Go to artist', icon: <MicVocal className="w-4 h-4" />, onSelect: () => actions.goToArtist(track.artist) },
  ];
}
