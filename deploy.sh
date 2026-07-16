#!/usr/bin/env bash
# 微信联机麻将 - 国内 Linux 服务器一键部署脚本
# 运行环境：Ubuntu 22.04+ / Debian 11+（需 root 或 sudo 权限）
# 前置：已有一个域名解析到本服务器，且 80/443 端口开放

set -e

DOMAIN="${1:-}"
APP_DIR="/opt/wechat-mahjong"
SERVICE_NAME="wechat-mahjong"

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 用户运行，或前面加 sudo： sudo bash deploy.sh your-domain.com"
  exit 1
fi

if [ -z "$DOMAIN" ]; then
  echo "用法： bash deploy.sh <你的域名>"
  echo "示例： bash deploy.sh mj.example.com"
  echo ""
  echo "如果你没有域名，可以临时用 IP 测试，但微信内置浏览器通常要求 https，"
  echo "上线还是建议准备一个已备案的域名并解析到这台服务器。"
  exit 1
fi

echo "===== 1. 安装依赖 ====="
apt-get update -y
apt-get install -y curl gnupg2 ca-certificates lsb-release nginx certbot python3-certbot-nginx

# 安装 Node.js 22 LTS（长期支持版）
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

node -v
npm -v

echo "===== 2. 部署应用 ====="
mkdir -p "$APP_DIR"
# 假设本脚本和 ZIP 解压后的文件在同一目录下
rsync -av --exclude='node_modules' --exclude='.git' --exclude='.workbuddy' \
  "$(dirname "$0")/" "$APP_DIR/"

cd "$APP_DIR"
npm install --production

echo "===== 3. 创建 systemd 服务 ====="
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=WeChat Mahjong WebSocket Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=on-failure
RestartSec=5
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"

echo "===== 4. 配置 nginx（反向代理 + WebSocket 升级） ====="
cat > "/etc/nginx/sites-available/${SERVICE_NAME}" <<'EOF'
server {
    listen 80;
    server_name PLACEHOLDER;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
EOF

sed -i "s/PLACEHOLDER/$DOMAIN/g" "/etc/nginx/sites-available/${SERVICE_NAME}"

rm -f "/etc/nginx/sites-enabled/${SERVICE_NAME}"
ln -s "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"

# 移除 nginx 默认站点，避免 80 端口冲突
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl restart nginx

echo "===== 5. 申请 SSL 证书（Let's Encrypt） ====="
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "证书已存在，跳过申请"
else
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "admin@$DOMAIN" || {
    echo "证书申请失败，请确认域名已解析到本服务器，且 80 端口能被外网访问。"
    exit 1
  }
fi

echo "===== 6. 启动麻将服务 ====="
systemctl start "$SERVICE_NAME"

echo ""
echo "===== 部署完成 ====="
echo "访问地址：https://$DOMAIN"
echo "服务状态： systemctl status $SERVICE_NAME"
echo "查看日志： journalctl -u $SERVICE_NAME -f"
echo ""
echo "把 https://$DOMAIN 发到微信，点开即可多人联机玩。"
