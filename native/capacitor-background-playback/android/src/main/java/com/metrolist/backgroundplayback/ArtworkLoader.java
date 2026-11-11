package com.metrolist.backgroundplayback;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.Logger;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Downloads cover art for the media notification / lock screen off the main thread: http(s) only,
 * at most {@link #MAX_BYTES}, short timeouts, decoded down to about {@link #TARGET_SIZE_PX}. The
 * result is delivered on the main thread; a failure delivers {@code null} (the notification simply
 * has no picture). The last cover is remembered, so a repeated request costs nothing.
 */
final class ArtworkLoader {

    interface Callback {
        /** Main thread. {@code bitmap} is {@code null} when the cover could not be loaded. */
        void onArtwork(String url, Bitmap bitmap);
    }

    private static final String TAG = "MetrolistArtwork";
    static final int MAX_BYTES = 2 * 1024 * 1024;
    private static final int TARGET_SIZE_PX = 512;
    private static final int TIMEOUT_MS = 10000;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private String cachedUrl;
    private Bitmap cachedBitmap;

    /** Main thread. */
    void load(final String url, final Callback callback) {
        if (url == null || url.isEmpty()) {
            callback.onArtwork(url, null);
            return;
        }
        if (url.equals(cachedUrl)) {
            callback.onArtwork(url, cachedBitmap);
            return;
        }
        executor.execute(() -> {
            final Bitmap bitmap = download(url);
            main.post(() -> {
                if (bitmap != null) {
                    cachedUrl = url;
                    cachedBitmap = bitmap;
                }
                callback.onArtwork(url, bitmap);
            });
        });
    }

    private static Bitmap download(String url) {
        HttpURLConnection connection = null;
        try {
            URL target = new URL(url);
            String protocol = target.getProtocol();
            if (!"https".equals(protocol) && !"http".equals(protocol)) return null;
            connection = (HttpURLConnection) target.openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "image/*");
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) return null;
            long declared = connection.getContentLength();
            if (declared > MAX_BYTES) return null;
            byte[] bytes = readLimited(connection.getInputStream());
            if (bytes == null) return null;
            return decodeScaled(bytes);
        } catch (IOException | RuntimeException e) {
            Logger.debug(TAG, "Cover not loaded: " + e.getMessage());
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    /** {@code null} when the body is larger than {@link #MAX_BYTES}. */
    private static byte[] readLimited(InputStream in) throws IOException {
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(64 * 1024);
            byte[] buffer = new byte[16 * 1024];
            int total = 0;
            int read;
            while ((read = stream.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BYTES) return null;
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private static Bitmap decodeScaled(byte[] bytes) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        int sample = 1;
        while (bounds.outWidth / (sample * 2) >= TARGET_SIZE_PX && bounds.outHeight / (sample * 2) >= TARGET_SIZE_PX) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, options);
    }

    void shutdown() {
        executor.shutdownNow();
    }
}
