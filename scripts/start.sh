#!/usr/bin/env bash

DIR=$(realpath `dirname $0`/..)

deno run \
    --allow-net --allow-read --allow-env --allow-write \
    --allow-run=magick,convert,identify \
    "$DIR/server.ts" 0.0.0.0 ${1:-9090}