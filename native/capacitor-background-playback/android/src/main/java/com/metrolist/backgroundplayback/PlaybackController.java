package com.metrolist.backgroundplayback;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.Bitmap;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import java.lang.ref.WeakReference;

/**
 * The native half of background playback, one per process (main thread only). It holds what the
 * page last reported ({@link PlaybackSnapshot}), the {@link MediaSessionCompat} (lock screen,
 * Bluetooth / headset buttons, Android 13+ media controls), the media notification, and drives
 * {@link MediaPlaybackService}:
 *
 * <ul>
 *   <li>playing / buffering: the service runs in the foreground (type mediaPlayback) with the
 *       notification, holding a partial wake lock and a Wi-Fi lock, so Android keeps the app and its
 *       WebView alive while the screen is off;
 *   <li>paused: the service leaves the foreground but the notification stays, so playback can be
 *       resumed from it, the lock screen or a headset; locks are released;
 *   <li>stopped (the queue was cleared, the task was removed): everything goes away.
 * </ul>
 *
 * The page normally starts playback while the app is visible, which allows a foreground service
 * start on Android 12+. A resume from the notification or the media session is a user action the
 * system allows too: the service goes foreground at once (optimistically "buffering") and the page
 * confirms within {@link #PLAY_CONFIRMATION_TIMEOUT_MS}, or the optimistic state is dropped. If
 * Android refuses a foreground start anyway, the notification is still posted and playback goes on
 * as long as the system lets the process live.
 *
 * <p>It also keeps the page playing when the app is minimised: while music is wanted, the app's
 * {@link BackgroundPlaybackWebView} keeps reporting its window visible (see there), and a resume
 * from the notification / session makes it visible BEFORE {@code play} reaches the page. If the
 * page still reports a pause the player made itself right after the app went to the background,
 * {@link SystemPauseGuard} has the controller send {@code play} back once (never against a pause the
 * listener asked for). Every step is logged ({@link MetrolistLog}, tag {@code Metrolist}).
 */
final class PlaybackController {

    interface CommandListener {
        /** {@code positionMs} is only meaningful for {@code seekTo} (-1 otherwise). */
        void onCommand(String action, long positionMs, String reason);
    }

    static final String CHANNEL_ID = "metrolist_playback";
    static final int NOTIFICATION_ID = 7341;

    static final String ACTION_PLAY = "com.metrolist.backgroundplayback.PLAY";
    static final String ACTION_PAUSE = "com.metrolist.backgroundplayback.PAUSE";
    static final String ACTION_NEXT = "com.metrolist.backgroundplayback.NEXT";
    static final String ACTION_PREVIOUS = "com.metrolist.backgroundplayback.PREVIOUS";
    static final String ACTION_DISMISS = "com.metrolist.backgroundplayback.DISMISS";

    private static final long PLAY_CONFIRMATION_TIMEOUT_MS = 8000;
    /** The reason of the {@code play} the controller sends when the system paused a backgrounded page. */
    static final String REASON_SYSTEM_PAUSE = "systemPause";
    private static final long SESSION_ACTIONS =
        PlaybackStateCompat.ACTION_PLAY |
        PlaybackStateCompat.ACTION_PAUSE |
        PlaybackStateCompat.ACTION_PLAY_PAUSE |
        PlaybackStateCompat.ACTION_SKIP_TO_NEXT |
        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS |
        PlaybackStateCompat.ACTION_SEEK_TO |
        PlaybackStateCompat.ACTION_STOP;

    private static PlaybackController instance;

    /** Main thread. */
    static PlaybackController get(Context context) {
        if (instance == null) instance = new PlaybackController(context.getApplicationContext());
        return instance;
    }

    private final Context app;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final NotificationManager notifications;
    private final MediaSessionCompat session;
    private final ArtworkLoader artwork = new ArtworkLoader();

    private PlaybackSnapshot snapshot;
    private Bitmap artworkBitmap;
    private String artworkUrl = "";
    private CommandListener listener;
    private MediaPlaybackService service;
    private boolean serviceStarting;
    private boolean awaitingPlayConfirmation;
    private boolean noisyReceiverRegistered;
    private final SystemPauseGuard guard = new SystemPauseGuard();
    private WeakReference<BackgroundPlaybackWebView> webView = new WeakReference<>(null);

    private final Runnable dropUnconfirmedPlay = () -> {
        if (!awaitingPlayConfirmation || snapshot == null) return;
        awaitingPlayConfirmation = false;
        MetrolistLog.w("The page did not confirm the resume within " + PLAY_CONFIRMATION_TIMEOUT_MS + " ms: back to paused");
        snapshot = snapshot.withState(PlaybackSnapshot.State.PAUSED, snapshot.positionMs, SystemClock.elapsedRealtime());
        publishPlaybackState();
        applyWebViewVisibility();
        applyServiceState();
    };

    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent != null && AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) {
                // Headphones unplugged / Bluetooth audio disconnected: never blast the speaker
                dispatch("pause", -1, "noisy");
            }
        }
    };

    private PlaybackController(Context app) {
        this.app = app;
        this.notifications = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        createChannel();
        session = new MediaSessionCompat(app, "Metrolist");
        session.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setSessionActivity(contentIntent());
        session.setCallback(
            new MediaSessionCompat.Callback() {
                @Override
                public void onPlay() {
                    requestPlay("session");
                }

                @Override
                public void onPause() {
                    dispatch("pause", -1, "session");
                }

                @Override
                public void onStop() {
                    dispatch("pause", -1, "session");
                }

                @Override
                public void onSkipToNext() {
                    dispatch("next", -1, "session");
                }

                @Override
                public void onSkipToPrevious() {
                    dispatch("previous", -1, "session");
                }

                @Override
                public void onSeekTo(long pos) {
                    dispatch("seekTo", Math.max(0, pos), "session");
                }
            },
            main
        );
    }

    /* ------------------------------------------- page --------------------------------------- */

    void setCommandListener(CommandListener listener) {
        this.listener = listener;
    }

    /** The page reported the player (BackgroundPlayback.update). */
    void update(PlaybackSnapshot reported) {
        PlaybackSnapshot previous = snapshot;
        long now = SystemClock.elapsedRealtime();
        if (previous == null || previous.state != reported.state || !reported.sameMetadata(previous)) {
            MetrolistLog.i(
                "Page: " + reported.state.wireName() + (reported.state == PlaybackSnapshot.State.PAUSED ? " (by " + reported.pausedBy + ")" : "") +
                ", \"" + reported.title + "\" at " + reported.positionMs / 1000 + " s" + (guard.isInBackground() ? ", app in the background" : "")
            );
        }
        boolean systemPaused = guard.onUpdate(reported.state.wireName(), reported.pausedBy, now);
        PlaybackSnapshot next = reported;
        if (systemPaused) {
            // The player paused itself right after the app went to the background, and the listener did
            // not ask for it: keep everything as if playing (foreground service, visible WebView) and ask
            // the page to play again, once
            MetrolistLog.w("The system paused the player within " + SystemPauseGuard.WINDOW_MS + " ms of going to the background: sending play once");
            next = reported.withState(PlaybackSnapshot.State.BUFFERING, reported.positionMs, now);
        }
        snapshot = next;
        if (awaitingPlayConfirmation) {
            awaitingPlayConfirmation = false;
            main.removeCallbacks(dropUnconfirmedPlay);
        }
        if (systemPaused) {
            awaitingPlayConfirmation = true;
            main.postDelayed(dropUnconfirmedPlay, PLAY_CONFIRMATION_TIMEOUT_MS);
        }
        if (!session.isActive()) session.setActive(true);
        if (!next.sameMetadata(previous)) {
            if (!next.artworkUrl.equals(artworkUrl)) {
                artworkUrl = next.artworkUrl;
                artworkBitmap = null;
                artwork.load(next.artworkUrl, (url, bitmap) -> {
                    if (snapshot == null || !url.equals(artworkUrl)) return;
                    artworkBitmap = bitmap;
                    publishMetadata();
                    postNotificationIfShown();
                });
            }
            publishMetadata();
        }
        publishPlaybackState();
        setNoisyReceiverRegistered(next.wantsForeground());
        applyWebViewVisibility();
        applyServiceState();
        if (systemPaused) dispatch("play", -1, REASON_SYSTEM_PAUSE);
    }

    /** Nothing to play any more: the notification, the session and the service go away. */
    void stop() {
        if (snapshot != null) MetrolistLog.i("Stop: nothing to play any more");
        snapshot = null;
        awaitingPlayConfirmation = false;
        main.removeCallbacks(dropUnconfirmedPlay);
        setNoisyReceiverRegistered(false);
        session.setPlaybackState(new PlaybackStateCompat.Builder().setActions(SESSION_ACTIONS).setState(PlaybackStateCompat.STATE_STOPPED, 0, 0f).build());
        session.setActive(false);
        if (service != null) service.shutDown();
        notifications.cancel(NOTIFICATION_ID);
        applyWebViewVisibility();
    }

    /** The permission was just granted: show the notification of what is playing. */
    void refreshNotification() {
        if (snapshot != null) applyServiceState();
    }

    /* ---------------------------------- listener commands ----------------------------------- */

    /** A button of the media notification (PlaybackActionReceiver). */
    void onNotificationAction(String action) {
        if (listener == null) {
            // A notification left over from a page that is gone (the process was restarted for
            // this tap): nothing can play it, so it goes away
            stop();
            return;
        }
        if (ACTION_PLAY.equals(action)) requestPlay("notification");
        else if (ACTION_PAUSE.equals(action)) dispatch("pause", -1, "notification");
        else if (ACTION_NEXT.equals(action)) dispatch("next", -1, "notification");
        else if (ACTION_PREVIOUS.equals(action)) dispatch("previous", -1, "notification");
        else if (ACTION_DISMISS.equals(action)) onNotificationDismissed();
    }

    /**
     * Resume from the notification / session: go foreground right away, while Android allows it for
     * this user action, then let the page start the player.
     */
    private void requestPlay(String reason) {
        if (listener == null || snapshot == null) {
            // No page to play (the app was closed): nothing can resume, so clean up
            stop();
            return;
        }
        if (!snapshot.wantsForeground()) {
            snapshot = snapshot.withState(PlaybackSnapshot.State.BUFFERING, snapshot.positionMs, SystemClock.elapsedRealtime());
            awaitingPlayConfirmation = true;
            main.removeCallbacks(dropUnconfirmedPlay);
            main.postDelayed(dropUnconfirmedPlay, PLAY_CONFIRMATION_TIMEOUT_MS);
            publishPlaybackState();
            setNoisyReceiverRegistered(true);
            applyServiceState();
        }
        // The page must be "visible" again before it is asked to play: a hidden page's player would be
        // paused again by the WebView. The play command reaches the page after this (posted to the WebView).
        applyWebViewVisibility();
        dispatch("play", -1, reason);
    }

    private void onNotificationDismissed() {
        // Only possible while paused (the notification is ongoing while playing)
        if (snapshot != null && snapshot.wantsForeground()) {
            postNotificationIfShown();
            return;
        }
        if (service != null) service.shutDown();
    }

    /** The app was swiped away from recents while the service ran: stop playing and clean up. */
    void onTaskRemoved() {
        dispatch("pause", -1, "taskRemoved");
        stop();
    }

    private void dispatch(String action, long positionMs, String reason) {
        if (!REASON_SYSTEM_PAUSE.equals(reason)) guard.onUserCommand(action);
        CommandListener current = listener;
        MetrolistLog.i(
            "Command to the page: " + action + (positionMs >= 0 ? " " + positionMs / 1000 + " s" : "") + " (" + reason + ")" +
            (current == null ? ", but no page is listening" : "")
        );
        if (current != null) current.onCommand(action, positionMs, reason);
    }

    /* ------------------------------------ app visibility ------------------------------------ */

    /** The app's WebView (null if the MainActivity hook is missing: then music stops on Home). */
    void attachWebView(BackgroundPlaybackWebView view) {
        webView = new WeakReference<>(view);
        view.setWindowVisibilityListener(visibility -> {
            if (visibility == android.view.View.VISIBLE) onAppForeground("window visible");
            else onAppBackground("window " + WindowVisibilityPolicy.name(visibility));
        });
        applyWebViewVisibility();
    }

    void detachWebView(BackgroundPlaybackWebView view) {
        if (webView.get() != view) return;
        view.setWindowVisibilityListener(null);
        webView = new WeakReference<>(null);
    }

    /** The app went to the background (its window was hidden, or the activity stopped). */
    void onAppBackground(String why) {
        if (!guard.isInBackground()) {
            MetrolistLog.i("App in the background (" + why + ")" + (snapshot != null && snapshot.wantsForeground() ? ", music wanted" : ""));
        }
        guard.onBackground(SystemClock.elapsedRealtime());
    }

    void onAppForeground(String why) {
        if (guard.isInBackground()) MetrolistLog.i("App in the foreground (" + why + ")");
        guard.onForeground();
    }

    /** While music is wanted the WebView reports its window visible, so the page keeps playing. */
    private void applyWebViewVisibility() {
        BackgroundPlaybackWebView view = webView.get();
        if (view != null) view.setKeepWindowVisible(snapshot != null && snapshot.wantsForeground());
    }

    /* --------------------------------------- service ---------------------------------------- */

    void attachService(MediaPlaybackService started) {
        service = started;
        serviceStarting = false;
    }

    void detachService(MediaPlaybackService stopped) {
        if (service == stopped) service = null;
    }

    /** Called by the service from onStartCommand: it must call startForeground now. */
    void onServiceStarted(MediaPlaybackService started) {
        attachService(started);
        if (snapshot == null) {
            started.enterForeground(buildNotification());
            started.shutDown();
            return;
        }
        if (!started.enterForeground(buildNotification())) {
            postNotification();
            return;
        }
        if (!snapshot.wantsForeground()) started.leaveForeground();
    }

    private void applyServiceState() {
        if (snapshot == null) return;
        Notification notification = buildNotification();
        if (snapshot.wantsForeground()) {
            if (service != null) {
                if (!service.enterForeground(notification)) notifications.notify(NOTIFICATION_ID, notification);
            } else if (!serviceStarting) {
                startService(notification);
            }
        } else {
            if (service != null) service.leaveForeground();
            notifications.notify(NOTIFICATION_ID, notification);
        }
    }

    private void startService(Notification fallback) {
        try {
            ContextCompat.startForegroundService(app, new Intent(app, MediaPlaybackService.class));
            serviceStarting = true;
        } catch (IllegalStateException | SecurityException e) {
            // Android 12+ refused a foreground start from the background: keep the controls anyway
            MetrolistLog.w("Foreground service not started: " + e);
            notifications.notify(NOTIFICATION_ID, fallback);
        }
    }

    /* -------------------------------- notification and session ------------------------------ */

    private void postNotification() {
        if (snapshot != null) notifications.notify(NOTIFICATION_ID, buildNotification());
    }

    private void postNotificationIfShown() {
        if (snapshot == null) return;
        Notification notification = buildNotification();
        if (service != null && snapshot.wantsForeground()) {
            if (!service.enterForeground(notification)) notifications.notify(NOTIFICATION_ID, notification);
        } else {
            notifications.notify(NOTIFICATION_ID, notification);
        }
    }

    Notification buildNotification() {
        PlaybackSnapshot s = snapshot;
        boolean playing = s != null && s.wantsForeground();
        String title = s != null && !s.title.isEmpty() ? s.title : appLabel();
        NotificationCompat.Builder builder = new NotificationCompat.Builder(app, CHANNEL_ID)
            .setSmallIcon(R.drawable.metrolist_bp_ic_notification)
            .setContentTitle(title)
            .setContentText(s != null ? s.artist : "")
            .setLargeIcon(artworkBitmap)
            .setContentIntent(contentIntent())
            .setDeleteIntent(actionIntent(ACTION_DISMISS))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setOngoing(playing)
            .addAction(android.R.drawable.ic_media_previous, app.getString(R.string.metrolist_bp_previous), actionIntent(ACTION_PREVIOUS))
            .addAction(
                playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                app.getString(playing ? R.string.metrolist_bp_pause : R.string.metrolist_bp_play),
                actionIntent(playing ? ACTION_PAUSE : ACTION_PLAY)
            )
            .addAction(android.R.drawable.ic_media_next, app.getString(R.string.metrolist_bp_next), actionIntent(ACTION_NEXT))
            .setStyle(
                new androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(session.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2)
            );
        if (s != null && !s.album.isEmpty()) builder.setSubText(s.album);
        return builder.build();
    }

    private void publishMetadata() {
        PlaybackSnapshot s = snapshot;
        if (s == null) return;
        MediaMetadataCompat.Builder metadata = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.title)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, s.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, s.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.album);
        if (s.durationMs > 0) metadata.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, s.durationMs);
        if (artworkBitmap != null) metadata.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, artworkBitmap);
        session.setMetadata(metadata.build());
    }

    private void publishPlaybackState() {
        PlaybackSnapshot s = snapshot;
        if (s == null) return;
        int state;
        float speed = 0f;
        switch (s.state) {
            case PLAYING:
                state = PlaybackStateCompat.STATE_PLAYING;
                speed = 1f;
                break;
            case BUFFERING:
                state = PlaybackStateCompat.STATE_BUFFERING;
                break;
            default:
                state = PlaybackStateCompat.STATE_PAUSED;
                break;
        }
        session.setPlaybackState(
            new PlaybackStateCompat.Builder().setActions(SESSION_ACTIONS).setState(state, s.positionMs, speed, s.reportedAtElapsedMs).build()
        );
    }

    private void setNoisyReceiverRegistered(boolean register) {
        if (register == noisyReceiverRegistered) return;
        try {
            if (register) {
                IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
                if (Build.VERSION.SDK_INT >= 33) {
                    app.registerReceiver(noisyReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
                } else {
                    app.registerReceiver(noisyReceiver, filter);
                }
            } else {
                app.unregisterReceiver(noisyReceiver);
            }
            noisyReceiverRegistered = register;
        } catch (RuntimeException e) {
            MetrolistLog.w("Noisy-audio receiver: " + e);
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || notifications == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            app.getString(R.string.metrolist_bp_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(app.getString(R.string.metrolist_bp_channel_description));
        channel.setShowBadge(false);
        channel.setSound(null, null);
        channel.enableVibration(false);
        notifications.createNotificationChannel(channel);
    }

    private PendingIntent contentIntent() {
        Intent launch = app.getPackageManager().getLaunchIntentForPackage(app.getPackageName());
        if (launch == null) launch = new Intent();
        launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(app, 0, launch, immutableFlags());
    }

    private PendingIntent actionIntent(String action) {
        Intent intent = new Intent(app, PlaybackActionReceiver.class).setAction(action);
        return PendingIntent.getBroadcast(app, action.hashCode(), intent, immutableFlags());
    }

    private static int immutableFlags() {
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return flags;
    }

    private String appLabel() {
        CharSequence label = app.getApplicationInfo().loadLabel(app.getPackageManager());
        return label != null ? label.toString() : "Metrolist";
    }
}
