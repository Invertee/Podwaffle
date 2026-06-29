#!/usr/bin/with-contenv bashio
set -euo pipefail

export PORT="${PORT:-3000}"

APP_DIR="/config/app"
SRC_DIR="/opt/podwaffle/src"
DATA_DIR="/config/data"
export DATA_DIR

mkdir -p /config "${APP_DIR}" "${DATA_DIR}/users" "${DATA_DIR}/podcasts"

# Populate app source on first boot
if [ ! -f "${APP_DIR}/server/server.js" ]; then
  bashio::log.info "Populating add-on app directory at ${APP_DIR}"
  cp -a "${SRC_DIR}/." "${APP_DIR}/"
fi

# One-time migration: copy any data from the old /data HA mount into /config/data
if [ -d /data/users ] && [ -z "$(ls -A "${DATA_DIR}/users" 2>/dev/null)" ]; then
  bashio::log.info "Migrating user data from /data to ${DATA_DIR}"
  cp -a /data/users/. "${DATA_DIR}/users/" 2>/dev/null || true
fi
if [ -d /data/podcasts ] && [ -z "$(ls -A "${DATA_DIR}/podcasts" 2>/dev/null)" ]; then
  bashio::log.info "Migrating podcast data from /data to ${DATA_DIR}"
  cp -a /data/podcasts/. "${DATA_DIR}/podcasts/" 2>/dev/null || true
fi

bashio::log.info "Starting Podwaffle on port ${PORT} (data: ${DATA_DIR})"
cd "${APP_DIR}/server"
exec node server.js
