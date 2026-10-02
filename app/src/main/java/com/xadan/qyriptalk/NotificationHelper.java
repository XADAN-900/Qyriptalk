package com.xadan.qyriptalk;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Mesaj (WhatsApp tarzı), arama ve arka plan servisi bildirimleri. */
final class NotificationHelper {

    static final String CH_MESSAGES = "messages_v1";
    static final String CH_CALLS = "calls_v1";
    static final String CH_SERVICE = "service_v1";

    static final int ID_SERVICE = 1;
    static final int ID_SUMMARY = 1999;
    static final int ID_CALL = 7001;

    static final String ACTION_ACCEPT = "com.xadan.qyriptalk.ACCEPT_CALL";
    static final String ACTION_DECLINE = "com.xadan.qyriptalk.DECLINE_CALL";
    static final String ACTION_SHOW_CALL = "com.xadan.qyriptalk.SHOW_CALL";
    static final String ACTION_REPLY = "com.xadan.qyriptalk.REPLY";
    static final String ACTION_MARK_READ = "com.xadan.qyriptalk.MARK_READ";
    static final String EXTRA_FROM_CALL = "from_call";
    static final String EXTRA_CONV_KEY = "conv_key";
    static final String KEY_REPLY = "reply_text";

    private static final String GROUP = "qyriptalk_messages";
    private static final int PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    private static final int BRAND_COLOR = 0xFF5E17EB;

    private static final class Msg {
        String sender;
        String text;
        long ts;
        String key;
        boolean self;
    }

    private static final class Conv {
        String key;
        int id;
        boolean room;
        String title;
        String path;
        final List<Msg> msgs = new ArrayList<>();
    }

    private static final Map<String, Conv> conversations = new HashMap<>();

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

    private static int convId(String convKey) {
        return 3000 + Math.abs(convKey.hashCode() % 5000);
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

    // ---------- Mesajlar: sohbet başına tek bildirim, MessagingStyle, Yanıtla / Okundu ----------

    static synchronized void showConversationMessage(Context c, String convKey, boolean room,
                                                     String title, String path, String sender,
                                                     String text, long ts, String msgKey) {
        Conv conv = conversations.get(convKey);
        if (conv == null) {
            conv = new Conv();
            conv.key = convKey;
            conv.id = convId(convKey);
            conversations.put(convKey, conv);
        }
        for (Msg x : conv.msgs) {
            if (msgKey != null && msgKey.equals(x.key)) return; // aynı mesaj (FCM + yerel dinleyici)
        }
        conv.room = room;
        conv.title = title;
        conv.path = path;

        Msg m = new Msg();
        m.sender = sender;
        m.text = text;
        m.ts = ts;
        m.key = msgKey;
        conv.msgs.add(m);
        while (conv.msgs.size() > 8) conv.msgs.remove(0);

        post(c, conv);
    }

    /** Bildirimden yazılan yanıtı sohbete ekleyip bildirimi günceller. */
    static synchronized void appendSelfReply(Context c, String convKey, String text) {
        Conv conv = conversations.get(convKey);
        if (conv == null) {
            nm(c).cancel(convId(convKey));
            return;
        }
        Msg m = new Msg();
        m.text = text;
        m.ts = System.currentTimeMillis();
        m.self = true;
        conv.msgs.add(m);
        while (conv.msgs.size() > 8) conv.msgs.remove(0);
        post(c, conv);
    }

    /** Sohbeti kapatır; okunmuş işaretlenecek mesaj anahtarlarını ve yolu döner. */
    static synchronized String[] dismissConversation(Context c, String convKey, List<String> outKeys) {
        Conv conv = conversations.remove(convKey);
        nm(c).cancel(convId(convKey));
        if (conversations.isEmpty()) nm(c).cancel(ID_SUMMARY);
        if (conv == null) return null;
        for (Msg m : conv.msgs) {
            if (!m.self && m.key != null) outKeys.add(m.key);
        }
        return new String[]{conv.path};
    }

    static synchronized void clearMessages(Context c) {
        NotificationManager nm = nm(c);
        for (Conv conv : conversations.values()) nm.cancel(conv.id);
        conversations.clear();
        nm.cancel(ID_SUMMARY);
    }

    private static void post(Context c, Conv conv) {
        Notification.MessagingStyle style = new Notification.MessagingStyle("Ben");
        if (conv.room) style.setConversationTitle(conv.title);
        for (Msg m : conv.msgs) {
            style.addMessage(m.text, m.ts, m.self ? null : m.sender);
        }
        Msg last = conv.msgs.get(conv.msgs.size() - 1);

        RemoteInput ri = new RemoteInput.Builder(KEY_REPLY).setLabel("Yanıtla").build();
        Intent replyI = new Intent(c, MessageActionReceiver.class)
                .setAction(ACTION_REPLY)
                .putExtra(EXTRA_CONV_KEY, conv.key)
                .putExtra("path", conv.path);
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent replyPI = PendingIntent.getBroadcast(c, conv.id * 2, replyI,
                PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        Notification.Action replyAction = new Notification.Action.Builder(0, "Yanıtla", replyPI)
                .addRemoteInput(ri)
                .build();

        Intent readI = new Intent(c, MessageActionReceiver.class)
                .setAction(ACTION_MARK_READ)
                .putExtra(EXTRA_CONV_KEY, conv.key)
                .putExtra("path", conv.path);
        PendingIntent readPI = PendingIntent.getBroadcast(c, conv.id * 2 + 1, readI, PI_FLAGS);

        Notification.Builder b = builder(c, CH_MESSAGES)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(conv.title)
                .setContentText(last.text)
                .setStyle(style)
                .setContentIntent(openApp(c))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setColor(BRAND_COLOR)
                .setGroup(GROUP)
                .setShowWhen(true)
                .setWhen(last.ts)
                .addAction(replyAction)
                .addAction(0, "Okundu", readPI);
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        }

        Notification.Builder summary = builder(c, CH_MESSAGES)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Qyriptalk")
                .setContentText("Yeni mesajlar")
                .setGroup(GROUP)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .setColor(BRAND_COLOR)
                .setContentIntent(openApp(c));
        if (Build.VERSION.SDK_INT >= 26) {
            summary.setGroupAlertBehavior(Notification.GROUP_ALERT_CHILDREN);
        }

        try {
            NotificationManager nm = nm(c);
            nm.notify(conv.id, b.build());
            nm.notify(ID_SUMMARY, summary.build());
        } catch (Exception ignored) {
        }
    }

    // ---------- Gelen arama ----------

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
                .setOnlyAlertOnce(true)
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
