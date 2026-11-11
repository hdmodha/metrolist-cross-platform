package com.metrolist.backgroundplayback;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Background play for the YouTube IFrame player in Capacitor's WebView, the way Brave does it:
 *
 * <ol>
 *   <li>the YouTube frames believe the page is still visible ({@code metrolist-page-visibility.js},
 *       injected at document start into https://www.youtube.com and https://www.youtube-nocookie.com
 *       frames only; the app's own origin keeps the real Page Visibility API);
 *   <li>a media-playback foreground service with a media notification and session keeps the app
 *       alive ({@link PlaybackController}, {@link MediaPlaybackService}); the WebView renderer is
 *       kept important while the app is in the background;
 *   <li>ad / tracking requests are answered with an empty response ({@link AdBlockingWebViewClient}
 *       with the rules shared with the desktop app).
 * </ol>
 *
 * Playback itself stays in YouTube's official IFrame player: no stream URLs are extracted.
 *
 * <p>JavaScript API ({@code src/index.ts}): {@code update}, {@code stop},
 * {@code ensureNotificationPermission}; event {@code command} ({@code play}, {@code pause},
 * {@code next}, {@code previous}, {@code seekTo}).
 */
@CapacitorPlugin(
    name = "BackgroundPlayback",
    permissions = { @Permission(strings = { "android.permission.POST_NOTIFICATIONS" }, alias = BackgroundPlaybackPlugin.NOTIFICATIONS) }
)
public class BackgroundPlaybackPlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";

    private static final String TAG = "MetrolistBackground";
    static final String VISIBILITY_SCRIPT_ASSET = "metrolist-page-visibility.js";
    /** The only frames the page-visibility override is injected into (see the script itself). */
    static final Set<String> YOUTUBE_FRAME_ORIGINS = Collections.unmodifiableSet(
        new HashSet<>(Arrays.asList("https://www.youtube.com", "https://www.youtube-nocookie.com"))
    );
    private static final String PREFERENCES = "metrolist_background_playback";
    private static final String ASKED_FOR_NOTIFICATIONS = "askedForNotifications";

    private final Handler main = new Handler(Looper.getMainLooper());
    private PlaybackController controller;

    @Override
    public void load() {
        // Runs on the main thread while the Bridge is created, before the app page is loaded
        WebView webView = getBridge().getWebView();
        installAdBlocker();
        installVisibilityOverride(webView);
        keepRendererImportant(webView);
        controller = PlaybackController.get(getContext());
        controller.setCommandListener(this::sendCommand);
    }

    /* ---------------------------------------- setup ----------------------------------------- */

    private void installAdBlocker() {
        String json = readAsset(AdBlockRules.ASSET_NAME);
        if (json == null) return;
        try {
            AdBlockRules rules = AdBlockRules.fromJson(json);
            // Capacitor serves the app's own files through its client: ours calls super for those
            getBridge().setWebViewClient(new AdBlockingWebViewClient(getBridge(), rules));
            Logger.info(TAG, "Ad blocking on (" + rules.ruleCount() + " rules)");
        } catch (Exception e) {
            Logger.error(TAG, "Ad-block rules not loaded; ad blocking is off", e);
        }
    }

    private void installVisibilityOverride(WebView webView) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Logger.warn(
                TAG,
                "This WebView cannot inject document-start scripts: YouTube may pause when the app goes to the " +
                "background (update Android System WebView). The media service and ad blocking still work."
            );
            return;
        }
        String script = readAsset(VISIBILITY_SCRIPT_ASSET);
        if (script == null) return;
        try {
            WebViewCompat.addDocumentStartJavaScript(webView, script, YOUTUBE_FRAME_ORIGINS);
            Logger.info(TAG, "Page-visibility override installed for YouTube frames");
        } catch (RuntimeException e) {
            Logger.error(TAG, "Page-visibility override not installed", e);
        }
    }

    /** The renderer stays important while the app is in the background, so it is not killed first. */
    private void keepRendererImportant(WebView webView) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
    }

    private String readAsset(String name) {
        try (InputStream in = getContext().getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            Logger.error(TAG, "Asset " + name + " missing", e);
            return null;
        }
    }

    /* ------------------------------------- page -> native ------------------------------------ */

    @PluginMethod
    public void update(PluginCall call) {
        final PlaybackSnapshot snapshot = new PlaybackSnapshot(
            call.getString("title", ""),
            call.getString("artist", ""),
            call.getString("album", ""),
            call.getString("artworkUrl", ""),
            number(call, "durationMs"),
            number(call, "positionMs"),
            call.getString("state", "paused"),
            SystemClock.elapsedRealtime()
        );
        main.post(() -> controller.update(snapshot));
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> controller.stop());
        call.resolve();
    }

    /**
     * Android 13+: asks for the notification permission at the first play, once per install (the
     * listener's answer is respected afterwards). Playback works without it, only the notification
     * is not shown.
     */
    @PluginMethod
    public void ensureNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
            resolveGranted(call, true);
            return;
        }
        SharedPreferences preferences = getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        if (preferences.getBoolean(ASKED_FOR_NOTIFICATIONS, false)) {
            resolveGranted(call, false);
            return;
        }
        preferences.edit().putBoolean(ASKED_FOR_NOTIFICATIONS, true).apply();
        requestPermissionForAlias(NOTIFICATIONS, call, "notificationPermissionAnswered");
    }

    @PermissionCallback
    private void notificationPermissionAnswered(PluginCall call) {
        boolean granted = getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED;
        if (granted) main.post(() -> controller.refreshNotification());
        resolveGranted(call, granted);
    }

    private static void resolveGranted(PluginCall call, boolean granted) {
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    private static double number(PluginCall call, String name) {
        Double value = call.getDouble(name);
        if (value != null) return value;
        Long asLong = call.getLong(name);
        return asLong != null ? asLong.doubleValue() : 0;
    }

    /* ------------------------------------- native -> page ------------------------------------ */

    private void sendCommand(String action, long positionMs, String reason) {
        JSObject data = new JSObject();
        data.put("action", action);
        if (positionMs >= 0) data.put("positionMs", positionMs);
        if (reason != null) data.put("reason", reason);
        notifyListeners("command", data);
    }

    @Override
    protected void handleOnDestroy() {
        // The activity (and its WebView) is gone: nothing can play any more
        if (controller != null) {
            controller.setCommandListener(null);
            controller.stop();
        }
        super.handleOnDestroy();
    }
}
