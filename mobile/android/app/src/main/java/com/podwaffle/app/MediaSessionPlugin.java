package com.podwaffle.app;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.IBinder;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@CapacitorPlugin(name = "MediaSession")
public class MediaSessionPlugin extends Plugin {
    private static final String TAG = "MediaSessionPlugin";

    private boolean startServiceOnlyDuringPlayback = true;

    private String title = "";
    private String artist = "";
    private String album = "";
    private Bitmap artwork = null;
    private String playbackState = "none";
    private double duration = 0.0;
    private double position = 0.0;
    private double playbackRate = 1.0;
    private final Map<String, PluginCall> actionHandlers = new HashMap<>();

    public static boolean isCastActive = false;

    @PluginMethod
    public void setCastActive(PluginCall call) {
        isCastActive = call.getBoolean("active", false);
        call.resolve();
    }

    private MediaSessionService service = null;

    private final ServiceConnection serviceConnection = new ServiceConnection() {
        @Override
        public void onServiceConnected(ComponentName componentName, IBinder iBinder) {
            MediaSessionService.LocalBinder binder = (MediaSessionService.LocalBinder) iBinder;
            service = binder.getService();
            Intent intent = new Intent(getActivity(), getActivity().getClass());
            service.connectAndInitialize(MediaSessionPlugin.this, intent);
            updateServiceMetadata();
            updateServicePlaybackState();
            updateServicePositionState();
            // Re-apply any action handlers that were registered from JS before the
            // service had a chance to bind (e.g. setActionHandler calls that arrived
            // while the service was starting up).
            service.updatePossibleActions();
        }

        @Override
        public void onServiceDisconnected(ComponentName componentName) {
            Log.d(TAG, "Disconnected from MediaSessionService");
            service = null;
        }
    };

    @Override
    public void load() {
        super.load();

        final String foregroundServiceConfig = getConfig().getString("foregroundService", "");
        if (foregroundServiceConfig.equals("always")) {
            startServiceOnlyDuringPlayback = false;
        }

        if (!startServiceOnlyDuringPlayback) {
            startMediaService();
        }
    }

    public void startMediaService() {
        if (service != null) return;
        try {
            Intent intent = new Intent(getActivity(), MediaSessionService.class);
            ContextCompat.startForegroundService(getContext(), intent);
            getContext().bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start MediaSessionService: " + e.getMessage(), e);
        }
    }

    private void updateServiceMetadata() {
        if (service != null) {
            service.setTitle(title);
            service.setArtist(artist);
            service.setAlbum(album);
            service.setArtwork(artwork);
            service.update();
        }
    }

    private Bitmap urlToBitmap(String urlStr) throws IOException {
        if (urlStr == null) return null;
        final boolean blobUrl = urlStr.startsWith("blob:");
        if (blobUrl) {
            Log.i(TAG, "Converting Blob URLs to Bitmap for media artwork is not yet supported");
            return null;
        }

        final boolean httpUrl = urlStr.startsWith("http");
        if (httpUrl) {
            HttpURLConnection connection = null;
            InputStream inputStream = null;
            try {
                URL url = new URL(urlStr);
                connection = (HttpURLConnection) url.openConnection();
                connection.setDoInput(true);
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                connection.connect();
                inputStream = connection.getInputStream();
                return BitmapFactory.decodeStream(inputStream);
            } finally {
                if (inputStream != null) {
                    try { inputStream.close(); } catch (Exception e) {}
                }
                if (connection != null) {
                    try { connection.disconnect(); } catch (Exception e) {}
                }
            }
        }

        int base64Index = urlStr.indexOf(";base64,");
        if (base64Index != -1) {
            String base64Data = urlStr.substring(base64Index + 8);
            byte[] decoded = Base64.decode(base64Data, Base64.DEFAULT);
            return BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
        }

        return null;
    }

    @PluginMethod
    public void setMetadata(final PluginCall call) {
        title = call.getString("title", title);
        artist = call.getString("artist", artist);
        album = call.getString("album", album);

        final JSArray artworkArray = call.getArray("artwork");
        
        new Thread(new Runnable() {
            @Override
            public void run() {
                Bitmap decodedArtwork = null;
                try {
                    if (artworkArray != null && artworkArray.length() > 0) {
                        List<Object> list = artworkArray.toList();
                        for (Object obj : list) {
                            String src = null;
                            if (obj instanceof Map) {
                                src = (String) ((Map) obj).get("src");
                            } else if (obj instanceof JSONObject) {
                                src = ((JSONObject) obj).optString("src", null);
                            }
                            if (src != null) {
                                decodedArtwork = urlToBitmap(src);
                            }
                        }
                    }
                } catch (Exception e) {
                    Log.w(TAG, "Failed to download media artwork: " + e.getMessage());
                }

                final Bitmap finalArtwork = decodedArtwork;
                getBridge().executeOnMainThread(new Runnable() {
                    @Override
                    public void run() {
                        artwork = finalArtwork;
                        updateServiceMetadata();
                        call.resolve();
                    }
                });
            }
        }).start();
    }

    private void updateServicePlaybackState() {
        if (service != null) {
            if (playbackState.equals("playing")) {
                service.setPlaybackState(PlaybackStateCompat.STATE_PLAYING);
                service.update();
            } else if (playbackState.equals("paused")) {
                service.setPlaybackState(PlaybackStateCompat.STATE_PAUSED);
                service.update();
            } else {
                service.setPlaybackState(PlaybackStateCompat.STATE_NONE);
                service.update();
            }
        }
    }

    @PluginMethod
    public void setPlaybackState(PluginCall call) {
        playbackState = call.getString("playbackState", playbackState);

        final boolean playback = playbackState.equals("playing") || playbackState.equals("paused");
        if (startServiceOnlyDuringPlayback && service == null && playback) {
            startMediaService();
        } else if (startServiceOnlyDuringPlayback && service != null && !playback) {
            try {
                getContext().unbindService(serviceConnection);
            } catch (Exception e) {
                Log.w(TAG, "Failed to unbind service connection: " + e.getMessage());
            }
            service.destroy();
            service = null;
        } else if (service != null) {
            updateServicePlaybackState();
        }
        call.resolve();
    }

    private void updateServicePositionState() {
        if (service != null) {
            service.setDuration(Math.round(duration * 1000));
            service.setPosition(Math.round(position * 1000));
            float playbackSpeed = playbackRate == 0.0 ? (float) 1.0 : (float) playbackRate;
            service.setPlaybackSpeed(playbackSpeed);
            service.update();
        }
    }

    @PluginMethod
    public void setPositionState(PluginCall call) {
        duration = call.getDouble("duration", 0.0);
        position = call.getDouble("position", 0.0);
        playbackRate = call.getFloat("playbackRate", 1.0F);

        updateServicePositionState();
        call.resolve();
    }

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void setActionHandler(PluginCall call) {
        call.setKeepAlive(true);
        actionHandlers.put(call.getString("action"), call);

        if (service != null) {
            service.updatePossibleActions();
        }
    }

    public boolean hasActionHandler(String action) {
        return actionHandlers.containsKey(action) && !actionHandlers.get(action).getCallbackId().equals(PluginCall.CALLBACK_ID_DANGLING);
    }

    public void actionCallback(String action) {
        actionCallback(action, new JSObject());
    }

    public void actionCallback(String action, JSObject data) {
        PluginCall call = actionHandlers.get(action);
        if (call != null && !call.getCallbackId().equals(PluginCall.CALLBACK_ID_DANGLING)) {
            data.put("action", action);
            call.resolve(data);
        } else {
            Log.d(TAG, "No handler for action " + action);
        }
    }
}
