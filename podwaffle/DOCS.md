# Podwaffle Home Assistant app

Podwaffle serves its web client, API and WebSocket endpoint from internal port 3000. Home Assistant ingress or an existing nginx proxy should terminate TLS and forward the original host, protocol and client address. Forward `/ws` with WebSocket upgrade support.

Configure at least:

```yaml
profiles: "Sam,Guest"
join_code: "a-long-private-code"
```

All durable state is stored below `/data`. Removing a configured profile disables it without deleting its state; adding the same name later enables it again.

## Optional Firebase wake-up

Firebase Cloud Messaging can nudge a sleeping Android client when profile state
changes or another client sends it a playback command. Push is supplementary:
the Android client always catches up from the authenticated REST API and only
confirms commands after the existing playback controller has executed them.

Place both Firebase project files in this app's Home Assistant configuration
directory (shown by Home Assistant below `/addon_configs` and mounted as
`/config` inside the container):

- `firebase-service-account.json` — the private Admin SDK service-account key.
- `google-services.json` — the Android app configuration containing the
  `com.podwaffle.app` client.

Then configure:

```yaml
firebase_enabled: true
firebase_project_id: "your-firebase-project-id"
firebase_service_account_path: /config/firebase-service-account.json
firebase_android_config_path: /config/google-services.json
```

The `/addon_configs/...` directory visible from Home Assistant is already mounted
as `/config` in the add-on. Do not repeat the host-side add-on folder name in the
container path unless you deliberately created that extra subdirectory.

The add-on validates that both files refer to the configured project and that
the Android file contains the Podwaffle package. Keep the service-account file
private.

An APK must also be built with the same `google-services.json`; placing it in the
add-on directory cannot retrofit Firebase into an already-built APK. For a local
monorepo build, the Android app automatically detects this file at the repository
root (or `apps/android/google-services.json`). Otherwise, set
`PODWAFFLE_GOOGLE_SERVICES_FILE` to its build-machine path before prebuild. With
Firebase disabled or absent, normal foreground REST/WebSocket synchronisation
continues unchanged.

From the repository root, rebuild the Android APK with:

```sh
cd apps/android
pnpm exec expo prebuild --platform android --no-install
gradlew.bat :app:assembleDebug
```

Home Assistant builds the app locally from the `podwaffle` directory when it is installed from this repository. The Dockerfile fetches the `main` branch from GitHub because Home Assistant does not include the monorepo root in the Docker build context. Commit and publish server changes before increasing the add-on version; otherwise a locally rebuilt Android app can be newer than the server that Home Assistant downloads.

The equivalent local build command is:

```sh
docker build -t podwaffle:local podwaffle
```

When releasing an update, change the `version` in `config.yaml`. Home Assistant will then detect the new version and rebuild the app during installation or update.

See the root README for backup, restore and reverse-proxy details.
