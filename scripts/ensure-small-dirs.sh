#!/usr/bin/env bash
# Pre-creates derivative directories; the server also creates them on demand.

set -euo pipefail

SITE_DIR="${POLINA_SITE:-.}"
DIRS=()
for sub in comics arts characters; do
  [ -d "$SITE_DIR/$sub" ] && DIRS+=("$SITE_DIR/$sub")
done
[ ${#DIRS[@]} -eq 0 ] && echo "No comics/ arts/ or characters/ found under $SITE_DIR (run from repo root or set POLINA_SITE)" && exit 1

for root in "${DIRS[@]}"; do
  find "$root" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' -o -iname '*.gif' -o -iname '*.bmp' -o -iname '*.svg' \) \
    ! -path '*/small/*' \
    -printf '%h\n' 2>/dev/null | sort -u | while IFS= read -r dir; do
    mkdir -p "$dir/small"
  done
done

echo "small/ directories created under $SITE_DIR/comics, $SITE_DIR/arts, $SITE_DIR/characters."
