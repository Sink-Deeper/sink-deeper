#!/usr/bin/env bash
# One-time server provisioning for Murmur on Ubuntu 24.04. Run as root.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

APP_DIR=/opt/murmur
DATA_DIR=/var/lib/murmur
ENV_DIR=/etc/murmur
PUBLIC_HOST="${PUBLIC_HOST:-$(curl -s -4 ifconfig.me || hostname -I | awk '{print $1}')}"   # IP now, domain later

echo "== packages"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg ufw fail2ban unattended-upgrades ffmpeg rsync git build-essential python3 debian-keyring debian-archive-keyring apt-transport-https >/dev/null

echo "== node 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v; npm -v; ffmpeg -version | head -1

echo "== caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

echo "== swap (2G)"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null; echo 'vm.swappiness=10' > /etc/sysctl.d/99-swappiness.conf
fi

echo "== firewall + fail2ban + auto-updates"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
cat > /etc/fail2ban/jail.local <<'JAIL'
[sshd]
enabled = true
maxretry = 5
bantime = 1h
JAIL
systemctl enable --now fail2ban >/dev/null
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'AU'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
AU

echo "== app user + dirs"
id murmur >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin murmur
mkdir -p "$APP_DIR" "$DATA_DIR" "$ENV_DIR"
chown -R murmur:murmur "$DATA_DIR"

if [[ ! -f "$ENV_DIR/env" ]]; then
  cat > "$ENV_DIR/env" <<ENVF
NODE_ENV=production
PORT=3000
DATA_DIR=$DATA_DIR
MAX_UPLOAD_MB=500
KEEP_ORIGINALS=0
# Plain HTTP for now (no domain). Set COOKIE_SECURE=1 once HTTPS is live.
COOKIE_SECURE=0
PUBLIC_URL=http://$PUBLIC_HOST
ENVF
  chmod 640 "$ENV_DIR/env"; chown root:murmur "$ENV_DIR/env"
fi

echo "== systemd"
cat > /etc/systemd/system/murmur.service <<'UNIT'
[Unit]
Description=Murmur audio sharing
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=murmur
Group=murmur
WorkingDirectory=/opt/murmur
EnvironmentFile=/etc/murmur/env
ExecStart=/opt/murmur/node_modules/.bin/tsx server/index.ts
Restart=always
RestartSec=3
LimitNOFILE=65536
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/murmur
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable murmur >/dev/null

echo "== caddy config"
if ! grep -q "reverse_proxy 127.0.0.1:3000" /etc/caddy/Caddyfile 2>/dev/null; then
  cat > /etc/caddy/Caddyfile <<'CADDY'
{
	log default {
		output stderr
		exclude http.log.access
		format filter {
			request>remote_ip ip_mask 24 48
			request>client_ip ip_mask 24 48
			request>remote_port delete
			request>headers>X-Forwarded-For delete
			remote delete
			remote_port delete
			addr delete
			wrap json
		}
	}
}
# No domain yet: serve on plain HTTP. When you have a domain, replace ":80" with
# the hostname (e.g. "sighwave.com") and Caddy will obtain HTTPS automatically,
# then set COOKIE_SECURE=1 in /etc/murmur/env and restart murmur.
:80 {
	encode zstd gzip
	# The embed player is meant to be framed by other sites; everything else is not.
	@notembed not path /embed/*
	header @notembed {
		X-Frame-Options SAMEORIGIN
		Content-Security-Policy "frame-ancestors 'self'"
	}
	header {
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		-Server
	}
	request_body {
		max_size 520MB
	}
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
		transport http {
			read_timeout 2h
			write_timeout 2h
		}
	}
	log {
		output file /var/log/caddy/access.log {
			roll_size 25mb
			roll_keep 30
			roll_keep_for 168h
		}
		format filter {
			request>remote_ip ip_mask 24 48
			request>client_ip ip_mask 24 48
			request>remote_port delete
			request>headers>X-Forwarded-For delete
			wrap json
		}
	}
}
CADDY
fi
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
systemctl enable caddy >/dev/null; systemctl restart caddy

# Privacy: system logs kept 7 days (journal) and rotated daily with 7 kept (syslog); Caddy masks addresses.
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nMaxRetentionSec=7day\nMaxFileSec=1day\n' > /etc/systemd/journald.conf.d/retention.conf
systemctl restart systemd-journald
sed -i -e 's/^\(\s*\)weekly$/\1daily/' -e 's/^\(\s*\)rotate 4$/\1rotate 7/' /etc/logrotate.d/rsyslog


echo "== done. Public host: $PUBLIC_HOST"
