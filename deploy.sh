#!/bin/bash
# Скрипт быстрого развёртывания "Я Депутат" на Ubuntu 22.04
set -e

APP_DIR="/opt/ya-deputat"
APP_USER="ya-deputat"
DOMAIN="${1:-}"
PORT=3000

echo "========================================="
echo "  Развёртывание «Я Депутат»"
echo "  Ubuntu 22.04"
echo "========================================="

# Проверка root
if [ "$EUID" -ne 0 ]; then
  echo "Запустите от root: sudo bash deploy.sh [домен]"
  exit 1
fi

# === 1. Обновление системы ===
echo ""
echo "[1/7] Обновление системы..."
apt-get update -qq
apt-get upgrade -y -qq

# === 2. Установка Node.js 20 ===
echo "[2/7] Установка Node.js 20..."
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d v) -lt 18 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
echo "  Node.js $(node -v), npm $(npm -v)"

# === 3. Установка вспомогательных пакетов ===
echo "[3/7] Установка nginx, certbot..."
apt-get install -y -qq nginx certbot python3-certbot-nginx build-essential

# === 4. Создание пользователя и копирование приложения ===
echo "[4/7] Настройка приложения..."
id "$APP_USER" &>/dev/null || useradd -r -s /bin/false "$APP_USER"

mkdir -p "$APP_DIR"
cp -r . "$APP_DIR/"
cd "$APP_DIR"

# Установка зависимостей
npm ci --production 2>/dev/null || npm install --production
mkdir -p "$APP_DIR/data" "$APP_DIR/uploads"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# === 5. Systemd сервис ===
echo "[5/7] Создание systemd сервиса..."
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
# Смените секрет в продакшене:
Environment=JWT_SECRET=$(openssl rand -hex 32)

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ya-deputat
systemctl restart ya-deputat

echo "  Сервис запущен на порту $PORT"

# === 6. Настройка Nginx ===
echo "[6/7] Настройка Nginx..."

SERVER_NAME="${DOMAIN:-_}"

cat > /etc/nginx/sites-available/ya-deputat << EOF
server {
    listen 80;
    server_name $SERVER_NAME;

    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/ya-deputat /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# === 7. SSL (если указан домен) ===
if [ -n "$DOMAIN" ]; then
  echo "[7/7] Получение SSL-сертификата для $DOMAIN..."
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email || {
    echo "  SSL не удалось получить. Настройте вручную: certbot --nginx -d $DOMAIN"
  }
else
  echo "[7/7] Домен не указан — SSL пропущен."
  echo "  Для SSL запустите: sudo certbot --nginx -d ваш-домен.ru"
fi

# === Готово ===
echo ""
echo "========================================="
echo "  Развёртывание завершено!"
echo "========================================="
echo ""
echo "  Приложение: http://${DOMAIN:-$(hostname -I | awk '{print $1}')}"
echo "  Логин админа: admin / admin123"
echo ""
echo "  Полезные команды:"
echo "    sudo systemctl status ya-deputat   — статус"
echo "    sudo systemctl restart ya-deputat  — перезапуск"
echo "    sudo journalctl -u ya-deputat -f   — логи"
echo ""
echo "  ВАЖНО: смените пароль админа после первого входа!"
echo "========================================="
