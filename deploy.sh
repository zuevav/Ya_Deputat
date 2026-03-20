#!/bin/bash
# Скрипт быстрого развёртывания "Я Депутат" на Ubuntu 22.04
# Перед сервером стоит Nginx Proxy Manager (SSL/домен уже настроены)
set -e

APP_DIR="/opt/ya-deputat"
APP_USER="ya-deputat"
PORT="${1:-3000}"

echo "========================================="
echo "  Развёртывание «Я Депутат»"
echo "  Ubuntu 22.04 + Nginx Proxy Manager"
echo "========================================="

# Проверка root
if [ "$EUID" -ne 0 ]; then
  echo "Запустите от root: sudo bash deploy.sh [порт]"
  echo "  Пример: sudo bash deploy.sh 3000"
  exit 1
fi

# === 1. Обновление системы ===
echo ""
echo "[1/4] Обновление системы..."
apt-get update -qq
apt-get upgrade -y -qq

# === 2. Установка Node.js 20 ===
echo "[2/4] Установка Node.js 20..."
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
apt-get install -y -qq build-essential
echo "  Node.js $(node -v), npm $(npm -v)"

# === 3. Установка приложения ===
echo "[3/4] Настройка приложения..."
id "$APP_USER" &>/dev/null || useradd -r -s /bin/false "$APP_USER"

mkdir -p "$APP_DIR"
cp -r . "$APP_DIR/"
cd "$APP_DIR"

npm ci --production 2>/dev/null || npm install --production
mkdir -p "$APP_DIR/data" "$APP_DIR/uploads"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# === 4. Systemd сервис ===
echo "[4/4] Создание systemd сервиса..."
cat > /etc/systemd/system/ya-deputat.service << EOF
[Unit]
Description=Я Депутат — PWA приложение
After=network.target

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=JWT_SECRET=$(openssl rand -hex 32)

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ya-deputat
systemctl restart ya-deputat

# === Готово ===
echo ""
echo "========================================="
echo "  Развёртывание завершено!"
echo "========================================="
echo ""
echo "  Приложение слушает: http://127.0.0.1:${PORT}"
echo "  Логин админа: admin / admin123"
echo ""
echo "  В NPM создайте Proxy Host:"
echo "    Forward Hostname: 127.0.0.1"
echo "    Forward Port:     ${PORT}"
echo ""
echo "  Команды:"
echo "    sudo systemctl status ya-deputat   — статус"
echo "    sudo systemctl restart ya-deputat  — перезапуск"
echo "    sudo journalctl -u ya-deputat -f   — логи"
echo ""
echo "  ВАЖНО: смените пароль админа после первого входа!"
echo "========================================="
