#!/usr/bin/env bash
#
# Deploy the site's source code (server.ts, static/, nginx.conf, deno.json)
# to production via rsync. comics/ and arts/ are user content and are
# never touched by this script — only application code is synced.
#
# Setup: fill in REMOTE_HOST / REMOTE_PATH / RESTART_CMD below, then run:
#   ./deploy.sh
#
set -euo pipefail

REMOTE_HOST="user@your-server"                     # ← change me
REMOTE_PATH="/path/to/polina_site"                  # ← change me
RESTART_CMD="sudo systemctl restart comic-server"   # ← change me, or leave "" to skip

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Syncing ${SCRIPT_DIR}/ -> ${REMOTE_HOST}:${REMOTE_PATH}/"

rsync -avz \
  --exclude 'comics/' \
  --exclude 'arts/' \
  --exclude '.git/' \
  --exclude '.vscode/' \
  --exclude 'TODO' \
  "$SCRIPT_DIR/" "$REMOTE_HOST:$REMOTE_PATH/"

if [ -n "$RESTART_CMD" ]; then
  echo "Restarting server on ${REMOTE_HOST}..."
  ssh "$REMOTE_HOST" "cd $REMOTE_PATH && $RESTART_CMD"
fi

echo "Deploy complete."
