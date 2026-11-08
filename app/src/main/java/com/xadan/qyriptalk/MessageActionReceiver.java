package com.xadan.qyriptalk;

import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import java.util.ArrayList;
import java.util.List;

/** Mesaj bildirimindeki "Yanıtla" (satır içi), "Okundu" ve "Sessize al" butonları. */
public class MessageActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        String convKey = intent.getStringExtra(NotificationHelper.EXTRA_CONV_KEY);
        String path = intent.getStringExtra("path");
        if (action == null || convKey == null || path == null) return;

        // "Bildirimi dene" ile gelen örnek bildirim: veritabanına hiçbir şey yazma, sadece kapat
        if (convKey.startsWith("test:")) {
            NotificationHelper.dismissConversation(context, convKey, new ArrayList<>());
            return;
        }

        if (NotificationHelper.ACTION_REPLY.equals(action)) {
            Bundle results = RemoteInput.getResultsFromIntent(intent);
            CharSequence text = results == null ? null : results.getCharSequence(NotificationHelper.KEY_REPLY);
            if (text == null || text.toString().trim().isEmpty()) return;
            ChatWatcher.get(context).sendMessage(path, text.toString().trim());
            NotificationHelper.appendSelfReply(context, convKey, text.toString().trim());
        } else if (NotificationHelper.ACTION_MARK_READ.equals(action)) {
            List<String> keys = new ArrayList<>();
            NotificationHelper.dismissConversation(context, convKey, keys);
            if (!keys.isEmpty()) ChatWatcher.get(context).markRead(path, keys);
        } else if (NotificationHelper.ACTION_MUTE.equals(action)) {
            // Sohbeti 8 saat sessize al: bildirimi kapat, bu sürede yeni bildirim gösterme
            Session.mute(context, convKey, System.currentTimeMillis() + NotificationHelper.MUTE_MS);
            NotificationHelper.dismissConversation(context, convKey, new ArrayList<>());
            android.widget.Toast.makeText(context, "Sohbet 8 saat sessize alındı", android.widget.Toast.LENGTH_SHORT).show();
        }
    }
}
