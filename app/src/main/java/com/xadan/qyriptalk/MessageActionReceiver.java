package com.xadan.qyriptalk;

import android.app.RemoteInput;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

import java.util.ArrayList;
import java.util.List;

/** Mesaj bildirimindeki "Yanıtla" (satır içi) ve "Okundu" butonları. */
public class MessageActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        String convKey = intent.getStringExtra(NotificationHelper.EXTRA_CONV_KEY);
        String path = intent.getStringExtra("path");
        if (action == null || convKey == null || path == null) return;

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
        }
    }
}
