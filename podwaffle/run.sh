#!/usr/bin/with-contenv bashio
set -euo pipefail

export PORT="${PORT:-3000}"
SRC_DIR="/opt/podwaffle/src"

# Option A: Set to "/config" to place 'users' and 'podcasts' directly in the root of the share.
# Option B: Set to "/config/data" if you want them isolated inside a 'data' subfolder.
DATA_DIR="/config"
export DATA_DIR

# Ensure the clean application folders exist inside your persistent network share
mkdir -p "${DATA_DIR}/users" "${DATA_DIR}/podcasts"

# In case Podwaffle's backend looks for a relative './data' folder next to server.js,
# we safely symlink it to point to the network storage mount point.
rm -f "${SRC_DIR}/data" 2>/dev/null || true
ln -s "${DATA_DIR}" "${SRC_DIR}/data"

bashio::log.info "Starting Podwaffle on port ${PORT} (Data mapped to: ${DATA_DIR})"
cd "${SRC_DIR}/server"
exec node server.js
