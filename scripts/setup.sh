#!/usr/bin/env bash
# Полная настройка инфраструктуры polina_site: DDNS + сертификаты + таймер продления.
# Запуск НА СЕРВЕРЕ:
#   ./scripts/setup.sh
set -euo pipefail

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> DDNS для hardgrizz.art"
"$DIR/scripts/setup-ddns.sh"

echo "==> Сертификаты"
"$DIR/scripts/setup-certs.sh"

echo "==> Таймер продления (общий для всех сайтов)"
"$DIR/scripts/setup-renewal.sh"

echo "Готово. Проверка таймера:"
systemctl status certbot-renew.timer --no-pager | head -5
