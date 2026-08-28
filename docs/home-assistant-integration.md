# Home Assistant integration

Podwaffle includes a custom Home Assistant integration that creates one profile
device for each selected Podwaffle user. Each device contains a `media_player`,
notification title/message fields, a send button and listening/queue sensors.

## Requirements

- Podwaffle add-on `5.0.30` or newer for encrypted profile notifications and
  FCM playback-command fallback.
- Home Assistant `2025.1.0` or newer.
- A direct URL from Home Assistant to Podwaffle, normally the Home Assistant host
  address on port `3000`. Do not use the ingress panel URL.
- The current Podwaffle join code.

## Install with HACS

1. Open HACS.
2. Add this repository as a custom repository with category **Integration**.
3. Install **Podwaffle**.
4. Restart Home Assistant.
5. Open **Settings → Devices & services → Add integration**.
6. Search for **Podwaffle**.

## Manual installation

Copy the repository directory:

```text
custom_components/podwaffle
```

into the Home Assistant configuration directory as:

```text
/config/custom_components/podwaffle
```

Restart Home Assistant, then add Podwaffle from **Settings → Devices & services**.

## Configure

The config flow asks for:

- **Server URL** — for example `http://192.168.1.20:3000`.
- **Join code** — the code configured in the Podwaffle add-on.
- **Verify SSL certificate** — keep enabled unless a trusted local deployment uses
  a self-signed certificate.
- **Profiles** — one or more enabled Podwaffle profiles to expose.

Home Assistant uses the join code only while pairing and stores a separate random
controller token for each selected profile. The Podwaffle server also uses its
configured join code to encrypt notification bodies before they enter FCM. The
controller tokens are restricted to snapshot, sync, statistics, playback-command
and profile-notification access. They cannot become the playback owner, report
listening telemetry, edit the podcast library or revoke other devices.

The Home Assistant controller appears under the profile's connected devices and
can be revoked from Podwaffle. A revoked token starts Home Assistant's
reauthentication flow, which asks for the current join code and replaces all
profile tokens in the config entry.

## Entities

Each selected profile creates:

- `media_player` — current episode, podcast, artwork, progress, active playback
  device, play, pause, seek, next, previous, and `play_media` for a known
  Podwaffle episode ID.
- Notification title — editable title for the next ad-hoc message.
- Notification message — editable body for the next ad-hoc message.
- Send notification — encrypts and sends the two fields to every push-registered
  Android device enrolled in that profile.
- Queue remaining duration.
- Queue episode count.
- Listening time today.
- Listening time over 30 days.
- Listening time all time.
- Content consumed over 30 days and all time, disabled by default.
- Skipped-forward time over 30 days and all time, disabled by default.
- Rewound time over 30 days and all time, disabled by default.
- Episodes completed over 30 days and all time, disabled by default.
- Active listening days over 30 days and all time, disabled by default.
- Current listening streak, disabled by default.
- Longest listening streak, disabled by default.
- Subscription count, disabled by default.
- History entry count, disabled by default.

Current streak, longest streak, subscription count and history entry count are
profile-wide values rather than period-specific totals, so they appear once rather
than being duplicated for 30-day and all-time periods.

Queue remaining duration subtracts the current episode position and includes full
durations for following episodes. The sensor includes an
`unknown_duration_episodes` attribute when feed metadata is incomplete.

## Send a notification

Set the title and message fields belonging to the intended profile, then press its
send button. For example:

```yaml
sequence:
  - action: text.set_value
    target:
      entity_id: text.podwaffle_sam_notification_title
    data:
      value: "Front door"
  - action: text.set_value
    target:
      entity_id: text.podwaffle_sam_notification_message
    data:
      value: "Someone is at the door"
  - action: button.press
    target:
      entity_id: button.podwaffle_sam_send_notification
```

The send button refuses an empty message. Leaving the title empty uses
**Podwaffle** as the default title.

The server sends a data-only, high-priority FCM message to every registered
Android device in that profile. FCM receives only the protocol version, a random
salt and IV, and AES-256-GCM ciphertext. The key is derived from the join code
with PBKDF2-HMAC-SHA256; the Android app decrypts the title and message locally
and then creates the visible notification. A modified payload or a payload
encrypted with another join code is discarded.

Android installations that were already enrolled before this feature was added
must sign out and join once more so the app can retain the join code in Android
secure storage. After that one-time enrolment, no join code is placed in FCM or
returned to Home Assistant. If the server join code is later changed, rejoin each
Android device so it can decrypt notifications encrypted with the new code.

The action fails clearly when Firebase is disabled, the profile has no
push-registered Android device, or FCM rejects every target. Notification delivery
is still subject to Android notification permission and device-level channel
settings for **Podwaffle messages**.

## Play a specific episode

`media_player.play_media` can start a known Podwaffle episode on whichever web,
Android, or Cast client currently owns playback for the profile. Use the Podwaffle
episode UUID as `media_content_id`:

```yaml
action: media_player.play_media
target:
  entity_id: media_player.podwaffle_sam
data:
  media_content_type: episode
  media_content_id: "00000000-0000-0000-0000-000000000000"
```

The command uses the same restricted controller credential as the normal
transport controls. Home Assistant still cannot acquire playback ownership or
become an audio target. The profile must have an active connected playback owner
for the command to succeed.

Podcast/episode browsing is not exposed through Home Assistant yet. That feature
needs a separate read-only catalog permission so browsing can be added without
granting the controller library mutation rights.

## Runtime behaviour

The integration loads an initial profile snapshot through REST, then listens to the
profile-scoped Podwaffle WebSocket. Relevant sync events trigger a debounced
snapshot refresh. A 60-second poll remains as a fallback, while listening
statistics are refreshed at most every five minutes.

Playback commands are durable and idempotent. The server sends each command over
the live WebSocket and also sends a high-priority FCM wake-up to Android. The two
paths race: WebSocket is normally fastest while the app is active, and FCM wakes
the app so it can fetch pending commands when Android has suspended its socket.
Firebase acceptance is treated as a valid dispatch when no live socket is
available; the Android client still fetches the full command from Podwaffle rather
than trusting notification contents. These playback and sync wake messages are
unencrypted data-only messages and are never shown as user notifications.

Home Assistant returns as soon as the server accepts the dispatch and reflects
play, pause, seek and skip actions optimistically. The Android acknowledgement and
subsequent live-sync event reconcile the authoritative state. This avoids holding
a dashboard action open while waiting for a remote device round trip.

The media player is a controller for the active Podwaffle Android, web or Cast
client. It is not an audio renderer. A command will fail when the profile has no
active connected playback owner.

The standard media-control card is appropriate after these latency changes. If a
dashboard should remain completely stateless, regular Home Assistant button cards
can call `media_player.media_play`, `media_player.media_pause`,
`media_player.media_next_track`, and `media_player.media_previous_track` on the
same entity. Those buttons use the identical command transport; they change the
presentation, not delivery speed.

## Development checks

From the repository root:

```sh
pnpm --filter @podwaffle/contracts build
pnpm --filter @podwaffle/server typecheck
pnpm --filter @podwaffle/server test:integration
pnpm --filter @podwaffle/web typecheck
pnpm --filter @podwaffle/android typecheck
python -m compileall custom_components/podwaffle
```
