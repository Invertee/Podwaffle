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

The monorepo-root build command is:

```sh
docker build -f podwaffle/Dockerfile -t podwaffle:local .
```

The image supports `amd64` and `aarch64` through Docker Buildx. For a local
Home Assistant app repository, publish the resulting architecture images and set
the repository metadata to those images, or use the release packaging workflow.

See the root README for backup, restore and reverse-proxy details.
