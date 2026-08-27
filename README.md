# Podwaffle

Podwaffle is a self-hosted podcast system for the Web and Android clients, hostable in Home Assistant (and elsewhere).

## Requirements

- Node.js 24 or newer
- pnpm 10.15
- Docker Buildx for container builds

Install and verify:

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Local development

`pnpm dev` uses the committed development defaults in
`apps/server/config/development.json`:

```json
{
  "profiles": "Developer,Guest",
  "join_code": "podwaffle-dev",
  "port": 3000
}
```

Development data is isolated under `apps/server/.data` (and ignored by Git).
Override either location with `PODWAFFLE_OPTIONS_PATH` or
`PODWAFFLE_DATA_DIR`. Build contracts once, then run the server and Vite client:

```sh
pnpm --filter @podwaffle/contracts build
pnpm dev
```

Vite proxies `/api`, `/health`, `/version.json` and `/ws` to the server. The
production server serves the built Vite output itself using same-origin relative
URLs.

## Android release APK

When native Android code or Expo config plugins have changed, regenerate the
Android project before building the APK:

```sh
pnpm --filter @podwaffle/android prebuild
```

On Windows, build the release APK with:

```powershell
cd apps/android/android
.\gradlew.bat assembleRelease
```

On macOS or Linux:

```sh
cd apps/android/android
./gradlew assembleRelease
```

The APK is written under:

```text
apps/android/android/app/build/outputs/apk/release/
```

For a development build installed directly to a connected Android device, run:

```sh
pnpm --filter @podwaffle/android android
```

## Configuration and persistence

The Home Assistant runtime reads `/data/options.json` at startup. `profiles` is a
comma-separated list; whitespace is trimmed and blank or duplicate names are
rejected. Removing a profile name disables it without deleting data. Re-adding the
same name restores it with the same UUID and state.

Persistent paths are:

```text
/data/podwaffle.sqlite
/data/backups/
/data/artwork/
/data/logs/
```

SQLite runs with foreign keys, WAL and a five-second busy timeout. Forward-only SQL
migrations are recorded in `schema_migrations`.

## Home Assistant and reverse proxy

For a local container build from the monorepo root:

```sh
docker build -f podwaffle/Dockerfile -t podwaffle:local .
```

The service listens on plain HTTP at `0.0.0.0:3000`. TLS belongs at Home Assistant
ingress or nginx. The proxy must preserve `X-Forwarded-Proto`,
`X-Forwarded-Host`, `X-Forwarded-For` and WebSocket upgrades for `/ws`.
Podwaffle trusts exactly one proxy hop. Browser cookies become `Secure` when the
forwarded public scheme is HTTPS.

`GET /health` reports readiness and the schema version. `GET /version.json` is
never cached. Fingerprinted `/assets/*` responses are immutable; the application
shell is not cached.

## Home Assistant integration

The repository includes a HACS-compatible custom integration under
`custom_components/podwaffle`. It creates one Home Assistant device per selected
Podwaffle profile, containing a `media_player`, queue-duration/count sensors and
listening-statistic sensors.

The media player controls the Android, web or Cast client currently owning that
profile's playback. Home Assistant does not render the audio itself. Play, pause,
seek, next and previous are delivered through Podwaffle's existing live playback
command channel.

Install through HACS as a custom integration repository, or copy
`custom_components/podwaffle` to `/config/custom_components/podwaffle`, restart
Home Assistant and add **Podwaffle** from **Settings → Devices & services**. The
config flow uses the direct Podwaffle URL on port `3000`, not its ingress panel
URL. See [`docs/home-assistant-integration.md`](docs/home-assistant-integration.md)
for setup, entities and security details.

## Windows tray controller

The repository also includes a small Windows-native Go tray controller under
[`apps/windows-tray`](apps/windows-tray). It uses the same restricted
Home Assistant controller API to show a compact player window and relay play,
pause, skip-forward and skip-backward commands to the active Podwaffle player.
Build it from Windows with `go build -trimpath -ldflags="-H=windowsgui -s -w" -o PodwaffleTray.exe .` in that
directory. The setup screen accepts either the server join code or an existing
profile-scoped bearer token; joined tokens are protected with Windows DPAPI.

## Authentication

Clients list enabled profiles and join with the configured code. Comparison is
timing-safe. Web credentials use a year-long HttpOnly, SameSite=Lax cookie and are
never placed in local storage. Android joins use the same endpoint with
`platform: "android"` and receive a bearer token. Home Assistant uses
`platform: "home_assistant"` and receives one restricted controller token for each
selected profile. Only a SHA-256 hash of each 256-bit random device token is stored.

Home Assistant controller credentials may read snapshots, live sync and statistics
and relay playback commands. They cannot become playback targets, acquire the
playback lease, mutate the library, report telemetry or revoke devices. Existing
web and Android credentials retain full profile access.

Join attempts are rate-limited by proxy-aware source IP. Active devices are listed
at `/api/v1/devices`; revocation immediately invalidates REST and WebSocket access.
Logs are structured JSON and recursively redact join codes, tokens, cookies and
authorization headers.

## Durable synchronisation

Every profile-visible mutation increments the profile revision and stores a
`sync_events` row in the same SQLite transaction. A successful event is broadcast
only after commit. Mutations with a `commandId` store their response in
`processed_commands`, so a retry returns the original result without applying the
operation twice.

Clients recover via:

```text
GET /api/v1/snapshot
GET /api/v1/sync?afterRevision=N
WS  /ws?afterRevision=N
```

The web client applies revisions in order. A gap, expired event range or server
notice triggers REST catch-up or a full snapshot. WebSockets reconnect with
exponential backoff and jitter. The database—not the socket—is authoritative, so
catch-up works after backend restarts.

The current REST description is served from `/api/v1/openapi.json`. Shared Zod
schemas in `packages/contracts` define join and WebSocket payloads.

## Google Cast

Chrome loads the Google Cast Application Framework lazily when the player starts.
Podwaffle uses Google's Default Media Receiver by default. To use a registered
custom receiver, set `VITE_GOOGLE_CAST_APP_ID` when building the web app.

The browser that starts Cast remains the Cast owner. Other browsers joined to the
same profile relay transport commands through the backend; shared state changes
only after the owner returns receiver-confirmed state. A nonplaying Cast session
returns to paused local mode after 30 minutes. HTTPS (or localhost), receiver
network access to the original episode enclosure URL, and a Cast-capable Chrome
environment are required.

Automated tests use a mock Web Sender adapter. Complete
[`docs/google-cast-acceptance.md`](docs/google-cast-acceptance.md) with two real
receivers and two browsers for hardware acceptance.

## Backup and restore

After building, run:

```sh
pnpm --filter @podwaffle/server backup
```

The command checkpoints WAL, uses SQLite's online backup API, writes a timestamped
database under `/data/backups` and applies `backup_retention_count`.

To restore:

1. Stop Podwaffle.
2. Preserve the current database separately.
3. Copy the selected managed backup to `/data/podwaffle.sqlite`.
4. Start Podwaffle; newer forward migrations run automatically.
5. Verify `/health`, profiles and devices. Existing device tokens remain valid.

Never make a blind filesystem copy of the live WAL database.
  information.
- Milestone 10: deduplicated listening telemetry, confirmed typed movements,
  profile-local daily roll-ups, period-filtered statistics and profile cards.
