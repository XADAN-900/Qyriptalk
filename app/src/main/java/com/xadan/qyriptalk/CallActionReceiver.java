package com.xadan.qyriptalk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Bildirimdeki "Reddet" (gelen arama) ve "Aramayı bitir" (süren görüşme) butonları. */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        MainActivity a = MainActivity.current;
        if (NotificationHelper.ACTION_DECLINE.equals(action)) {
            NotificationHelper.cancelCall(context);
            if (a != null) {
                a.runJs("if(typeof declineIncomingCall==='function'){declineIncomingCall();}");
            }
        } else if (NotificationHelper.ACTION_HANGUP.equals(action)) {
            if (a != null) {
                a.runJs("if(typeof leaveCall==='function'){leaveCall();}");
            }
            KeepAliveService.start(context, false);
        }
    }
}
