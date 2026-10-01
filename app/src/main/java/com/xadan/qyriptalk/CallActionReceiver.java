package com.xadan.qyriptalk;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Bildirimdeki "Reddet" butonu. */
public class CallActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (NotificationHelper.ACTION_DECLINE.equals(intent.getAction())) {
            NotificationHelper.cancelCall(context);
            MainActivity a = MainActivity.current;
            if (a != null) {
                a.runJs("if(typeof declineIncomingCall==='function'){declineIncomingCall();}");
            }
        }
    }
}
