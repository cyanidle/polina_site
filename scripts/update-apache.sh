#!/usr/bin/env bash
# Update the Apache config for hardgrizz.art on this server from the repo
# (config/comic.conf). Run with sudo:
#   sudo ./scripts/update-apache.sh
set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET=/etc/apache2/sites-available/comic.conf

if [ -f "$TARGET" ]; then
  cp -a "$TARGET" "$TARGET.bak.$(date +%Y%m%d%H%M%S)"
fi
install -m 644 "$DIR/config/comic.conf" "$TARGET"
a2ensite comic >/dev/null
apachectl configtest
systemctl reload apache2

echo "Done: comic.conf updated, Apache reloaded."
