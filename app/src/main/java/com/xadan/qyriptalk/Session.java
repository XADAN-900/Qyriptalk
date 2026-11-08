package com.xadan.qyriptalk;

import android.content.Context;
import android.content.SharedPreferences;

/** Web uygulamasındaki giriş yapmış kullanıcı ve bildirim tercihleri (köprü üzerinden kaydedilir). */
final class Session {
    final String uid;
    final String username;
    final boolean notificationsEnabled;
    /** Mesaj bildirimi sesli mi (Ayarlar > Ses Bildirimleri). */
    final boolean soundEnabled;
    /** Kilit ekranında mesaj içeriği görünsün mü. */
    final boolean lockscreenPreview;
    /** Gelen mesajlar sesli okunsun mu (metin okuma). */
    final boolean speakMessages;

    private Session(SharedPreferences p, SharedPreferences prefs) {
        this.uid = p.getString("uid", null);
        this.username = p.getString("username", "");
        this.notificationsEnabled = p.getBoolean("enabled", true);
        this.soundEnabled = prefs.getBoolean("sound", true);
        this.lockscreenPreview = prefs.getBoolean("preview", true);
        this.speakMessages = prefs.getBoolean("speak", false);
    }

    boolean valid() {
        return uid != null && !uid.isEmpty();
    }

    private static SharedPreferences session(Context c) {
        return c.getApplicationContext().getSharedPreferences("session", Context.MODE_PRIVATE);
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences("notif_prefs", Context.MODE_PRIVATE);
    }

    static Session load(Context c) {
        return new Session(session(c), prefs(c));
    }

    static void save(Context c, String uid, String username, boolean enabled) {
        session(c).edit().putString("uid", uid).putString("username", username)
                .putBoolean("enabled", enabled).apply();
    }

    static void savePrefs(Context c, boolean sound, boolean preview, boolean speak) {
        prefs(c).edit().putBoolean("sound", sound).putBoolean("preview", preview)
                .putBoolean("speak", speak).apply();
    }

    static void clear(Context c) {
        session(c).edit().clear().apply();
        prefs(c).edit().remove("muted").apply();
        c.getApplicationContext().getSharedPreferences("muted_convs", Context.MODE_PRIVATE)
                .edit().clear().apply();
    }

    // ---------- sohbet sessize alma (bildirimdeki "Sessize al") ----------

    private static SharedPreferences muted(Context c) {
        return c.getApplicationContext().getSharedPreferences("muted_convs", Context.MODE_PRIVATE);
    }

    static void mute(Context c, String convKey, long untilMs) {
        muted(c).edit().putLong(convKey, untilMs).apply();
    }

    static boolean isMuted(Context c, String convKey) {
        long until = muted(c).getLong(convKey, 0);
        if (until == 0) return false;
        if (System.currentTimeMillis() < until) return true;
        muted(c).edit().remove(convKey).apply();
        return false;
    }

    // ---------- tek seferlik sorular (tam ekran arama izni vb.) ----------

    static boolean askedOnce(Context c, String key) {
        SharedPreferences p = prefs(c);
        if (p.getBoolean("asked_" + key, false)) return true;
        p.edit().putBoolean("asked_" + key, true).apply();
        return false;
    }
}
