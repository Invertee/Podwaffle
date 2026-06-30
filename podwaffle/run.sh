#!/usr/bin/with-contenv bashio
set -euo pipefail

export PORT="${PORT:-3000}"

APP_DIR="/config/app"
SRC_DIR="/opt/podwaffle/src"
DATA_DIR="/config/data"
VERSION_FILE="${APP_DIR}/.app_version"
export DATA_DIR

mkdir -p /config "${APP_DIR}" "${DATA_DIR}/users" "${DATA_DIR}/podcasts"

# Get current source version (git commit hash or file hash as fallback)
get_source_version() {
  if [ -d "${SRC_DIR}/.git" ]; then
    cd "${SRC_DIR}" && git rev-parse HEAD 2>/dev/null || echo "unknown"
  else
    # Fallback: hash of server.js as version indicator
    if [ -f "${SRC_DIR}/server/server.js" ]; then
      md5sum "${SRC_DIR}/server/server.js" 2>/dev/null | awk '{print $1}' || echo "unknown"
    else
      echo "unknown"
    fi
  fi
}

SOURCE_VERSION=$(get_source_version)
STORED_VERSION=""
if [ -f "${VERSION_FILE}" ]; then
  STORED_VERSION=$(cat "${VERSION_FILE}")
fi

# Populate or update app source if version changed
if [ ! -f "${APP_DIR}/server/server.js" ] || [ "${SOURCE_VERSION}" != "${STORED_VERSION}" ]; then
  if [ ! -f "${APP_DIR}/server/server.js" ]; then
    bashio::log.info "Populating add-on app directory at ${APP_DIR}"
  else
    bashio::log.info "App source updated (v${STORED_VERSION:0:8}... → v${SOURCE_VERSION:0:8}...). Refreshing..."
  fi
  
  # Backup old data dir if it exists
  if [ -d "${APP_DIR}/data" ]; then
    rm -rf "${APP_DIR}/data" 2>/dev/null || true
  fi
  
  # Copy fresh source, preserving data symlink location
  cp -a "${SRC_DIR}/." "${APP_DIR}/"
  echo "${SOURCE_VERSION}" > "${VERSION_FILE}"
  bashio::log.info "App directory updated. Version: ${SOURCE_VERSION:0:8}..."
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

# Ensure data symlink points to the right place
rm -f "${APP_DIR}/data" 2>/dev/null || true
ln -s "${DATA_DIR}" "${APP_DIR}/data"

bashio::log.info "Starting Podwaffle on port ${PORT} (data: ${DATA_DIR})"
cd "${APP_DIR}/server"
exec node server.js
