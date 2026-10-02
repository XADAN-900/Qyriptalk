package com.xadan.qyriptalk;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/** Sunucudan (Cloud Functions) gelen FCM push'ları: uygulama kapalıyken de çalışır. */
public class QyripMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(String token) {
        ChatWatcher.get(this).saveToken(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> d = message.getData();
        String type = d.get("type");
        if (type == null) return;

        NotificationHelper.createChannels(this);
        Session s = Session.load(this);
        if (!s.valid()) return;

        switch (type) {
            case "message": {
                if (MainActivity.visible || !s.notificationsEnabled) return;
                String convKey = d.get("convKey");
                String path = d.get("path");
                if (convKey == null || path == null) return;
                long ts = System.currentTimeMillis();
                try {
                    ts = Long.parseLong(d.get("ts"));
                } catch (Exception ignored) {
                }
                String sender = d.get("sender") != null ? d.get("sender") : "Qyriptalk";
                String title = d.get("title") != null ? d.get("title") : sender;
                NotificationHelper.showConversationMessage(this, convKey, "1".equals(d.get("room")),
                        title, path, sender, d.get("text") != null ? d.get("text") : "Yeni mesaj",
                        ts, d.get("msgKey"));
                break;
            }
            case "call": {
                if (MainActivity.visible) return;
                NotificationHelper.showIncomingCall(this, d.get("callId"),
                        d.get("title") != null ? d.get("title") : "Qyriptalk",
                        d.get("text") != null ? d.get("text") : "Sesli arıyor...");
                break;
            }
            case "call_end":
                NotificationHelper.cancelCall(this);
                break;
            default:
                break;
        }
    }
}
