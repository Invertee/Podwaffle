# Podwaffle Home Assistant add-on

Podwaffle 4 is a server-hosted podcast application. The add-on serves the web client, refreshes every configured profile's podcast feeds, owns Google Cast sessions, and stores the authoritative sync state. Web and Android clients keep durable local caches for fast startup and offline use.

## Add-on configuration

```yaml
profiles: Sam, Alex
access_key: replace-with-a-long-random-value
firebase_project_id: ""
firebase_client_email: ""
firebase_private_key: ""
firebase_api_key: ""
firebase_app_id: ""
firebase_sender_id: ""
```

- `profiles` is a comma-delimited list. Display names are converted to stable lowercase IDs, for example `Sam Smith` becomes `sam-smith`.
- `access_key` protects all profile, podcast, Cast, and Home Assistant API routes. Set it whenever the add-on is reachable outside Home Assistant ingress.
- Firebase values are optional. When configured, Android devices receive data-only sync notifications. WebSocket remains the live transport and Android fallback.

Restart the add-on after changing profiles or the access key. Removing a profile from the list makes its API inaccessible but does not delete its stored data.

## Storage

Persistent data is stored below the add-on's `/config/data` directory. The packaged application is deployed to `/config/app` at startup, while user data remains outside that deployment directory.

## Access

- Home Assistant ingress: open the add-on from the Home Assistant sidebar.
- Reverse proxy: proxy HTTP and WebSocket upgrades to port `3000`, use HTTPS, and configure `access_key`.
- Android: enter the reverse-proxy URL and access key in the app's Admin page, or package only the server URL with `mobile/scripts/set-server.js`.

The server exposes a public `GET /api/status` endpoint containing no profile data. All other `/api` endpoints require `X-Podwaffle-Key: <access_key>` (or a bearer token) when an access key is configured. Browser WebSockets authenticate in their first `sync:hello` message.

## Synchronisation model

- The backend refresh scheduler fetches subscribed podcast feeds for every configured profile.
- Each state mutation advances a durable per-profile revision and `lastChangedAt` timestamp.
- Authenticated WebSocket clients receive mutations immediately and request a full snapshot if they miss a revision.
- Firebase sends coalesced `sync_changed` data messages to registered Android clients.
- Offline client writes are held in one durable outbox and replayed after reconnection.
- Starting local playback also starts a durable on-device episode download for later offline use.
- A server-side playback lease identifies the one local client or Cast device that owns playback. A takeover revokes and pauses the previous online owner.

## Admin diagnostics

The client Admin page displays WebSocket/Firebase status, registered push devices, pending offline writes, sync revision/timestamp, playback owner, and recent session events. The underlying authenticated endpoint is `GET /api/admin/status`.

## Home Assistant media-player bridge

- `GET /api/ha/users`
- `GET /api/ha/media-player/:profileId/state`
- `POST /api/ha/media-player/:profileId/command`

Commands supported are `play`, `pause`, `play_pause`, `stop`, `seek`, `set_volume`, `next`, and `previous`. Cast commands execute on the server; local playback commands are routed to the client holding the playback lease and are also sent through Firebase when configured.
