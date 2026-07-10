#!/usr/bin/env bash
# Creates small/ subdirectories under every content directory that contains
# image files. Run this after adding new content and before starting the
# server — the on-the-fly resize needs these dirs to write derivatives into.
#
# To *regenerate* all derivatives (e.g. after changing resize settings),
# delete the small/ dirs first and restart the server:
#   find POLINA_SITE -type d -name small -exec rm -rf {} +
#   IMAGE_RESIZE_FORCE=1 deno run … server.ts   # (optional; forces a fresh scan)
#   ./ensure-small-dirs.sh

set -euo pipefail

SITE_DIR="${POLINA_SITE:-.}"
DIRS=()
for sub in comics arts characters; do
  [ -d "$SITE_DIR/$sub" ] && DIRS+=("$SITE_DIR/$sub")
done
[ ${#DIRS[@]} -eq 0 ] && echo "No comics/ arts/ or characters/ found under $SITE_DIR (run from repo root or set POLINA_SITE)" && exit 1

for root in "${DIRS[@]}"; do
  find "$root" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' -o -name '*.gif' -o -name '*.bmp' \) \
    ! -path '*/small/*' \
    -printf '%h\n' 2>/dev/null | sort -u | while IFS= read -r dir; do
    mkdir -p "$dir/small"
  done
done

echo "small/ directories created under $SITE_DIR/comics, $SITE_DIR/arts, $SITE_DIR/characters."
