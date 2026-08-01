# Android Milestones 23–26 completion pass

The implementation-plan source file is intentionally not committed to the
repository. This completion pass therefore maps Milestones 23–26 to the current
Android architecture and the requested release scope rather than reproducing
unavailable plan text.

## Milestone 23 — Google Cast completion

- Keeps the build-compatible Google Cast sender stack used by the existing
  Android client: Media3 1.5.0, Cast Framework 21.5.0, MediaRouter 1.7.0 and
  AppCompat 1.7.0.
- Exposes Cast from both the persistent mini-player and Now Playing.
- Transfers the active episode, queue, position and playing state to the receiver.
- Returns to local playback at the receiver-confirmed position.
- Continues reporting Cast state to the Podwaffle backend for shared playback.

## Milestone 24 — Background and system media controls

- Provides an explicit Media3 notification provider using Podwaffle's playback
  notification channel and small icon.
- Publishes episode title, podcast title and artwork through MediaMetadata.
- Adds lock-screen and notification controls for skip back, play/pause and skip
  forward.
- Keeps the MediaSessionService authoritative across screen changes and while the
  application is backgrounded.
- Opens Podwaffle when the system media notification is tapped.

## Milestone 25 — Persistent shell and visual parity

- Adds a persistent mini-player and bottom navigation shell to every authenticated
  route, including podcast detail, queue and Now Playing.
- Applies safe-area padding above the application content so text no longer crowds
  the system status bar.
- Removes route animations between the library and podcast detail.
- Uses React Native SVG versions of the web client's line-icon language.
- Removes podcast titles beneath artwork in tile view.
- Uses compact, artwork-free episode rows throughout podcast and queue lists.
- Suppresses background refresh animations while preserving manual pull-to-refresh.

## Milestone 26 — release hardening

- Removes the Android sleep timer and playback-speed controls from the interface.
- Keeps generated Android and Gradle build output outside the merge package.
- Updates the Android application to version 0.4.0, versionCode 4 and runtime
  version 0.4-native-4.
- Includes a merge script, checksum manifest and Android Studio verification
  checklist.

## Deliberately retained

- Configurable skip-forward and skip-back intervals remain in Profile because they
  are used by in-app playback controls.
- Podcast artwork remains in the podcast header, mini-player, Now Playing and
  system media notification. It is removed only from dense episode/queue rows and
  titles are removed beneath library tiles.
