# Podwaffle Home Assistant app

Podwaffle serves its web client, API and WebSocket endpoint from internal port 3000. Home Assistant ingress or an existing nginx proxy should terminate TLS and
forward the original host, protocol and client address. Forward `/ws` with WebSocket
upgrade support.

Configure at least:

```yaml
profiles: "Sam,Guest"
join_code: "a-long-private-code"
```

All durable state is stored below `/data`. Removing a configured profile disables
it without deleting its state; adding the same name later enables it again.

Home Assistant pulls the pre-built multi-architecture image whose tag matches
the `version` in `config.yaml`. GitHub Actions publishes that image from the
repository source, so installation does not need GitHub credentials or compile
the application on the Home Assistant host.

The equivalent local build command is:

```sh
docker build -f podwaffle/Dockerfile -t podwaffle:local .
```

When releasing an update, change `version` in `config.yaml` in the same commit as
the application changes. The publish workflow creates both that version tag and
`latest` for `amd64` and `aarch64`.

After the workflow publishes the package for the first time, set the
`podwaffle` container package visibility to **Public** in GitHub. Home Assistant
pulls the image anonymously, even when the source repository itself is private.

See the root README for backup, restore and reverse-proxy details.
