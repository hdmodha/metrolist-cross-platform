package com.metrolist.music;

import android.os.Bundle;
import android.util.Log;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * Metrolist's MainActivity (installed over the one `npx cap add android` generates by
 * `npm run native:prepare`, from native/android-app/MainActivity.java; do not edit the copy in
 * android/).
 *
 * Capacitor's BridgeActivity inflates its own layout, whose WebView Android hides when the app is
 * minimised; the hidden page's YouTube player is then paused. The layout is swapped for the
 * background-playback plugin's copy, whose BackgroundPlaybackWebView keeps the page visible while
 * music plays. Same view id, so Capacitor's Bridge finds the WebView as usual. If that layout cannot
 * be inflated, Capacitor's own is used (music then stops on Home, as before).
 *
 * Back button / back gesture: Capacitor's core does not handle it (its optional App plugin does, and
 * is not installed), so Android's default applied: every Back press finished the activity, which
 * destroys the page and stops the music. Here Back goes one step back in the page's history (the
 * app's router and Now Playing follow it), and on the first entry it sends the app to the
 * background like Home does, so the music keeps playing.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher()
            .addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {
                        WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                        if (webView != null && webView.canGoBack()) {
                            webView.goBack();
                        } else {
                            moveTaskToBack(true);
                        }
                    }
                }
            );
    }

    @Override
    public void setContentView(int layoutResID) {
        if (layoutResID == com.getcapacitor.android.R.layout.bridge_layout_main) {
            try {
                super.setContentView(com.metrolist.backgroundplayback.R.layout.metrolist_bridge_layout_main);
                return;
            } catch (RuntimeException e) {
                Log.e("Metrolist", "Background-playback WebView not inflated; using Capacitor's WebView", e);
            }
        }
        super.setContentView(layoutResID);
    }
}
