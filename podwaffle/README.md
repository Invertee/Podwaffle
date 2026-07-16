# Podwaffle Home Assistant Add-on

This folder contains a Home Assistant add-on package for Podwaffle.

## Files

- `config.json` — Add-on metadata/manifest
- `Dockerfile` — Container build
- `run.sh` — Add-on startup script

## Publish in your GitHub repo

1. Push this repository to GitHub.
2. In Home Assistant, add your repo URL under **Settings → Add-ons → Add-on Store → Repositories**.
3. Install the **Podwaffle** add-on.
4. Start the add-on and open via Ingress or exposed port.

## Notes

- The add-on uses `ingress: true` and defaults to internal port `3000`.
- Persistent app data is stored via the Home Assistant add-on `/data` volume and mounted into Podwaffle's expected data directory at runtime.
- On every add-on start, the full app tree (client + server) is redeployed from the image source into `/config/app` before launch.
- Docker build source fetch is tied to `BUILD_VERSION` so new add-on versions refresh source layers instead of reusing stale clone cache.
- Startup logs include deployed source commit and file fingerprints (`client/js/app.js`, `client/css/app.css`, `server/server.js`) to confirm updated assets are active.
- If you publish under a different GitHub URL, update `url` in `config.json` and `repository.yaml`.

## Add-on option: disable new user sessions

Use the add-on setting `disable_new_user_sessions` to prevent creation of new user profiles after you have set up your initial profiles.

- `false` (default): New profiles can be created automatically when a client has no saved GUID.
- `true`: `POST /api/users` returns HTTP `403` and the client shows an error instead of creating a new profile.

## Home Assistant media player bridge (per user GUID)

Podwaffle now exposes Home Assistant-friendly endpoints so a custom HA integration can create one `media_player` entity per Podwaffle user profile.

### Discover users

- `GET /api/ha/users`
- Response: `{ "users": [{ "guid": "..." }] }`

### Read media player state for a user

- `GET /api/ha/media-player/:guid/state`
- Response includes:
	- `entity_id` (normalized as `media_player.podwaffle_<guid>`)
	- `state` (`playing` | `paused` | `idle`)
	- `media_title`, `media_series_title`, `media_position`, `media_duration`, `media_image_url`
	- `mode` (`local` | `cast` | `idle`)
	- `supported_commands`

### Send media commands for a user

- `POST /api/ha/media-player/:guid/command`
- JSON body:
	- `command`: `play`, `pause`, `play_pause`, `stop`, `seek`, `set_volume`, `next`, `previous`
	- Optional payload keys:
		- `position` or `value` for `seek`
		- `volume` or `value` for `set_volume`

If the user session is currently casting, commands execute against Google Cast directly.
If the user session is local playback, commands are delivered via Podwaffle WebSocket and applied by the active SPA session for that same GUID.

## Deployment Methods

### Via Home Assistant Ingress (Reverse Proxy)
When installed as an HA add-on using **Ingress**, the app runs behind HA's reverse proxy at a base path like `/api/hassio/...`. The app automatically detects this base path and routes all API calls, WebSocket connections, and asset requests correctly.

## Android background sync (Firebase)

The sideloaded Android app can receive high-priority Firebase data messages for media controls and optional `cache_episode` / `cache_podcast` commands while it is backgrounded. Configure these add-on options from one Firebase Android app whose package name is `com.podwaffle.app`:

- `firebase_project_id`, `firebase_api_key`, `firebase_app_id`, and `firebase_sender_id` from the Android app configuration.
- `firebase_client_email` and `firebase_private_key` from a service-account JSON key with permission to send Firebase Cloud Messaging messages.

The backend exposes only the public Android app identifiers. The service-account email/private key remain server-side. A `google-services.json` file is not required because Podwaffle initializes Firebase programmatically. The device must include Google Play services; sideloading the APK is supported by FCM and does not require Play Store distribution.

After first launch, the Android app registers its FCM token against the active Podwaffle user GUID. Device cache commands can be sent with `POST /api/users/:guid/push/command`, for example `{ "command": "cache_episode", "data": { "episode": { ... } } }`.

### Via Direct URL
You can also access Podwaffle directly on the exposed port (default `3000`) without using Ingress:
1. In the add-on settings, toggle **"Show in sidebar"** and/or enable **"Network"** settings to expose a port.
2. Access via `http://[HA-IP]:[PORT]` (e.g., `http://192.168.1.100:3000`).

### Behind a Reverse Proxy
If you deploy Podwaffle behind your own reverse proxy (nginx, Traefik, etc.), the app will automatically detect the base path from `window.location.pathname` and route accordingly. This works seamlessly as long as your reverse proxy:
- Proxies all requests to `/` on the backend
- Preserves the request path (e.g., `/app/podcasts` → backend receives `/app/podcasts`)
