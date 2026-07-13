#!/usr/bin/env bash

set -euo pipefail

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

exec deno run \
    --allow-net --allow-read --allow-env --allow-write \
    --allow-run=magick,convert,identify \
    "$DIR/server.ts" 127.0.0.1 "${1:-8080}"
