# Home Assistant integration

Podwaffle includes a custom Home Assistant integration that creates one profile
device for each selected Podwaffle user. Each device contains a `media_player`
entity and listening/queue sensors.

## Requirements

- Podwaffle add-on `5.0.21` or newer.
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

The join code is used only while pairing. Home Assistant stores a separate random
controller token for each selected profile. The controller tokens are restricted
to snapshot, sync, statistics and playback-command access. They cannot become the
playback owner, report listening telemetry, edit the podcast library or revoke
other devices.

The Home Assistant controller appears under the profile's connected devices and
can be revoked from Podwaffle. A revoked token starts Home Assistant's reauthentication
flow, which asks for the current join code and replaces all profile tokens in the
config entry.

## Entities

Each selected profile creates:

- `media_player` — current episode, podcast, artwork, progress, active playback
  device, play, pause, seek, next and previous.
- Queue remaining duration.
- Queue episode count.
- Listening time today.
- Listening time over 30 days.
- Episodes completed over 30 days, disabled by default.
- Current listening streak, disabled by default.
- Subscription count, disabled by default.

Queue remaining duration subtracts the current episode position and includes full
durations for following episodes. The sensor includes an
`unknown_duration_episodes` attribute when feed metadata is incomplete.

## Runtime behaviour

The integration loads an initial profile snapshot through REST, then listens to the
profile-scoped Podwaffle WebSocket. Relevant sync events trigger a debounced
snapshot refresh. A 60-second poll remains as a fallback, while listening statistics
are refreshed at most every five minutes.

The media player is a controller for the active Podwaffle Android, web or Cast
client. It is not an audio renderer. A command will fail when the profile has no
active connected playback owner.

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
