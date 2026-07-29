#!/usr/bin/env bash
# Выпуск сертификатов для hardgrizz.art.
# Теперь это часть scripts/setup-certs.sh; сохранён для обратной совместимости.
set -euo pipefail

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$DIR/scripts/setup-certs.sh" "$@"
