#!/usr/bin/env bash
# Removes every small/ directory under POLINA_SITE. Run this before restarting
# the server with IMAGE_RESIZE_FORCE=1 to force a full regeneration of all
# derivatives.
#
#   ./purge-small-dirs.sh
#   IMAGE_RESIZE_FORCE=1 deno run … server.ts

set -euo pipefail

SITE_DIR="${POLINA_SITE:-.}"
DIRS=()
for sub in comics arts characters; do
  [ -d "$SITE_DIR/$sub" ] && DIRS+=("$SITE_DIR/$sub")
done
[ ${#DIRS[@]} -eq 0 ] && echo "No comics/ arts/ or characters/ found under $SITE_DIR (run from repo root or set POLINA_SITE)" && exit 1

for root in "${DIRS[@]}"; do
  find "$root" -type d -name small -exec rm -rf {} + 2>/dev/null || true
done

echo "small/ directories purged under $SITE_DIR/comics, $SITE_DIR/arts, $SITE_DIR/characters."
