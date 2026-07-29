#!/usr/bin/env bash
# Выпуск сертификатов для hardgrizz.art через контейнер certbot/dns-cloudflare.
# Использует общий для всех сайтов на машине credentials-файл
# /etc/letsencrypt/cloudflare.ini, чтобы единый таймер certbot-renew.timer мог
# продлевать все сертификаты сразу.
#
# Запуск НА СЕРВЕРЕ:
#   ./scripts/setup-certs.sh
set -euo pipefail

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

CREDS="/etc/letsencrypt/cloudflare.ini"

ensure_credentials() {
  if [[ -f "$CREDS" ]]; then
    return 0
  fi

  # Попробуем перенести существующий файл из compose, если он есть.
  LEGACY="$DIR/compose/cloudflare.ini"
  if [[ -f "$LEGACY" ]]; then
    echo "Копирую $LEGACY -> $CREDS"
    sudo mkdir -p /etc/letsencrypt
    sudo cp "$LEGACY" "$CREDS"
    sudo chmod 600 "$CREDS"
    return 0
  fi

  echo "Ошибка: не найден файл с Cloudflare API-токеном: $CREDS" >&2
  echo "Создайте его вручную (права 600) с содержимым:" >&2
  echo "  dns_cloudflare_api_token = <токен с Zone.DNS:Edit для всех зон>" >&2
  exit 1
}

ensure_credentials

docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v "$CREDS:/cloudflare.ini:ro" \
  certbot/dns-cloudflare certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /cloudflare.ini \
  --dns-cloudflare-propagation-seconds 30 \
  --non-interactive --agree-tos --no-eff-email \
  --cert-name hardgrizz.art \
  --expand \
  -d hardgrizz.art -d www.hardgrizz.art

sudo systemctl reload apache2 || true
echo "Готово: /etc/letsencrypt/live/hardgrizz.art/"
