package com.metrolist.music;

import android.util.Log;
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
 */
public class MainActivity extends BridgeActivity {

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
