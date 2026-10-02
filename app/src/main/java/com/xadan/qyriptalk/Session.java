package com.xadan.qyriptalk;

import android.content.Context;
import android.content.SharedPreferences;

/** Web uygulamasındaki giriş yapmış kullanıcı (köprü üzerinden kaydedilir). */
final class Session {
    final String uid;
    final String username;
    final boolean notificationsEnabled;

    private Session(String uid, String username, boolean enabled) {
        this.uid = uid;
        this.username = username;
        this.notificationsEnabled = enabled;
    }

    boolean valid() {
        return uid != null && !uid.isEmpty();
    }

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences("session", Context.MODE_PRIVATE);
    }

    static Session load(Context c) {
        SharedPreferences p = prefs(c);
        return new Session(p.getString("uid", null), p.getString("username", ""),
                p.getBoolean("enabled", true));
    }

    static void save(Context c, String uid, String username, boolean enabled) {
        prefs(c).edit().putString("uid", uid).putString("username", username)
                .putBoolean("enabled", enabled).apply();
    }

    static void clear(Context c) {
        prefs(c).edit().clear().apply();
    }
}
