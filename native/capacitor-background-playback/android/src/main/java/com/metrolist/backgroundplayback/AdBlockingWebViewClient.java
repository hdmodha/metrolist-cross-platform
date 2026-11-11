package com.metrolist.backgroundplayback;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Capacitor's WebView client plus Brave-style ad blocking: every request of every frame (the app
 * page and the YouTube player iframe alike) passes {@link AdBlockRules} first. An ad / tracking
 * request gets an empty 204 answer and never leaves the device; everything else goes to
 * {@code super}, which is how Capacitor serves the app's own files from https://localhost, so that
 * path is never changed. Navigations of the main frame are never blocked.
 */
final class AdBlockingWebViewClient extends BridgeWebViewClient {

    /** The first block is logged, then every 50th, so the log shows it working without flooding. */
    private static final int LOG_EVERY = 50;

    private final AdBlockRules rules;
    private final AtomicInteger blocked = new AtomicInteger();

    AdBlockingWebViewClient(Bridge bridge, AdBlockRules rules) {
        super(bridge);
        this.rules = rules;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request != null ? request.getUrl() : null;
        if (url != null && rules.shouldBlock(url.toString(), request.isForMainFrame())) {
            int count = blocked.incrementAndGet();
            if (count == 1 || count % LOG_EVERY == 0) {
                MetrolistLog.i(count + " ad / tracking request(s) blocked so far (latest: " + url.getHost() + ")");
            }
            return emptyResponse();
        }
        return super.shouldInterceptRequest(view, request);
    }

    int blockedCount() {
        return blocked.get();
    }

    private static WebResourceResponse emptyResponse() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", 204, "No Content", headers, new ByteArrayInputStream(new byte[0]));
    }
}
