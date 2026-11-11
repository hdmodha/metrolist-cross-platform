package com.metrolist.backgroundplayback;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Buttons of the media notification (previous, play / pause, next) and its dismissal. Not
 * exported: only the notification's PendingIntents reach it. It never starts an activity
 * (Android 12+ forbids notification trampolines); the controller forwards the command to the page.
 */
public class PlaybackActionReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        PlaybackController.get(context).onNotificationAction(intent.getAction());
    }
}
