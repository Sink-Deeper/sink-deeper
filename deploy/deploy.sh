#!/usr/bin/env bash
# Build the client locally and push the app to the server. Usage: deploy/deploy.sh root@HOST
set -euo pipefail
HOST="${1:?usage: deploy/deploy.sh user@host}"
cd "$(dirname "$0")/.."

echo "== building client"
npx vite build >/dev/null

echo "== syncing to $HOST:/opt/murmur"
rsync -az --delete \
  --exclude node_modules --exclude data --exclude .git --exclude .env --exclude '*.log' \
  ./ "$HOST:/opt/murmur/"

echo "== installing deps + restarting"
ssh "$HOST" 'set -e; cd /opt/murmur && npm ci --omit=dev --no-audit --no-fund --loglevel=error && chown -R murmur:murmur /opt/murmur && systemctl restart murmur && sleep 2 && systemctl is-active murmur && curl -sf -o /dev/null -w "local api: %{http_code}\n" http://127.0.0.1:3000/api/browse/stats'
echo "== deployed"
