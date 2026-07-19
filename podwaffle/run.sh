#!/usr/bin/with-contenv bashio
set -euo pipefail

export PORT="${PORT:-3000}"
export PODWAFFLE_PROFILES="$(bashio::config 'profiles' 2>/dev/null || echo Default)"
export PODWAFFLE_ACCESS_KEY="$(bashio::config 'access_key' 2>/dev/null || true)"

export FIREBASE_PROJECT_ID="$(bashio::config 'firebase_project_id' 2>/dev/null || true)"
export FIREBASE_CLIENT_EMAIL="$(bashio::config 'firebase_client_email' 2>/dev/null || true)"
export FIREBASE_PRIVATE_KEY="$(bashio::config 'firebase_private_key' 2>/dev/null || true)"
export FIREBASE_API_KEY="$(bashio::config 'firebase_api_key' 2>/dev/null || true)"
export FIREBASE_APP_ID="$(bashio::config 'firebase_app_id' 2>/dev/null || true)"
export FIREBASE_SENDER_ID="$(bashio::config 'firebase_sender_id' 2>/dev/null || true)"
export FIREBASE_SERVICE_ACCOUNT_FILE="$(bashio::config 'firebase_service_account_file' 2>/dev/null || true)"
export FIREBASE_GOOGLE_SERVICES_FILE="$(bashio::config 'firebase_google_services_file' 2>/dev/null || true)"
export FIREBASE_SERVICE_ACCOUNT_JSON="$(bashio::config 'firebase_service_account_json' 2>/dev/null || true)"
export FIREBASE_GOOGLE_SERVICES_JSON="$(bashio::config 'firebase_google_services_json' 2>/dev/null || true)"

SRC_DIR="/opt/podwaffle/src"
APP_DIR="/config/app"
DATA_DIR="/config/data"
export DATA_DIR
export ADDON_CONFIG_DIR="/config"

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

ACCESS_KEY_STATUS="no"
if [ -n "${PODWAFFLE_ACCESS_KEY}" ]; then
	ACCESS_KEY_STATUS="yes"
fi
bashio::log.info "Starting Podwaffle on port ${PORT} (data: ${DATA_DIR}, profiles=${PODWAFFLE_PROFILES}, access_key_configured=${ACCESS_KEY_STATUS})"
cd "${APP_DIR}/server"
exec node -r ./services/castDeviceRegistryCleanup.js -r ./services/castSessionRecovery.js -r ./services/castVolumeSync.js server.js
