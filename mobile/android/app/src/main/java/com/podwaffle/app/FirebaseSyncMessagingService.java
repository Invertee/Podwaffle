package com.podwaffle.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Map;

public class FirebaseSyncMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        JSObject message = new JSObject();
        for (Map.Entry<String, String> entry : remoteMessage.getData().entrySet()) {
            message.put(entry.getKey(), entry.getValue());
        }
        if (!FirebaseSyncPlugin.emit(message)) queueMessage(message);
    }

    @Override
    public void onNewToken(String token) {
        JSObject message = new JSObject();
        message.put("type", "token_refresh");
        message.put("token", token);
        if (!FirebaseSyncPlugin.emit(message)) queueMessage(message);
    }

    private void queueMessage(JSObject message) {
        SharedPreferences prefs = getSharedPreferences(FirebaseSyncPlugin.PREFS, Context.MODE_PRIVATE);
        try {
            JSONArray pending = new JSONArray(prefs.getString(FirebaseSyncPlugin.PENDING, "[]"));
            pending.put(new JSONObject(message.toString()));
            while (pending.length() > 50) pending.remove(0);
            prefs.edit().putString(FirebaseSyncPlugin.PENDING, pending.toString()).apply();
        } catch (Exception ignored) { }
    }
}
