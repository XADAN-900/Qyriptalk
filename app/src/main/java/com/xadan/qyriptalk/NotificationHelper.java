package com.xadan.qyriptalk;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import java.util.HashSet;
import java.util.Set;

/** Mesaj, arama ve arka plan servisi bildirimleri. */
final class NotificationHelper {

    static final String CH_MESSAGES = "messages_v1";
    static final String CH_CALLS = "calls_v1";
    static final String CH_SERVICE = "service_v1";

    static final int ID_SERVICE = 1;
    static final int ID_CALL = 7001;

    static final String ACTION_ACCEPT = "com.xadan.qyriptalk.ACCEPT_CALL";
    static final String ACTION_DECLINE = "com.xadan.qyriptalk.DECLINE_CALL";
    static final String ACTION_SHOW_CALL = "com.xadan.qyriptalk.SHOW_CALL";
    static final String EXTRA_FROM_CALL = "from_call";

    private static final int PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    private static final int BRAND_COLOR = 0xFF5E17EB;
    private static final Set<Integer> messageIds = new HashSet<>();

    private NotificationHelper() {
    }

    private static NotificationManager nm(Context c) {
        return (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private static Notification.Builder builder(Context c, String channel) {
        if (Build.VERSION.SDK_INT >= 26) {
            return new Notification.Builder(c, channel);
        }
        return new Notification.Builder(c);
    }

    static void createChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = nm(c);

        NotificationChannel messages = new NotificationChannel(CH_MESSAGES, "Mesajlar",
                NotificationManager.IMPORTANCE_HIGH);
        messages.enableVibration(true);
        nm.createNotificationChannel(messages);

        NotificationChannel calls = new NotificationChannel(CH_CALLS, "Gelen aramalar",
                NotificationManager.IMPORTANCE_HIGH);
        AudioAttributes aa = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        calls.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), aa);
        calls.enableVibration(true);
        calls.setVibrationPattern(new long[]{0, 800, 600, 800, 600, 800});
        calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(calls);

        NotificationChannel service = new NotificationChannel(CH_SERVICE, "Arka plan bağlantısı",
                NotificationManager.IMPORTANCE_LOW);
        service.setShowBadge(false);
        nm.createNotificationChannel(service);
    }

    private static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 0, i, PI_FLAGS);
    }

    /** Foreground service'in kalıcı (sessiz) bildirimi. */
    static Notification serviceNotification(Context c, boolean inCall) {
        Notification.Builder b = builder(c, CH_SERVICE)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Qyriptalk")
                .setContentText(inCall ? "Görüşme devam ediyor" : "Mesajlar ve aramalar için bağlı")
                .setContentIntent(openApp(c))
                .setOngoing(true)
                .setColor(BRAND_COLOR);
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_MIN);
        }
        return b.build();
    }

    /** WhatsApp tarzı mesaj bildirimi. Aynı oda/etiket için bildirim güncellenir. */
    static void showMessage(Context c, String title, String body, String tag) {
        String t = (tag == null || tag.isEmpty()) ? "message" : tag;
        int id = 2000 + Math.abs(t.hashCode() % 5000);

        Notification.Builder b = builder(c, CH_MESSAGES)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(openApp(c))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setColor(BRAND_COLOR)
                .setWhen(System.currentTimeMillis());
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        }

        synchronized (messageIds) {
            messageIds.add(id);
        }
        try {
            nm(c).notify(id, b.build());
        } catch (Exception ignored) {
        }
    }

    static void clearMessages(Context c) {
        NotificationManager nm = nm(c);
        synchronized (messageIds) {
            for (int id : messageIds) nm.cancel(id);
            messageIds.clear();
        }
    }

    /** Zil sesli, titreşimli, Cevapla/Reddet butonlu gelen arama bildirimi. */
    static void showIncomingCall(Context c, String callId, String title, String text) {
        Intent full = new Intent(c, MainActivity.class)
                .setAction(ACTION_SHOW_CALL)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_FROM_CALL, true);
        PendingIntent fullPI = PendingIntent.getActivity(c, 1, full, PI_FLAGS);

        Intent accept = new Intent(c, MainActivity.class)
                .setAction(ACTION_ACCEPT)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)
                .putExtra(EXTRA_FROM_CALL, true);
        PendingIntent acceptPI = PendingIntent.getActivity(c, 2, accept, PI_FLAGS);

        Intent decline = new Intent(c, CallActionReceiver.class).setAction(ACTION_DECLINE);
        PendingIntent declinePI = PendingIntent.getBroadcast(c, 3, decline, PI_FLAGS);

        Notification.Builder b = builder(c, CH_CALLS)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(text)
                .setCategory(Notification.CATEGORY_CALL)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setColor(BRAND_COLOR)
                .setContentIntent(fullPI)
                .setFullScreenIntent(fullPI, true)
                .addAction(0, "Reddet", declinePI)
                .addAction(0, "Cevapla", acceptPI);

        if (Build.VERSION.SDK_INT >= 26) {
            b.setTimeoutAfter(45000);
        } else {
            Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            b.setPriority(Notification.PRIORITY_MAX);
            b.setSound(ringtone, AudioManager.STREAM_RING);
            b.setVibrate(new long[]{0, 800, 600, 800, 600, 800});
        }

        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // cevaplanana kadar zil çalmaya devam
        try {
            nm(c).notify(ID_CALL, n);
        } catch (Exception ignored) {
        }
    }

    static void cancelCall(Context c) {
        nm(c).cancel(ID_CALL);
    }
}
