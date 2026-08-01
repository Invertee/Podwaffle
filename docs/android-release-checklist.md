# Android release verification checklist

## Source checks

```powershell
pnpm install
pnpm --filter "@podwaffle/contracts" build
pnpm --filter "@podwaffle/android" typecheck
pnpm --filter "@podwaffle/android" test
```

Because this pass changes Kotlin, Android resources, the manifest and a native
JavaScript dependency, regenerate the native project:

```powershell
Set-Location .\apps\android
npx expo prebuild --platform android --clean
```

Open `apps/android/android` in Android Studio and select JDK 17 for Gradle.
Do not run Clean Project unless a stale generated build requires it.

## Build

Run the application module task:

```text
app → Tasks → build → assembleDebug
```

Expected APK:

```text
apps/android/android/app/build/outputs/apk/debug/app-debug.apk
```

## Functional acceptance

1. The library starts below the system status bar.
2. Tile view shows artwork only; list view keeps title and author.
3. Opening a podcast has no route animation.
4. Podcast episode rows are compact and contain no artwork.
5. The mini-player and bottom navigation remain visible on podcast detail, queue
   and Now Playing.
6. Background sync does not repeatedly display a refresh spinner.
7. A playing episode creates a system media notification with episode title,
   podcast title and artwork.
8. Lock-screen/notification skip back, play/pause and skip forward controls change
   playback.
9. Tapping the media notification opens Podwaffle.
10. Cast opens a route picker, transfers playback and returns locally at the last
    confirmed receiver position.
11. Audio continues while navigating between all screens and while the application
    is backgrounded.
12. Downloads and offline playback continue to work after the native rebuild.

## Notes

Cast requires a physical Google Cast receiver on the same network and an enclosure
URL reachable by that receiver. Lock-screen presentation varies slightly by Android
version and device manufacturer, but the underlying MediaSession commands should
remain available.
