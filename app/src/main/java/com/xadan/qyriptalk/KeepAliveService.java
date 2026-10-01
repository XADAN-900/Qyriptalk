package com.xadan.qyriptalk;

import android.Manifest;
import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Uygulama arka plana alındığında süreci canlı tutar; böylece Firebase bağlantısı
 * sürer ve mesaj / arama bildirimleri gelmeye devam eder.
 */
public class KeepAliveService extends Service {

    private static final String EXTRA_IN_CALL = "in_call";

    static void start(Context c, boolean inCall) {
        Intent i = new Intent(c, KeepAliveService.class).putExtra(EXTRA_IN_CALL, inCall);
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                c.startForegroundService(i);
            } else {
                c.startService(i);
            }
        } catch (Exception ignored) {
        }
    }

    static void stop(Context c) {
        try {
            c.stopService(new Intent(c, KeepAliveService.class));
        } catch (Exception ignored) {
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        boolean inCall = intent != null && intent.getBooleanExtra(EXTRA_IN_CALL, false);
        Notification n = NotificationHelper.serviceNotification(this, inCall);
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                int type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
                if (inCall && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                        == PackageManager.PERMISSION_GRANTED) {
                    type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
                }
                startForeground(NotificationHelper.ID_SERVICE, n, type);
            } else {
                startForeground(NotificationHelper.ID_SERVICE, n);
            }
        } catch (Exception e) {
            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    startForeground(NotificationHelper.ID_SERVICE, n,
                            ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
                } else {
                    startForeground(NotificationHelper.ID_SERVICE, n);
                }
            } catch (Exception e2) {
                stopSelf();
            }
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
