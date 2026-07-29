#!/usr/bin/env bash
# Запуск DDNS для зоны hardgrizz.art из собственного compose-файла репозитория.
set -euo pipefail

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR/compose"

docker compose up -d
