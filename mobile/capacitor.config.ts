import type { CapacitorConfig } from '@capacitor/cli';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Load server.config.json — edit this file to point at your PodWaffle server.
// ---------------------------------------------------------------------------
const serverConfigPath = resolve(__dirname, 'server.config.json');
const serverConfig: Record<string, string> = existsSync(serverConfigPath)
  ? JSON.parse(readFileSync(serverConfigPath, 'utf-8'))
  : {};

const defaultLiveUrl = 'https://invertee.github.io/PodWaffle';
const serverUrl: string = serverConfig.serverUrl || defaultLiveUrl;
const isHttp = serverUrl.startsWith('http://') && !serverUrl.startsWith('https://');

let allowNavigation: string[] = [];
if (serverUrl) {
  try {
    const u = new URL(serverUrl);
    const hostWithPort = `${u.hostname}:${u.port || (isHttp ? '80' : '443')}`;
    allowNavigation = u.port ? [u.hostname, hostWithPort] : [u.hostname];
  } catch (_) { /* invalid URL — leave empty */ }
}

// ---------------------------------------------------------------------------
// Capacitor configuration
// ---------------------------------------------------------------------------
const config: CapacitorConfig = {
  appId: serverConfig.appId || 'com.podwaffle.app',
  appName: serverConfig.appName || 'PodWaffle',

  // Capacitor looks here for the compiled web assets.
  // When server.url is set the WebView loads from there instead; www/ is the
  // offline-only fallback page shown when the server is unreachable.
  webDir: 'www',

  // Remote server URL — this is what gives us "live update" for free.
  // Any changes deployed to the server are picked up immediately on next
  // app launch without needing a Play Store / App Store release.
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,

          // cleartext must be true for plain http:// server URLs.
          // Capacitor injects the required network_security_config automatically.
          cleartext: isHttp,

          allowNavigation,
        },
      }
    : {}),

  plugins: {
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
