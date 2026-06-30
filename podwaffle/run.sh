#!/usr/bin/with-contenv bashio
set -euo pipefail

export PORT="${PORT:-3000}"

SRC_DIR="/opt/podwaffle/src"
APP_DIR="/config/app"
DATA_DIR="/config/data"
export DATA_DIR

mkdir -p /config "${APP_DIR}" "${DATA_DIR}/users" "${DATA_DIR}/podcasts"

bashio::log.info "Deploying Podwaffle into ${APP_DIR}"
find "${APP_DIR}" -mindepth 1 -maxdepth 1 -exec rm -rf {} + 2>/dev/null || true
cp -a "${SRC_DIR}/." "${APP_DIR}/"

rm -rf "${APP_DIR}/data" 2>/dev/null || true
ln -s "${DATA_DIR}" "${APP_DIR}/data"

bashio::log.info "Starting Podwaffle on port ${PORT} (data: ${DATA_DIR})"
cd "${APP_DIR}/server"
exec node server.js
