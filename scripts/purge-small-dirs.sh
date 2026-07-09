#!/usr/bin/env bash
# Removes every small/ directory under COMICS_DIR and ARTS_DIR. Run this
# before restarting the server with IMAGE_RESIZE_FORCE=1 to force a full
# regeneration of all derivatives.
#
#   ./purge-small-dirs.sh
#   IMAGE_RESIZE_FORCE=1 deno run … server.ts

set -euo pipefail

COMICS_DIR="${COMICS_DIR:-comics}"
ARTS_DIR="${ARTS_DIR:-arts}"
DIRS=()
[ -d "$COMICS_DIR" ] && DIRS+=("$COMICS_DIR")
[ -d "$ARTS_DIR" ] && DIRS+=("$ARTS_DIR")
[ ${#DIRS[@]} -eq 0 ] && echo "Neither $COMICS_DIR nor $ARTS_DIR found (run from repo root or set env)" && exit 1

for root in "${DIRS[@]}"; do
  find "$root" -type d -name small -exec rm -rf {} + 2>/dev/null || true
done

echo "small/ directories purged under $COMICS_DIR and $ARTS_DIR."
