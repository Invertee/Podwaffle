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
- The add-on build clones the GitHub repository at build time, so your repo must be public or otherwise accessible to the Home Assistant build environment.
- Persistent app data is stored via the Home Assistant add-on `/data` volume and mounted into Podwaffle's expected data directory at runtime.
- If you publish under a different GitHub URL, update `url` in `config.json` and `repository.yaml`.
