#!/bin/sh
set -eu

if [ ! -f /data/options.json ]; then
  echo "$(date -Iseconds) [ERROR] Home Assistant did not provide /data/options.json"
  exit 1
fi

exec node /app/apps/server/dist/index.js
