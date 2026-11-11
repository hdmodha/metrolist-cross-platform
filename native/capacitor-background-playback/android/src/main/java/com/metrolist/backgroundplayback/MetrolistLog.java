package com.metrolist.backgroundplayback;

import android.util.Log;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

/**
 * The plugin's diagnostics: logcat tag {@code Metrolist} ({@code adb logcat -s Metrolist}), and the
 * last {@link #CAPACITY} lines kept in memory for the app's hidden debug log ({@code #/debug}, opened
 * by a long press on the version in Library), which reads them with the plugin's
 * {@code getDebugLog}. A device test can then be read without a computer. Any thread.
 */
final class MetrolistLog {

    static final String TAG = "Metrolist";
    static final int CAPACITY = 100;

    static final class Entry {

        final long at;
        final String level;
        final String message;

        Entry(long at, String level, String message) {
            this.at = at;
            this.level = level;
            this.message = message;
        }
    }

    private static final ArrayDeque<Entry> recent = new ArrayDeque<>();

    private MetrolistLog() {}

    static void i(String message) {
        Log.i(TAG, message);
        keep("info", message);
    }

    static void w(String message) {
        Log.w(TAG, message);
        keep("warn", message);
    }

    static void e(String message, Throwable error) {
        Log.e(TAG, message, error);
        keep("error", error != null ? message + ": " + error : message);
    }

    /** Oldest first. */
    static List<Entry> snapshot() {
        synchronized (recent) {
            return new ArrayList<>(recent);
        }
    }

    private static void keep(String level, String message) {
        Entry entry = new Entry(System.currentTimeMillis(), level, message);
        synchronized (recent) {
            if (recent.size() >= CAPACITY) recent.removeFirst();
            recent.addLast(entry);
        }
    }
}
