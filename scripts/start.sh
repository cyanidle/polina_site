#!/usr/bin/env bash
deno run --allow-net --allow-read --allow-env --allow-write --allow-run=magick,convert,identify "`dirname $0`/server.ts" 0.0.0.0 ${1:-9090}