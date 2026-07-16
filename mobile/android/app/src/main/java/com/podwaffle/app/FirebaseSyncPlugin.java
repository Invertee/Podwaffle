package com.podwaffle.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "FirebaseSync")
public class FirebaseSyncPlugin extends Plugin {
    static final String PREFS = "podwaffle_firebase_sync";
    static final String CONFIG = "config";
    static final String PENDING = "pending";
    private static FirebaseSyncPlugin instance;

    @Override
    public void load() {
        instance = this;
        ensureInitialized(getContext());
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        try {
            JSObject config = new JSObject();
            config.put("apiKey", call.getString("apiKey", ""));
            config.put("applicationId", call.getString("applicationId", ""));
            config.put("projectId", call.getString("projectId", ""));
            config.put("gcmSenderId", call.getString("gcmSenderId", ""));
            getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(CONFIG, config.toString()).apply();
            if (!ensureInitialized(getContext())) {
                call.reject("Firebase configuration is incomplete");
                return;
            }
            FirebaseMessaging.getInstance().setAutoInitEnabled(true);
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (!task.isSuccessful()) {
                    call.reject("Unable to obtain FCM token", task.getException());
                    return;
                }
                JSObject result = new JSObject();
                result.put("token", task.getResult());
                call.resolve(result);
            });
        } catch (Exception error) {
            call.reject("Unable to initialize Firebase", error);
        }
    }

    @PluginMethod
    public void getPendingMessages(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(PENDING, "[]");
        prefs.edit().putString(PENDING, "[]").apply();
        try {
            call.resolve(new JSObject().put("messages", new JSArray(raw)));
        } catch (Exception error) {
            call.resolve(new JSObject().put("messages", new JSArray()));
        }
    }

    static boolean ensureInitialized(Context context) {
        if (!FirebaseApp.getApps(context).isEmpty()) return true;
        try {
            String raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CONFIG, "");
            if (raw.isEmpty()) return false;
            JSONObject config = new JSONObject(raw);
            String apiKey = config.optString("apiKey");
            String applicationId = config.optString("applicationId");
            String projectId = config.optString("projectId");
            String senderId = config.optString("gcmSenderId");
            if (apiKey.isEmpty() || applicationId.isEmpty() || projectId.isEmpty() || senderId.isEmpty()) return false;
            FirebaseOptions options = new FirebaseOptions.Builder()
                .setApiKey(apiKey)
                .setApplicationId(applicationId)
                .setProjectId(projectId)
                .setGcmSenderId(senderId)
                .build();
            FirebaseApp.initializeApp(context, options);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    static boolean emit(JSObject message) {
        FirebaseSyncPlugin current = instance;
        if (current == null) return false;
        current.notifyListeners("messageReceived", message, true);
        return true;
    }
}
