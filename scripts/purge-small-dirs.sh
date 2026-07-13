#!/usr/bin/env bash
# Removes every generated small/ directory under POLINA_SITE.

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
