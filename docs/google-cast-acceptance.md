# Google Cast manual acceptance

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
