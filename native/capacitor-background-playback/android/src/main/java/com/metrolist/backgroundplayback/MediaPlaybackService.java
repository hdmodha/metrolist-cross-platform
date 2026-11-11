package com.metrolist.backgroundplayback;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import com.getcapacitor.Logger;

/**
 * Foreground service of type mediaPlayback that keeps the app (and the WebView playing YouTube's
 * player) alive while the screen is off or another app is in front. It owns nothing but the
 * foreground state and the locks: {@link PlaybackController} decides when it runs.
 *
 * <ul>
 *   <li>in the foreground while the listener wants to hear music, with a partial wake lock and a
 *       Wi-Fi lock (released as soon as it leaves the foreground);
 *   <li>paused: out of the foreground, notification kept ({@code STOP_FOREGROUND_DETACH});
 *   <li>the task removed from recents: playback stops and the service stops.
 * </ul>
 *
 * Not exported; started only by the controller (startForegroundService).
 */
public class MediaPlaybackService extends Service {

    private static final String TAG = "MetrolistPlayback";
    /** Locks are re-acquired on every foreground entry; the timeout only guards against a leak. */
    private static final long LOCK_TIMEOUT_MS = 3 * 60 * 60 * 1000L;

    private boolean foreground;
    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public void onCreate() {
        super.onCreate();
        PlaybackController.get(this).attachService(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Started with startForegroundService: startForeground must be called now, whatever happens
        PlaybackController.get(this).onServiceStarted(this);
        // Never restarted by the system without the page that drives it
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    /**
     * Enters (or stays in) the foreground with {@code notification}. {@code false} when Android
     * refused it (a background start on Android 12+, or a missing permission).
     */
    boolean enterForeground(Notification notification) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(PlaybackController.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(PlaybackController.NOTIFICATION_ID, notification);
            }
        } catch (RuntimeException e) {
            Logger.warn(TAG, "startForeground refused: " + e.getMessage());
            return false;
        }
        foreground = true;
        acquireLocks();
        return true;
    }

    /** Leaves the foreground but keeps the notification (paused: it can resume playback). */
    void leaveForeground() {
        releaseLocks();
        if (!foreground) return;
        foreground = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(Service.STOP_FOREGROUND_DETACH);
        } else {
            stopForegroundCompat(false);
        }
    }

    /** Stops for good: notification removed, locks released. */
    void shutDown() {
        releaseLocks();
        foreground = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } else {
            stopForegroundCompat(true);
        }
        stopSelf();
    }

    @SuppressWarnings("deprecation")
    private void stopForegroundCompat(boolean removeNotification) {
        stopForeground(removeNotification);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The listener closed the app from recents: stop playing, as other music players do
        PlaybackController.get(this).onTaskRemoved();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        releaseLocks();
        PlaybackController.get(this).detachService(this);
        super.onDestroy();
    }

    @SuppressWarnings("deprecation")
    private void acquireLocks() {
        try {
            if (wakeLock == null) {
                PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (power != null) {
                    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Metrolist:playback");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null) wakeLock.acquire(LOCK_TIMEOUT_MS);
            if (wifiLock == null) {
                WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
                if (wifi != null) {
                    // HIGH_PERF keeps Wi-Fi awake with the screen off (deprecated and a no-op on Android 14+)
                    wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Metrolist:playback");
                    wifiLock.setReferenceCounted(false);
                }
            }
            if (wifiLock != null && !wifiLock.isHeld()) wifiLock.acquire();
        } catch (RuntimeException e) {
            Logger.warn(TAG, "Locks not acquired: " + e.getMessage());
        }
    }

    private void releaseLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
        } catch (RuntimeException e) {
            Logger.warn(TAG, "Locks not released: " + e.getMessage());
        }
    }
}
