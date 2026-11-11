package com.metrolist.backgroundplayback;

/**
 * Which window visibility {@link BackgroundPlaybackWebView} reports to the WebView engine. Pure Java
 * (the values are {@code View.VISIBLE} / {@code INVISIBLE} / {@code GONE}, repeated here so the JUnit
 * test needs no Android framework).
 *
 * <p>Android's WebView hides its whole page when its window is no longer visible (Home, another app
 * in front; not when the screen merely turns off), and Chromium then pauses video players with
 * audio in hidden frames, the YouTube player among them. While the listener wants music (playing or
 * buffering), the WebView keeps being told its window is visible; otherwise it gets the real value,
 * so a paused app stops rendering and saves battery.
 */
final class WindowVisibilityPolicy {

    static final int VISIBLE = 0; // android.view.View.VISIBLE
    static final int INVISIBLE = 4; // android.view.View.INVISIBLE
    static final int GONE = 8; // android.view.View.GONE

    private WindowVisibilityPolicy() {}

    /** What the WebView engine is told for the real window visibility {@code real}. */
    static int reported(int real, boolean keepVisible) {
        return keepVisible ? VISIBLE : real;
    }

    static String name(int visibility) {
        switch (visibility) {
            case VISIBLE:
                return "VISIBLE";
            case INVISIBLE:
                return "INVISIBLE";
            case GONE:
                return "GONE";
            default:
                return "UNKNOWN(" + visibility + ")";
        }
    }
}
