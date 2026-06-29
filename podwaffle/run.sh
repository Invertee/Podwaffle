#!/usr/bin/with-contenv bashio
set -euo pipefail

export PORT="${PORT:-3000}"

mkdir -p /data
mkdir -p /opt/podwaffle/src/data
rm -rf /opt/podwaffle/src/data
ln -s /data /opt/podwaffle/src/data

bashio::log.info "Starting Podwaffle on port ${PORT}"
cd /opt/podwaffle/src/server
exec node server.js
