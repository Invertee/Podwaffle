# Podwaffle Windows tray controller

This is a small Windows-only Go tray application for Podwaffle. It opens a
native media control window when the tray icon is clicked and relays play,
pause, 15-second rewind, and 30-second skip commands to the profile's active
Podwaffle playback device.

The client deliberately uses the same controller API as the Home Assistant
integration:

- `GET /api/v1/join/profiles`
- `POST /api/v1/join` with `platform: "home_assistant"`
- `GET /api/v1/snapshot`
- `POST /api/v1/playback/commands`

The setup field accepts either the server's join code (the normal first-run
flow) or an existing profile-scoped bearer device token. After joining, the
returned token is protected with Windows DPAPI and stored under the current
user's application configuration directory.

## Build

From this directory on Windows:

```powershell
go build -trimpath -ldflags="-H=windowsgui -s -w" -o PodwaffleTray.exe .
```

To cross-compile from another platform:

```sh
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-H=windowsgui -s -w" -o PodwaffleTray.exe .
```

Run `PodwaffleTray.exe`, enter the direct Podwaffle server URL (for example
`http://192.168.1.20:3000`), load profiles, select one, and connect.

The Windows tray client is a controller only; audio remains on the active web,
Android, or Cast Podwaffle player. If no playback owner is connected, the
server will report that commands cannot be delivered.
