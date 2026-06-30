# Podwaffle Home Assistant Integration

This custom integration exposes Podwaffle as a Home Assistant `media_player` entity.

## Features

- Config flow setup from the Home Assistant UI.
- Initial setup asks for:
  - `Server URL` (e.g. `http://homeassistant.local:3000`)
  - `User GUID` (Podwaffle profile to control)
- Shows currently playing podcast episode metadata.
- Supports media controls:
  - play / pause / stop
  - next / previous
  - seek
  - set volume

## Install

1. Copy `custom_components/podwaffle` into your Home Assistant config folder under:
   - `<config>/custom_components/podwaffle`
2. Restart Home Assistant.
3. Go to **Settings → Devices & Services → Add Integration**.
4. Search for **Podwaffle**.
5. Enter your Podwaffle server URL and user GUID.

## Notes

- One integration entry maps to one Podwaffle user GUID.
- Add multiple entries if you want one media player entity per user profile.
- The integration uses Podwaffle bridge endpoints:
  - `GET /api/ha/media-player/:guid/state`
  - `POST /api/ha/media-player/:guid/command`