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

## Deployment Methods

### Via Home Assistant Ingress (Reverse Proxy)
When installed as an HA add-on using **Ingress**, the app runs behind HA's reverse proxy at a base path like `/api/hassio/...`. The app automatically detects this base path and routes all API calls, WebSocket connections, and asset requests correctly.

### Via Direct URL
You can also access Podwaffle directly on the exposed port (default `3000`) without using Ingress:
1. In the add-on settings, toggle **"Show in sidebar"** and/or enable **"Network"** settings to expose a port.
2. Access via `http://[HA-IP]:[PORT]` (e.g., `http://192.168.1.100:3000`).

### Behind a Reverse Proxy
If you deploy Podwaffle behind your own reverse proxy (nginx, Traefik, etc.), the app will automatically detect the base path from `window.location.pathname` and route accordingly. This works seamlessly as long as your reverse proxy:
- Proxies all requests to `/` on the backend
- Preserves the request path (e.g., `/app/podcasts` → backend receives `/app/podcasts`)
