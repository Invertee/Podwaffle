# PodWaffle — Mobile App (Capacitor)

Native Android/iOS wrapper for PodWaffle, built with Capacitor.

## Architecture

The mobile app packages the complete PodWaffle client inside the APK/IPA. It no longer loads its user interface from a remote `server.url`.

- The application shell, JavaScript, icons, app CSS, and Bulma CSS are local.
- Subscriptions, podcast metadata, episode metadata, progress, queue state, and explicit downloads are available locally after they have been synced.
- `backendUrl` is used only to refresh feeds and synchronise state between clients.
- Explicitly downloaded episodes are pinned and are not removed by transient-cache expiry.

This means the app can launch and display previously synced content while the device is in airplane mode.

## Prerequisites

| Tool | Install |
|---|---|
| Node.js compatible with Capacitor 8 | https://nodejs.org |
| Android Studio | https://developer.android.com/studio |
| Java 17 | Bundled with Android Studio |
| Xcode 15+ | Required for iOS builds |

## Configure the backend and existing profile

The local mobile origin has separate browser storage from the older remote-wrapper build. To reconnect to the same server-side profile, configure both the backend URL and your existing PodWaffle profile GUID before the first build.

```bash
cd mobile
node scripts/set-server.js http://192.168.1.50:3000 YOUR-EXISTING-PROFILE-GUID
```

You can also edit `server.config.json` directly:

```json
{
  "backendUrl": "http://192.168.1.50:3000",
  "profileGuid": "01234567-89ab-4cde-8f01-23456789abcd",
  "appId": "com.podwaffle.app",
  "appName": "PodWaffle"
}
```

Use HTTPS when the server is behind a TLS reverse proxy. Plain HTTP is supported for trusted local-network deployments.

If `profileGuid` is omitted, the app creates a new local profile and registers it with the backend when connectivity is available.

## Build and run

```bash
cd mobile
npm install
npm run sync
npm run android:open
```

`npm run sync` performs these steps:

1. Copies `../client` into `mobile/www`.
2. Downloads and caches the pinned Bulma 1.0.2 stylesheet for local packaging.
3. Removes remote Google Font dependencies from the mobile copy.
4. Generates `mobile-config.js` with the backend URL and profile GUID.
5. Runs `npx cap sync` to copy the local web bundle into the native project.

After the first successful run, the Bulma asset is reused from `mobile/.cache`.

The convenience commands also prepare and sync the web bundle automatically:

```bash
npm run android
npm run android:open
npm run ios
npm run ios:open
```

## Offline test procedure

1. Install the rebuilt app and open it while online.
2. Confirm that the expected profile and subscriptions have synchronised.
3. Open the podcasts you want available offline so their episode metadata is stored.
4. Explicitly download at least one episode.
5. Fully close the app.
6. Enable airplane mode and reopen it.

Expected results:

- The full interface and styling load.
- Subscription titles and artwork remain visible.
- Previously opened podcast episode lists remain visible.
- Explicitly downloaded episodes play.
- Local progress and subscription changes remain on-device and synchronise when connectivity returns.

## Background audio — Android manifest

After running `npx cap add android`, ensure `android/app/src/main/AndroidManifest.xml` includes:

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
<uses-permission android:name="android.permission.INTERNET" />
```

The media-session foreground service remains active while paused so lock-screen controls can recover after the app has been backgrounded.

The relevant Capacitor configuration is:

```ts
MediaSession: {
  foregroundService: 'always',
}
```

## Native media controls

The app bridges playback to the native media-session integration:

- Episode title, podcast title, and artwork
- Play and pause
- Seek backward and forward
- Playback state and position

Run `npm run sync` and rebuild after changing client or native configuration.

## Debug mode

Before publishing, set the following in `capacitor.config.ts`:

```ts
android: {
  webContentsDebuggingEnabled: false,
}
```

Then run `npm run sync` and rebuild.

## Project layout

```text
mobile/
  capacitor.config.ts
  server.config.json
  package.json
  scripts/
    set-server.js
    sync-web-assets.js
  www/                    generated local client bundle
  .cache/                 downloaded pinned build assets; ignored by Git
  android/
  ios/
```

`mobile/www` is regenerated from `client/` every time `npm run sync` runs. Do not make source changes directly inside `mobile/www`.
