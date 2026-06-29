#!/usr/bin/with-contenv bashio
set -euo pipefail

export PORT="${PORT:-3000}"

bashio::log.info "Starting Podwaffle on port ${PORT}"
cd /opt/podwaffle/server
exec node server.js
