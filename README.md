# Podwaffle

Podwaffle is a self-hosted podcast system for Home Assistant. This repository
currently delivers Phase 1 through Milestone 11: Home Assistant packaging,
profile/device enrolment, durable synchronisation, podcast discovery and RSS
ingestion, episode state, a shared persistent queue, browser playback, and
listening statistics, and Google Cast Web Sender playback.

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

Build from the monorepo root:

```sh
docker build -f home-assistant/podwaffle/Dockerfile -t podwaffle:local .
```

The service listens on plain HTTP at `0.0.0.0:3000`. TLS belongs at Home Assistant
ingress or nginx. The proxy must preserve `X-Forwarded-Proto`,
`X-Forwarded-Host`, `X-Forwarded-For` and WebSocket upgrades for `/ws`.
Podwaffle trusts exactly one proxy hop. Browser cookies become `Secure` when the
forwarded public scheme is HTTPS.

`GET /health` reports readiness and the schema version. `GET /version.json` is
never cached. Fingerprinted `/assets/*` responses are immutable; the application
shell is not cached.

## Authentication

Clients list enabled profiles and join with the configured code. Comparison is
timing-safe. Web credentials use a year-long HttpOnly, SameSite=Lax cookie and are
never placed in local storage. Android joins use the same endpoint with
`platform: "android"` and receive a bearer token. Only a SHA-256 hash of the
256-bit random device token is stored.

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

## Delivered scope

- Milestone 1: multi-stage image, Home Assistant metadata, options, proxy-aware
  server, static Vite hosting, health and version endpoints.
- Milestone 2: complete reserved Phase 1 schema, migration runner, transaction
  helper, repository functions and managed online backups.
- Milestone 3: configured profiles, responsive join/device UI, web and Android
  credential contracts, logout, revocation, rate limiting and safe logs.
- Milestone 4: profile revisions, durable events, idempotent commands, snapshot and
  catch-up endpoints, authenticated origin-checked WebSockets and reconnect/gap
  recovery.
- Milestone 5: Apple podcast discovery, subscriptions, RSS normalisation,
  conditional scheduled refresh and a tile/list library.
- Milestone 6: transactional complete-order updates, drag reordering and
  profile-specific 24-hour new-episode indicators.
- Milestone 7: podcast/episode browsing, manual played overrides, progress,
  98%-completion, in-progress and history views.
- Milestone 8: durable add-next/add-bottom, removal, complete reorder, clear,
  completion advance behavior and a synchronised queue drawer.
- Milestone 9: long-lived local audio, persistent controls, playback leases,
  multi-tab ownership, keyboard shortcuts, Media Session integration and episode
  information.
- Milestone 10: deduplicated listening telemetry, confirmed typed movements,
  profile-local daily roll-ups, period-filtered statistics and profile cards.
