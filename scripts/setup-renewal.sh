#!/usr/bin/env bash
# Установка единого системного таймера продления сертификатов.
# Один и тот же файл ставится из polina_site и из piokurort — повторный запуск
# просто перезаписывает файлы, поэтому в системе всегда один таймер.
set -euo pipefail

DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

sudo cp "$DIR/systemd/certbot-renew.service" /etc/systemd/system/
sudo cp "$DIR/systemd/certbot-renew.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now certbot-renew.timer
