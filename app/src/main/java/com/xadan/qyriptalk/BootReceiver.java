package com.xadan.qyriptalk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Telefon yeniden başlayınca / uygulama güncellenince dinlemeyi geri getirir. */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (Session.load(context).valid()) {
            NotificationHelper.createChannels(context);
            KeepAliveService.ensureRunning(context);
        }
    }
}
