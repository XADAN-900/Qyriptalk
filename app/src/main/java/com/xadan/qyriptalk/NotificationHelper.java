package com.xadan.qyriptalk;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.app.RemoteInput;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.drawable.Icon;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Mesaj (WhatsApp tarzı), arama ve arka plan servisi bildirimleri. */
final class NotificationHelper {

    // Kanal ayarları (ses vb.) oluşturulduktan sonra değiştirilemediği için yeni kimlikler kullanılır.
    static final String CH_MESSAGES = "messages_v2";        // Qyriptalk mesaj sesi + titreşim
    static final String CH_MESSAGES_QUIET = "messages_quiet_v2"; // sessiz (Ayarlar'da ses kapalıysa)
    static final String CH_CALLS = "calls_v1";
    static final String CH_SERVICE = "service_v1";
    private static final String CH_OLD_MESSAGES = "messages_v1";

    static final int ID_SERVICE = 1;
    static final int ID_SUMMARY = 1999;
    static final int ID_CALL = 7001;

    static final String ACTION_ACCEPT = "com.xadan.qyriptalk.ACCEPT_CALL";
    static final String ACTION_DECLINE = "com.xadan.qyriptalk.DECLINE_CALL";
    static final String ACTION_HANGUP = "com.xadan.qyriptalk.HANGUP_CALL";
    static final String ACTION_SHOW_CALL = "com.xadan.qyriptalk.SHOW_CALL";
    static final String ACTION_REPLY = "com.xadan.qyriptalk.REPLY";
    static final String ACTION_MARK_READ = "com.xadan.qyriptalk.MARK_READ";
    static final String ACTION_MUTE = "com.xadan.qyriptalk.MUTE";
    static final String EXTRA_FROM_CALL = "from_call";
    static final String EXTRA_CONV_KEY = "conv_key";
    static final String KEY_REPLY = "reply_text";

    static final long MUTE_MS = 8L * 60 * 60 * 1000; // "Sessize al" = 8 saat

    private static final String GROUP = "qyriptalk_messages";
    private static final int PI_FLAGS = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
    private static final int BRAND_COLOR = 0xFF5E17EB;
    private static final long[] MSG_VIBRATION = {0, 180, 120, 180};

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
        int unread = 0;
    }

    private static final Map<String, Conv> conversations = new HashMap<>();
    private static final Map<String, Icon> avatarCache = new HashMap<>();
    private static long callStartedAt = 0;

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

    static Uri messageSound(Context c) {
        return Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + c.getPackageName()
                + "/" + R.raw.qyrip_message);
    }

    static void createChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = nm(c);

        try {
            nm.deleteNotificationChannel(CH_OLD_MESSAGES); // eski (sessiz/varsayılan) kanal
        } catch (Exception ignored) {
        }

        AudioAttributes notifAttrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();

        NotificationChannel messages = new NotificationChannel(CH_MESSAGES, "Mesajlar",
                NotificationManager.IMPORTANCE_HIGH);
        messages.setDescription("Özel mesajlar ve oda mesajları (sesli)");
        messages.setSound(messageSound(c), notifAttrs);
        messages.enableVibration(true);
        messages.setVibrationPattern(MSG_VIBRATION);
        messages.enableLights(true);
        messages.setLightColor(BRAND_COLOR);
        messages.setShowBadge(true);
        nm.createNotificationChannel(messages);

        NotificationChannel quiet = new NotificationChannel(CH_MESSAGES_QUIET, "Mesajlar (sessiz)",
                NotificationManager.IMPORTANCE_HIGH);
        quiet.setDescription("Ayarlar'da ses bildirimleri kapalıyken kullanılır");
        quiet.setSound(null, null);
        quiet.enableVibration(true);
        quiet.setVibrationPattern(MSG_VIBRATION);
        quiet.setShowBadge(true);
        nm.createNotificationChannel(quiet);

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
        calls.setBypassDnd(true);
        nm.createNotificationChannel(calls);

        NotificationChannel service = new NotificationChannel(CH_SERVICE, "Arka plan bağlantısı",
                NotificationManager.IMPORTANCE_LOW);
        service.setShowBadge(false);
        service.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(service);
    }

    /** Android 14+: tam ekran arama bildirimi izni (kilit ekranında arama ekranı) var mı? */
    static boolean canUseFullScreen(Context c) {
        if (Build.VERSION.SDK_INT < 34) return true;
        try {
            return nm(c).canUseFullScreenIntent();
        } catch (Exception e) {
            return true;
        }
    }

    private static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 0, i, PI_FLAGS);
    }

    // ---------- harf avatarı (bildirimde gönderenin yuvarlak resmi) ----------

    private static final int[] AVATAR_COLORS = {
            0xFF5E17EB, 0xFF0EA5E9, 0xFF10B981, 0xFFF59E0B, 0xFFEF4444, 0xFFEC4899, 0xFF8B5CF6, 0xFF14B8A6
    };

    private static Icon avatar(String name) {
        if (Build.VERSION.SDK_INT < 23) return null;
        String n = (name == null || name.trim().isEmpty()) ? "Q" : name.trim();
        Icon cached = avatarCache.get(n);
        if (cached != null) return cached;
        try {
            int size = 128;
            Bitmap bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas cv = new Canvas(bmp);
            Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
            bg.setColor(AVATAR_COLORS[Math.abs(n.hashCode()) % AVATAR_COLORS.length]);
            cv.drawCircle(size / 2f, size / 2f, size / 2f, bg);
            Paint tp = new Paint(Paint.ANTI_ALIAS_FLAG);
            tp.setColor(0xFFFFFFFF);
            tp.setTextSize(size * 0.48f);
            tp.setFakeBoldText(true);
            tp.setTextAlign(Paint.Align.CENTER);
            String letter = n.substring(0, n.offsetByCodePoints(0, 1)).toUpperCase(new Locale("tr", "TR"));
            Rect r = new Rect();
            tp.getTextBounds(letter, 0, letter.length(), r);
            cv.drawText(letter, size / 2f, size / 2f + r.height() / 2f, tp);
            Icon icon = Icon.createWithBitmap(bmp);
            if (avatarCache.size() > 60) avatarCache.clear();
            avatarCache.put(n, icon);
            return icon;
        } catch (Exception e) {
            return null;
        }
    }

    private static Person person(String name, String key) {
        Person.Builder b = new Person.Builder().setName(name == null || name.isEmpty() ? "Qyriptalk" : name);
        if (key != null) b.setKey(key);
        Icon i = avatar(name);
        if (i != null) b.setIcon(i);
        return b.build();
    }

    /** Foreground service'in kalıcı (sessiz) bildirimi. Görüşmede süre sayacı ve "Bitir" butonu gösterir. */
    static Notification serviceNotification(Context c, boolean inCall) {
        Notification.Builder b = builder(c, CH_SERVICE)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(inCall ? "Qyriptalk · Görüşme" : "Qyriptalk")
                .setContentText(inCall ? "Görüşme devam ediyor" : "Mesajlar ve aramalar için bağlı")
                .setContentIntent(openApp(c))
                .setOngoing(true)
                .setColor(BRAND_COLOR);
        if (inCall) {
            if (callStartedAt == 0) callStartedAt = System.currentTimeMillis();
            Intent hang = new Intent(c, CallActionReceiver.class).setAction(ACTION_HANGUP);
            PendingIntent hangPI = PendingIntent.getBroadcast(c, 4, hang, PI_FLAGS);
            b.setUsesChronometer(true)
                    .setWhen(callStartedAt)
                    .setShowWhen(true)
                    .setCategory(Notification.CATEGORY_CALL)
                    .setVisibility(Notification.VISIBILITY_PUBLIC) // kilit ekranında da görünür
                    .addAction(0, "Aramayı bitir", hangPI);
        } else {
            callStartedAt = 0;
            b.setVisibility(Notification.VISIBILITY_SECRET);
        }
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(inCall ? Notification.PRIORITY_DEFAULT : Notification.PRIORITY_MIN);
        }
        return b.build();
    }

    // ---------- Mesajlar: sohbet başına tek bildirim, MessagingStyle, Yanıtla / Okundu / Sessize al ----------

    static synchronized void showConversationMessage(Context c, String convKey, boolean room,
                                                     String title, String path, String sender,
                                                     String text, long ts, String msgKey) {
        if (Session.isMuted(c, convKey)) return;
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
        conv.unread++;
        while (conv.msgs.size() > 8) conv.msgs.remove(0);

        post(c, conv, true);

        Session s = Session.load(c);
        if (s.speakMessages) Speaker.say(c, sender, text, room ? title : null);
    }

    /** Bildirimden yazılan yanıtı sohbete ekleyip bildirimi (sessizce) günceller. */
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
        conv.unread = 0;
        while (conv.msgs.size() > 8) conv.msgs.remove(0);
        post(c, conv, false);
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

    private static int totalUnread() {
        int n = 0;
        for (Conv cv : conversations.values()) n += cv.unread;
        return n;
    }

    private static Notification.Style buildStyle(Conv conv) {
        if (Build.VERSION.SDK_INT >= 28) {
            Notification.MessagingStyle style = new Notification.MessagingStyle(person("Ben", "me"));
            if (conv.room) {
                style.setConversationTitle(conv.title);
                style.setGroupConversation(true);
            }
            for (Msg m : conv.msgs) {
                Person p = m.self ? null : person(m.sender, "u:" + m.sender);
                style.addMessage(new Notification.MessagingStyle.Message(m.text, m.ts, p));
            }
            return style;
        }
        Notification.MessagingStyle style = new Notification.MessagingStyle("Ben");
        if (conv.room) style.setConversationTitle(conv.title);
        for (Msg m : conv.msgs) {
            style.addMessage(m.text, m.ts, m.self ? null : m.sender);
        }
        return style;
    }

    private static void post(Context c, Conv conv, boolean alert) {
        Session s = Session.load(c);
        String channel = s.soundEnabled ? CH_MESSAGES : CH_MESSAGES_QUIET;
        Msg last = conv.msgs.get(conv.msgs.size() - 1);
        int unread = Math.max(conv.unread, 0);

        RemoteInput ri = new RemoteInput.Builder(KEY_REPLY).setLabel("Yanıtla").build();
        Intent replyI = new Intent(c, MessageActionReceiver.class)
                .setAction(ACTION_REPLY)
                .putExtra(EXTRA_CONV_KEY, conv.key)
                .putExtra("path", conv.path);
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent replyPI = PendingIntent.getBroadcast(c, conv.id * 3, replyI,
                PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        Notification.Action.Builder replyB = new Notification.Action.Builder(
                Icon.createWithResource(c, R.drawable.ic_notification), "Yanıtla", replyPI)
                .addRemoteInput(ri);
        if (Build.VERSION.SDK_INT >= 28) replyB.setSemanticAction(Notification.Action.SEMANTIC_ACTION_REPLY);
        if (Build.VERSION.SDK_INT >= 24) replyB.setAllowGeneratedReplies(true);

        Intent readI = new Intent(c, MessageActionReceiver.class)
                .setAction(ACTION_MARK_READ)
                .putExtra(EXTRA_CONV_KEY, conv.key)
                .putExtra("path", conv.path);
        PendingIntent readPI = PendingIntent.getBroadcast(c, conv.id * 3 + 1, readI, PI_FLAGS);
        Notification.Action.Builder readB = new Notification.Action.Builder(
                Icon.createWithResource(c, R.drawable.ic_notification), "Okundu", readPI);
        if (Build.VERSION.SDK_INT >= 28) readB.setSemanticAction(Notification.Action.SEMANTIC_ACTION_MARK_AS_READ);

        Intent muteI = new Intent(c, MessageActionReceiver.class)
                .setAction(ACTION_MUTE)
                .putExtra(EXTRA_CONV_KEY, conv.key)
                .putExtra("path", conv.path);
        PendingIntent mutePI = PendingIntent.getBroadcast(c, conv.id * 3 + 2, muteI, PI_FLAGS);
        Notification.Action.Builder muteB = new Notification.Action.Builder(
                Icon.createWithResource(c, R.drawable.ic_notification), "Sessize al (8 sa)", mutePI);
        if (Build.VERSION.SDK_INT >= 28) muteB.setSemanticAction(Notification.Action.SEMANTIC_ACTION_MUTE);

        // Kilit ekranı: içerik gizliyse sadece "Yeni mesaj" yazan sade bir sürüm gösterilir
        Notification publicVersion = builder(c, channel)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Qyriptalk")
                .setContentText(unread > 1 ? unread + " yeni mesaj" : "Yeni mesaj")
                .setColor(BRAND_COLOR)
                .build();

        Notification.Builder b = builder(c, channel)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(conv.title)
                .setContentText(conv.room && last.sender != null && !last.self ? last.sender + ": " + last.text : last.text)
                .setStyle(buildStyle(conv))
                .setContentIntent(openApp(c))
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setColor(BRAND_COLOR)
                .setGroup(GROUP)
                .setShowWhen(true)
                .setWhen(last.ts)
                .setNumber(unread)
                .setOnlyAlertOnce(!alert)
                .setVisibility(Notification.VISIBILITY_PRIVATE)
                .setPublicVersion(publicVersion)
                .addAction(replyB.build())
                .addAction(readB.build())
                .addAction(muteB.build());
        if (s.lockscreenPreview) {
            // İçerik kilit ekranında görünsün (WhatsApp varsayılanı gibi)
            b.setVisibility(Notification.VISIBILITY_PUBLIC);
        }
        if (Build.VERSION.SDK_INT >= 23 && !conv.room) {
            Icon av = avatar(conv.title);
            if (av != null) b.setLargeIcon(av);
        }
        if (Build.VERSION.SDK_INT < 26) {
            b.setPriority(Notification.PRIORITY_HIGH).setVibrate(MSG_VIBRATION).setLights(BRAND_COLOR, 600, 2000);
            if (s.soundEnabled) {
                b.setSound(messageSound(c), AudioManager.STREAM_NOTIFICATION);
            }
        }

        int total = totalUnread();
        Notification.Builder summary = builder(c, channel)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Qyriptalk")
                .setContentText(total > 1 ? total + " yeni mesaj" : "Yeni mesaj")
                .setSubText(conversations.size() > 1 ? conversations.size() + " sohbet" : null)
                .setGroup(GROUP)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .setNumber(total)
                .setColor(BRAND_COLOR)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
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

    /** Zil sesli, titreşimli, Cevapla/Reddet butonlu gelen arama bildirimi (kilit ekranında tam ekran). */
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

        Notification n = null;
        if (Build.VERSION.SDK_INT >= 31) {
            // Android 12+: sistemin arama görünümü (kilit ekranında büyük Cevapla / Reddet)
            try {
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
                        .setColorized(true)
                        .setContentIntent(fullPI)
                        .setFullScreenIntent(fullPI, true)
                        .setTimeoutAfter(45000)
                        .setStyle(Notification.CallStyle.forIncomingCall(person(title, "call"), declinePI, acceptPI));
                n = b.build();
            } catch (Exception ignored) {
                n = null;
            }
        }
        if (n == null) {
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
            if (Build.VERSION.SDK_INT >= 23) {
                Icon av = avatar(title);
                if (av != null) b.setLargeIcon(av);
            }
            if (Build.VERSION.SDK_INT >= 26) {
                b.setTimeoutAfter(45000);
            } else {
                Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                b.setPriority(Notification.PRIORITY_MAX);
                b.setSound(ringtone, AudioManager.STREAM_RING);
                b.setVibrate(new long[]{0, 800, 600, 800, 600, 800});
            }
            n = b.build();
        }
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
