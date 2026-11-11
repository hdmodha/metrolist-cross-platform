package com.metrolist.backgroundplayback;

/**
 * The "system paused us" guard, the Java twin of {@code src/shared/systemPauseGuard.ts} (the
 * reference) and of the iOS plugin's {@code SystemPauseGuard.swift}; all three run the shared
 * vectors ({@code src/test/resources/system-pause-guard-vectors.json}, written by
 * {@code npm run adblock:rules}; JUnit: {@code SystemPauseGuardTest}).
 *
 * <p>When the app goes to the background, the WebView may still pause the YouTube player (if the
 * page became hidden after all). The page then reports {@code paused} with {@code pausedBy: player}
 * (the player paused itself, not the listener). If that comes within {@link #WINDOW_MS} of going to
 * the background while music was wanted, {@link #onUpdate} answers {@code true} once per background
 * episode, and {@link PlaybackController} sends {@code play} back to the page.
 *
 * <p>It never fights the listener: a pause from the app ({@code pausedBy} {@code user} or missing),
 * from the notification / lock screen / headset ({@link #onUserCommand} {@code pause}), a pause while
 * the app is in the foreground, or after the window, all stand. Pure Java, not thread-safe (the
 * controller uses it on the main thread only); time comes in with the calls.
 */
final class SystemPauseGuard {

    /** From going to the background to the page's {@code paused} (the page settles an external pause for 700 ms). */
    static final long WINDOW_MS = 2500;

    private boolean wantsPlayback;
    private boolean inBackground;
    private long backgroundAt;
    private boolean armed;
    private boolean used;

    /** The app went to the background (window hidden / activity stopped). Repeated calls keep the first time. */
    void onBackground(long at) {
        if (inBackground) return;
        inBackground = true;
        backgroundAt = at;
        armed = wantsPlayback;
        used = false;
    }

    /** The app is in the foreground again: the episode ends. */
    void onForeground() {
        inBackground = false;
        armed = false;
        used = false;
    }

    /** A command from the notification / lock screen / headset (play, pause, next, previous, seekTo). */
    void onUserCommand(String action) {
        // The listener paused: that pause stands
        if ("pause".equals(action)) armed = false;
    }

    /**
     * The page reported the player ({@code playing} / {@code buffering} / {@code paused}; {@code pausedBy}
     * {@code user} / {@code player} / {@code null}). {@code true}: the system paused us, resume once.
     */
    boolean onUpdate(String state, String pausedBy, long at) {
        if (!"paused".equals(state)) {
            wantsPlayback = true;
            return false;
        }
        boolean resume =
            inBackground && armed && !used && "player".equals(pausedBy) && at >= backgroundAt && at - backgroundAt <= WINDOW_MS;
        if (resume) {
            wantsPlayback = true;
            used = true;
            return true;
        }
        // Any pause that stands ends the episode
        wantsPlayback = false;
        armed = false;
        return false;
    }

    boolean isInBackground() {
        return inBackground;
    }
}
