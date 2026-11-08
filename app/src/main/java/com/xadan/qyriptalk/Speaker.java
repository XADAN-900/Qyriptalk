package com.xadan.qyriptalk;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * "Gelen mesajları sesli oku" ayarı: bildirim gelince gönderen ve mesaj metin okuma ile söylenir.
 * Telefon sessiz / titreşim modundaysa ya da arama sürerken okunmaz.
 */
final class Speaker {

    private static TextToSpeech tts;
    private static boolean ready = false;
    private static boolean initializing = false;
    private static final List<String> pending = new ArrayList<>();
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static final Runnable shutdown = Speaker::release;

    private Speaker() {
    }

    static void say(Context ctx, String sender, String text, String roomTitle) {
        final Context c = ctx.getApplicationContext();
        AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            if (am.getRingerMode() != AudioManager.RINGER_MODE_NORMAL) return;
            int mode = am.getMode();
            if (mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION) return;
        }
        String body = text == null ? "" : text;
        if (body.length() > 220) body = body.substring(0, 220) + "...";
        final String line = (roomTitle != null && !roomTitle.isEmpty())
                ? roomTitle + " odasında " + sender + " yazdı: " + body
                : sender + " yazdı: " + body;
        main.post(() -> speakNow(c, line));
    }

    private static void speakNow(Context c, String line) {
        main.removeCallbacks(shutdown);
        main.postDelayed(shutdown, 60_000); // bir dakika boşta kalırsa motoru kapat (pil)
        if (ready && tts != null) {
            doSpeak(line);
            return;
        }
        pending.add(line);
        if (initializing) return;
        initializing = true;
        try {
            tts = new TextToSpeech(c, status -> main.post(() -> {
                initializing = false;
                if (status != TextToSpeech.SUCCESS || tts == null) {
                    pending.clear();
                    release();
                    return;
                }
                Locale tr = new Locale("tr", "TR");
                int r = tts.setLanguage(tr);
                if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
                    tts.setLanguage(Locale.getDefault());
                }
                if (Build.VERSION.SDK_INT >= 21) {
                    tts.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build());
                }
                ready = true;
                for (String p : pending) doSpeak(p);
                pending.clear();
            }));
        } catch (Exception e) {
            initializing = false;
            pending.clear();
        }
    }

    private static void doSpeak(String line) {
        try {
            tts.speak(line, TextToSpeech.QUEUE_ADD, null, "qt-" + System.nanoTime());
        } catch (Exception ignored) {
        }
    }

    private static void release() {
        ready = false;
        initializing = false;
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) {
            }
            tts = null;
        }
    }
}
