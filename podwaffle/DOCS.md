# Podwaffle Home Assistant app

Podwaffle serves its web client, API and WebSocket endpoint from internal port 3000. Home Assistant ingress or an existing nginx proxy should terminate TLS and forward the original host, protocol and client address. Forward `/ws` with WebSocket upgrade support.

Configure at least:

```yaml
profiles: "Sam,Guest"
join_code: "a-long-private-code"
```

All durable state is stored below `/data`. Removing a configured profile disables it without deleting its state; adding the same name later enables it again.

Home Assistant builds the app locally from the `podwaffle` directory when it is installed from this repository. The Dockerfile fetches the current application source from the repository because Home Assistant does not include the monorepo root in the Docker build context.

The equivalent local build command is:

```sh
docker build -t podwaffle:local podwaffle
```

When releasing an update, change the `version` in `config.yaml`. Home Assistant will then detect the new version and rebuild the app during installation or update.

See the root README for backup, restore and reverse-proxy details.
