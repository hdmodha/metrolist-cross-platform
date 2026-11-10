/**
 * A song the player knows. Every song is a YouTube Music song: `id` is `ytm-<videoId>` of the upload
 * it was first found as and never changes, while `videoId` may switch to another upload of the same
 * song when the original cannot be played.
 */
export interface MetrolistTrack {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  /** May be empty (plain video uploads have no album). */
  album: string;
  durationMs: number;
  coverUrl: string;
}
