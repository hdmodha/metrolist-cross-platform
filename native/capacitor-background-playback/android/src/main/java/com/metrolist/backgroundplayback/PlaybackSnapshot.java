package com.metrolist.backgroundplayback;

/**
 * What the page last told the plugin about the player ({@code BackgroundPlayback.update}): the song
 * and whether the listener wants to hear it. Immutable; values are already sanitized.
 */
final class PlaybackSnapshot {

    enum State {
        PLAYING,
        /** The listener wants to hear music that is not audible yet (loading, the next song). */
        BUFFERING,
        PAUSED;

        static State parse(String value) {
            if ("playing".equals(value)) return PLAYING;
            if ("buffering".equals(value)) return BUFFERING;
            return PAUSED;
        }
    }

    private static final int MAX_TEXT_LENGTH = 300;
    private static final int MAX_URL_LENGTH = 2048;

    final String title;
    final String artist;
    final String album;
    /** http(s) only, or empty. */
    final String artworkUrl;
    /** 0 when unknown. */
    final long durationMs;
    final long positionMs;
    final State state;
    /** {@code SystemClock.elapsedRealtime()} when the position was reported. */
    final long reportedAtElapsedMs;

    PlaybackSnapshot(
        String title,
        String artist,
        String album,
        String artworkUrl,
        double durationMs,
        double positionMs,
        String state,
        long reportedAtElapsedMs
    ) {
        this.title = text(title);
        this.artist = text(artist);
        this.album = text(album);
        this.artworkUrl = httpUrl(artworkUrl);
        this.durationMs = millis(durationMs);
        long position = millis(positionMs);
        this.positionMs = this.durationMs > 0 ? Math.min(position, this.durationMs) : position;
        this.state = State.parse(state);
        this.reportedAtElapsedMs = reportedAtElapsedMs;
    }

    private PlaybackSnapshot(PlaybackSnapshot base, State state, long positionMs, long reportedAtElapsedMs) {
        this.title = base.title;
        this.artist = base.artist;
        this.album = base.album;
        this.artworkUrl = base.artworkUrl;
        this.durationMs = base.durationMs;
        this.positionMs = positionMs;
        this.state = state;
        this.reportedAtElapsedMs = reportedAtElapsedMs;
    }

    /** The same song in another state (an optimistic resume, or its undo). */
    PlaybackSnapshot withState(State state, long positionMs, long reportedAtElapsedMs) {
        return new PlaybackSnapshot(this, state, positionMs, reportedAtElapsedMs);
    }

    /** The foreground service runs while the listener wants to hear music (playing or buffering). */
    boolean wantsForeground() {
        return state != State.PAUSED;
    }

    /** Same song as far as the media metadata is concerned (title, artist, album, cover, duration). */
    boolean sameMetadata(PlaybackSnapshot other) {
        return (
            other != null &&
            title.equals(other.title) &&
            artist.equals(other.artist) &&
            album.equals(other.album) &&
            artworkUrl.equals(other.artworkUrl) &&
            durationMs == other.durationMs
        );
    }

    private static String text(String value) {
        if (value == null) return "";
        String trimmed = value.trim();
        return trimmed.length() > MAX_TEXT_LENGTH ? trimmed.substring(0, MAX_TEXT_LENGTH) : trimmed;
    }

    private static String httpUrl(String value) {
        if (value == null) return "";
        String url = value.trim();
        if (url.length() > MAX_URL_LENGTH) return "";
        String lower = url.toLowerCase(java.util.Locale.ROOT);
        return lower.startsWith("https://") || lower.startsWith("http://") ? url : "";
    }

    private static long millis(double value) {
        if (Double.isNaN(value) || Double.isInfinite(value) || value <= 0) return 0;
        return value > 1e12 ? (long) 1e12 : Math.round(value);
    }
}
