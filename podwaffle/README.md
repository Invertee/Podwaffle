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
firebase_service_account_file: ""
firebase_google_services_file: ""
firebase_service_account_json: ""
firebase_google_services_json: ""
```

- `profiles` is a comma-delimited list. Display names are converted to stable lowercase IDs, for example `Sam Smith` becomes `sam-smith`.
- `access_key` protects all profile, podcast, Cast, and Home Assistant API routes. Set it whenever the add-on is reachable outside Home Assistant ingress.
- Firebase values are optional. When configured, Android devices receive data-only sync notifications. WebSocket remains the live transport and Android fallback.
- `firebase_project_id` must be the Firebase/Google Cloud **Project ID** (for example `my-podwaffle-123`), not the numeric project number, app ID, private-key ID, or a service-account key fingerprint. Enable the Firebase Cloud Messaging API for that same project, and use a service-account email/private key issued by it. The API key, app ID, and sender ID come from the Android app configuration for the same Firebase project.

### Firebase JSON files

As an alternative to entering the six Firebase values separately, copy these files into the root of the add-on's data/config folder (the directory mounted as `/config` inside the add-on):

- `google-services.json`, downloaded for the `com.podwaffle.app` Android app.
- A service-account key JSON. Its generated filename can be left unchanged; Podwaffle identifies it by its `service_account` content and prefers a file whose project matches `google-services.json`.

Restart the add-on after copying the files. Podwaffle reads the credentials at startup, verifies that both files use the same project, and sends only the public Android identifiers to the mobile client. The private key remains on the server. The Admin diagnostics response reports the selected filenames and any configuration error, but never returns secret values.

If the files have different names or are stored in a subfolder, set paths relative to the add-on config root:

```yaml
firebase_service_account_file: firebase/podwaffle-service-account.json
firebase_google_services_file: firebase/google-services.json
```

Individually configured Firebase fields take precedence over values loaded from the files.

You can instead paste the complete contents of both files directly into the add-on YAML using block strings:

```yaml
firebase_service_account_json: |-
  { "type": "service_account", "project_id": "...", ... }
firebase_google_services_json: |-
  { "project_info": { ... }, "client": [ ... ] }
```

The pasted JSON options take precedence over discovered or explicitly named files. The original six individual fields take precedence over both JSON-loading methods, so clear any old or incorrect individual Firebase values when switching to file/JSON configuration.

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
