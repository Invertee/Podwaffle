#!/usr/bin/with-contenv bashio
set -euo pipefail

export PORT="${PORT:-3000}"
export DISABLE_NEW_USER_SESSIONS="false"

if bashio::config.true 'disable_new_user_sessions'; then
	export DISABLE_NEW_USER_SESSIONS="true"
fi

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

if [ -d "${APP_DIR}/.git" ]; then
  APP_COMMIT="$(git -C "${APP_DIR}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
else
  APP_COMMIT="unknown"
fi

CLIENT_JS_HASH="$(sha256sum "${APP_DIR}/client/js/app.js" 2>/dev/null | awk '{print $1}' || echo missing)"
CLIENT_CSS_HASH="$(sha256sum "${APP_DIR}/client/css/app.css" 2>/dev/null | awk '{print $1}' || echo missing)"
SERVER_HASH="$(sha256sum "${APP_DIR}/server/server.js" 2>/dev/null | awk '{print $1}' || echo missing)"

bashio::log.info "Deployed source commit: ${APP_COMMIT}"
bashio::log.info "Deployed file fingerprints: client/js/app.js=${CLIENT_JS_HASH} client/css/app.css=${CLIENT_CSS_HASH} server/server.js=${SERVER_HASH}"

bashio::log.info "Starting Podwaffle on port ${PORT} (data: ${DATA_DIR}, disable_new_user_sessions=${DISABLE_NEW_USER_SESSIONS})"
cd "${APP_DIR}/server"
exec node -r ./services/castDeviceRegistryCleanup.js -r ./services/castSessionRecovery.js server.js
