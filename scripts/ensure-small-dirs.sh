#!/usr/bin/env bash
# Creates small/ subdirectories under every content directory that contains
# image files. Run this after adding new content and before starting the
# server — the on-the-fly resize needs these dirs to write derivatives into.
#
# To *regenerate* all derivatives (e.g. after changing resize settings),
# delete the small/ dirs first and restart the server:
#   find COMICS_DIR ARTS_DIR -type d -name small -exec rm -rf {} +
#   IMAGE_RESIZE_FORCE=1 deno run … server.ts   # (optional; forces a fresh scan)
#   ./ensure-small-dirs.sh

set -euo pipefail

COMICS_DIR="${COMICS_DIR:-comics}"
ARTS_DIR="${ARTS_DIR:-arts}"
DIRS=()
[ -d "$COMICS_DIR" ] && DIRS+=("$COMICS_DIR")
[ -d "$ARTS_DIR" ] && DIRS+=("$ARTS_DIR")
[ ${#DIRS[@]} -eq 0 ] && echo "Neither $COMICS_DIR nor $ARTS_DIR found (run from repo root or set env)" && exit 1

for root in "${DIRS[@]}"; do
  find "$root" -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.webp' -o -name '*.gif' -o -name '*.bmp' \) \
    ! -path '*/small/*' \
    -printf '%h\n' 2>/dev/null | sort -u | while IFS= read -r dir; do
    mkdir -p "$dir/small"
  done
done

echo "small/ directories created under $COMICS_DIR and $ARTS_DIR."
