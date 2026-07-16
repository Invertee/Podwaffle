package com.podwaffle.app;

import android.os.Bundle;
import android.view.KeyEvent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Register custom Capacitor plugins before the bridge initialises the WebView
        registerPlugin(MediaSessionPlugin.class);
        registerPlugin(FirebaseSyncPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (MediaSessionPlugin.isCastActive) {
            if (keyCode == KeyEvent.KEYCODE_VOLUME_UP || keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    double delta = (keyCode == KeyEvent.KEYCODE_VOLUME_UP) ? 0.05 : -0.05;
                    getBridge().getWebView().evaluateJavascript(
                        "if (typeof window.__adjustCastVolume === 'function') { window.__adjustCastVolume(" + delta + "); }",
                        null
                    );
                    return true; // Consume the event so native volume panel does not show
                }
            }
        }
        return super.onKeyDown(keyCode, event);
    }
}
