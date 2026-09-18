# Google Cast manual acceptance

## Progress recovery

Android reports receiver progress from the native media service every ten seconds,
including while React Native is suspended. Reports cannot change the active Cast
session or take ownership from another device.

The optional server setting `cast_progress_watchdog` defaults to `false`. Enable
it in the Home Assistant add-on configuration (or server options JSON) and restart
the server. Every thirty seconds it checks for playing Cast sessions without a
report for forty-five seconds, then requests a fresh status at most once a minute.
It uses live sync and the existing Firebase wake-up path. The owning phone/browser
must still be reachable and connected to the receiver; the server does not poll
speakers directly or guess progress when all senders are offline. Disable the
setting and restart to stop watchdog requests.

- [ ] Play an episode for a few seconds, switch episodes, then return. Check both local and Cast resume.
- [ ] Background the phone for several minutes while casting; confirm server progress continues advancing.
- [ ] Interrupt server access, keep playing, then reconnect. Saved history must not switch playback to an older episode.
- [ ] Enable the watchdog, stop normal sender reports, and confirm a status request persists the receiver observation.
- [ ] Switch Cast sessions while a watchdog request is pending. Its delayed reply must not change the replacement session.
- [ ] With weak mobile data and a long queue, play a downloaded episode. Automatic caching should wait on metered connections; manual downloads remain available.

## Browser checks

Run this checklist in Chrome over HTTPS (or localhost) with two browsers joined
to the same Podwaffle profile and two real Cast-capable speakers/displays.

- [ ] The Cast control appears when a receiver is available.
- [ ] Starting Cast pauses local audio and loads the original enclosure URL at
      the confirmed local position.
- [ ] The receiver shows the episode title, podcast title and artwork.
- [ ] Play, pause, seek, skip back 15 seconds and skip forward 30 seconds are
      receiver-confirmed and reflected in both browsers.
- [ ] The Cast volume and mute controls follow changes made from another sender.
- [ ] The second browser can play, pause, seek and skip while the first browser
      remains the Cast owner.
- [ ] Choosing **Speakers** can transfer/reselect the second receiver without
      duplicate playback.
- [ ] **Stop Cast** resumes local playback at the last receiver-confirmed
      position and preserves whether playback was active.
- [ ] Ending the session from Google's Cast dialog returns the UI to local mode.
- [ ] A paused/stopped Cast session left idle for 30 minutes returns the shared
      profile to paused local mode at the last confirmed position.
- [ ] Receiver/network failure leaves local playback available and shows a
      useful error instead of publishing Cast mode.

Record the browser version, receiver models/firmware, custom receiver ID (if
used), and any failed item with server/browser logs.

## Android cancellation and expiry regression checks

- [ ] With local playback running, open Cast and tap outside the chooser. The spinner clears immediately, local playback resumes at the same position, and the chooser can be reopened. Repeat using Android Back.
- [ ] Repeat with paused playback and with no episode loaded. Cancellation must not start playback or reset the position.
- [ ] Select a receiver normally; chooser dismissal after selection must not cancel the connection. Test a failed connection and retry.
- [ ] Pause Cast for 30 minutes, including with the app backgrounded/offline. On return, playback is local and paused; pressing Play must not show a reconnecting error.
- [ ] Restart the process with an overnight saved Cast session. There must be no SDK resume attempt, spinner, or stale Cast ownership.
- [ ] Interrupt a playing Cast connection briefly: it may recover within 30 seconds. After that deadline, it returns to paused local playback and late SDK callbacks cannot restore it. Restarting the process must not reset that deadline.
- [ ] End the receiver session externally; the app clears Cast immediately instead of beginning recovery.
- [ ] Check the launcher, splash, web/PWA icon and Home Assistant add-on/integration icon use the radio artwork.
