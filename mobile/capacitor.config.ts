import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Load server.config.json. The native app itself is bundled from mobile/www;
// backendUrl is used only for API/WebSocket sync and optional navigation.
// ---------------------------------------------------------------------------
const serverConfigPath = resolve(__dirname, 'server.config.json');
const serverConfig: Record<string, string> = existsSync(serverConfigPath)
  ? JSON.parse(readFileSync(serverConfigPath, 'utf-8'))
  : {};

const configuredEndpoint = serverConfig.backendUrl || serverConfig.serverUrl || '';
const isHttp = configuredEndpoint.startsWith('http://') && !configuredEndpoint.startsWith('https://');

let allowNavigation: string[] = [];
if (configuredEndpoint) {
  try {
    const u = new URL(configuredEndpoint);
    const hostWithPort = `${u.hostname}:${u.port || (isHttp ? '80' : '443')}`;
    allowNavigation = u.port ? [u.hostname, hostWithPort] : [u.hostname];
  } catch (_) { /* invalid URL - leave empty */ }
}

const config: CapacitorConfig = {
  appId: serverConfig.appId || 'com.podwaffle.app',
  appName: serverConfig.appName || 'PodWaffle',

  // npm run sync copies the complete client into this directory before
  // Capacitor updates the native project. The app therefore boots locally
  // even when the backend and internet are unavailable.
  webDir: 'www',

  server: {
    // Required when backendUrl uses plain HTTP on a trusted local network.
    cleartext: isHttp,
    ...(allowNavigation.length ? { allowNavigation } : {}),
  },

  plugins: {
    // Keep the native media-session service alive even while paused so lockscreen
    // controls stay responsive after the app has been backgrounded for a while.
    MediaSession: {
      foregroundService: 'always',
    },
    Cast: {
      uiMode: 'picker',
      autoJoinPolicy: 'origin_scoped',
    },
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#0f0f0f',
      showSpinner: false,
      androidSplashResourceName: 'splash',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a1a2e',
      overlaysWebView: false,
    },
    SystemBars: {
      insetsHandling: 'css',
      style: 'DARK',
    }
  },

  android: {
    // Allow Chrome DevTools remote debugging of the WebView during development.
    // Set to false before publishing to the Play Store.
    webContentsDebuggingEnabled: true
  },
};

export default config;
