# PodWaffle — Mobile App (Capacitor)

Native Android/iOS wrapper for PodWaffle, built with Capacitor.

## Architecture

The mobile app packages the complete PodWaffle client inside the APK/IPA. It no longer loads its user interface from a remote `server.url`.

- The application shell, JavaScript, icons, app CSS, and Bulma CSS are local.
- Subscriptions, podcast metadata, episode metadata, progress, queue state, and episode downloads are available locally after they have been synced.
- `backendUrl` points to the Home Assistant add-on. Feed refresh and authoritative sync run on that backend.
- Episodes played locally are downloaded in the background. Explicit and playback-triggered downloads are pinned until the user removes them.

This means the app can launch and display previously synced content while the device is in airplane mode.

## Prerequisites

| Tool | Install |
|---|---|
| Node.js compatible with Capacitor 8 | https://nodejs.org |
| Android Studio | https://developer.android.com/studio |
| Java 17 | Bundled with Android Studio |
| Xcode 15+ | Required for iOS builds |

## Configure the add-on and profile

The local mobile origin has its own durable cache. You can package the add-on URL and configured profile ID, or enter both from the app on first launch. The access key is deliberately not bundled and is entered in the app.

```bash
cd mobile
node scripts/set-server.js https://podcasts.example.com sam
```

You can also edit `server.config.json` directly:

```json
{
  "backendUrl": "http://192.168.1.50:3000",
  "profileId": "sam",
  "appId": "com.podwaffle.app",
  "appName": "PodWaffle"
}
```

Use HTTPS when the server is behind a TLS reverse proxy. Plain HTTP is supported for trusted local-network deployments.

If `profileId` is omitted, the app asks the user to choose one of the profiles configured in the add-on. Clients never create server profiles.

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
4. Generates `mobile-config.js` with the add-on URL and optional profile ID.
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
4. Play an episode locally (or use its explicit download control) and allow its download to finish.
5. Fully close the app.
6. Enable airplane mode and reopen it.

Expected results:

- The full interface and styling load.
- Subscription titles and artwork remain visible.
- Previously opened podcast episode lists remain visible.
- Downloaded episodes play.
- Local progress and subscription changes remain in the durable outbox and synchronise when connectivity returns.

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
