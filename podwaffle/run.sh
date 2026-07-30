#!/bin/sh
set -eu

if [ ! -f /data/options.json ]; then
  echo '{"level":"error","event":"startup.options_missing","path":"/data/options.json"}'
  exit 1
fi

exec node /app/apps/server/dist/index.js
