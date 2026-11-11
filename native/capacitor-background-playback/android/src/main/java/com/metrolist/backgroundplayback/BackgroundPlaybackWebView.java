package com.metrolist.backgroundplayback;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import com.getcapacitor.CapacitorWebView;

/**
 * Capacitor's WebView that keeps playing when the app is minimised.
 *
 * <p>When the app goes to the background (Home, another app in front), its window becomes
 * {@code GONE} and Android's WebView reacts to {@link #onWindowVisibilityChanged} by hiding the whole
 * page: the Page Visibility API says hidden, and Chromium pauses video players with audio in hidden
 * frames (the YouTube player is one). Turning the screen off does not hide the window, which is why
 * music survived the screen turning off but not Home.
 *
 * <p>While the listener wants music ({@link PlaybackController}: playing or buffering), this WebView
 * keeps telling the engine that its window is {@code VISIBLE} and remembers the real value; once
 * music is no longer wanted it reports the real value again, so a paused app stops rendering and
 * saves battery. {@link WindowVisibilityPolicy} is the (unit-tested) rule.
 *
 * <p>Capacitor creates its WebView from {@code bridge_layout_main.xml}; the app's {@code MainActivity}
 * (installed by {@code npm run native:prepare} from {@code native/android-app/MainActivity.java})
 * swaps that layout for {@code metrolist_bridge_layout_main.xml}, which uses this class with the same
 * id ({@code @id/webview}), so Capacitor's {@code Bridge} finds it as usual.
 */
public class BackgroundPlaybackWebView extends CapacitorWebView {

    /** Told about the real window visibility (not what the engine is told). Main thread. */
    interface WindowVisibilityListener {
        void onRealWindowVisibilityChanged(int visibility);
    }

    private int realVisibility = View.GONE;
    private int reportedVisibility = -1;
    private boolean keepVisible;
    private WindowVisibilityListener listener;

    public BackgroundPlaybackWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        boolean changed = visibility != realVisibility;
        realVisibility = visibility;
        int reported = WindowVisibilityPolicy.reported(visibility, keepVisible);
        if (changed || reported != reportedVisibility) {
            MetrolistLog.i(
                "WebView window: real " + WindowVisibilityPolicy.name(visibility) + ", reported " +
                WindowVisibilityPolicy.name(reported) + (keepVisible ? " (music wanted)" : "")
            );
        }
        reportedVisibility = reported;
        super.onWindowVisibilityChanged(reported);
        WindowVisibilityListener current = listener;
        if (changed && current != null) current.onRealWindowVisibilityChanged(visibility);
    }

    @Override
    protected void onVisibilityChanged(View changedView, int visibility) {
        // Diagnostics only: Android makes the activity's decor view INVISIBLE when it stops. The
        // engine reads the WebView's own visibility, which does not change.
        if (changedView != this && visibility != View.VISIBLE) {
            MetrolistLog.i("WebView ancestor visibility " + WindowVisibilityPolicy.name(visibility));
        }
        super.onVisibilityChanged(changedView, visibility);
    }

    /**
     * Main thread. {@code true} while the listener wants music: the engine is told the window is
     * visible even when it is not. {@code false}: the real visibility is reported again.
     */
    void setKeepWindowVisible(boolean keep) {
        if (keep == keepVisible) return;
        keepVisible = keep;
        if (!isAttachedToWindow()) return; // the next real visibility change reports it
        int reported = WindowVisibilityPolicy.reported(realVisibility, keep);
        MetrolistLog.i(
            (keep ? "Music wanted" : "Music no longer wanted") + ": WebView window real " + WindowVisibilityPolicy.name(realVisibility) +
            ", reported " + WindowVisibilityPolicy.name(reported)
        );
        if (reported == reportedVisibility) return;
        reportedVisibility = reported;
        super.onWindowVisibilityChanged(reported);
    }

    void setWindowVisibilityListener(WindowVisibilityListener next) {
        listener = next;
    }

    /** The window's real visibility ({@code View.VISIBLE} / {@code INVISIBLE} / {@code GONE}). */
    int getRealWindowVisibility() {
        return realVisibility;
    }

    /** What the engine was last told. */
    int getReportedWindowVisibility() {
        return reportedVisibility;
    }
}
