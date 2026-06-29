#!/usr/bin/with-contenv bashio
set -euo pipefail

export PORT="${PORT:-3000}"

APP_DIR="/config/app"
SRC_DIR="/opt/podwaffle/src"

mkdir -p /data
mkdir -p /config
mkdir -p "${APP_DIR}"

if [ ! -f "${APP_DIR}/server/server.js" ]; then
  bashio::log.info "Populating add-on app directory at ${APP_DIR}"
  cp -a "${SRC_DIR}/." "${APP_DIR}/"
fi

rm -rf "${APP_DIR}/data"
ln -s /data "${APP_DIR}/data"

bashio::log.info "Starting Podwaffle on port ${PORT}"
cd "${APP_DIR}/server"
exec node server.js
