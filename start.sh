#!/usr/bin/env bash
deno run --allow-net --allow-read "`dirname $0`/server.ts" 0.0.0.0 9090