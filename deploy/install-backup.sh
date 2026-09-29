#!/usr/bin/env bash
# Installs the nightly B2 backup on the server. Run as root after placing /etc/murmur/backup.env.
set -euo pipefail
ENVF=/etc/murmur/backup.env
[[ -f "$ENVF" ]] || { echo "missing $ENVF (B2_KEY_ID, B2_APP_KEY, B2_BUCKET)"; exit 1; }
chmod 600 "$ENVF"; chown root:root "$ENVF"
chmod 640 /etc/murmur/env; chown root:murmur /etc/murmur/env
chmod 750 /var/lib/murmur 2>/dev/null || true

# Config backups are encrypted with this passphrase. It is generated once and lives only here, so
# SAVE IT SOMEWHERE ELSE (password manager): without it the config tarballs in B2 cannot be opened.
if ! grep -q '^BACKUP_PASSPHRASE=' "$ENVF"; then
  PASS=$(openssl rand -hex 24)
  echo "BACKUP_PASSPHRASE=$PASS" >> "$ENVF"
  echo
  echo "=============================================================================="
  echo " Generated config-backup passphrase. Store this in your password manager NOW:"
  echo "   $PASS"
  echo " Restore: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -in config-<ts>.tgz.enc | tar xz -C /"
  echo "=============================================================================="
  echo
fi

install -m 750 -o root -g root "$(dirname "$0")/backup.sh" /usr/local/bin/murmur-backup
cat > /etc/systemd/system/murmur-backup.service <<'UNIT'
[Unit]
Description=Murmur nightly backup to Backblaze B2
After=network-online.target
Wants=network-online.target
OnFailure=murmur-backup-failed.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/murmur-backup
Nice=10
IOSchedulingClass=idle
UNIT
# On failure, leave a marker the app's admin page surfaces (the backup script also writes one when it
# gets far enough to; this catches crashes before that point).
cat > /etc/systemd/system/murmur-backup-failed.service <<'UNIT'
[Unit]
Description=Record a failed Murmur backup

[Service]
Type=oneshot
ExecStart=/bin/sh -c 'printf "{\"ok\":false,\"at\":%s000,\"error\":\"backup service failed; see journalctl -u murmur-backup\"}\n" "$(date +%%s)" > /var/lib/murmur/backup-status.json; chmod 644 /var/lib/murmur/backup-status.json'
UNIT
cat > /etc/systemd/system/murmur-backup.timer <<'UNIT'
[Unit]
Description=Run Murmur backup nightly

[Timer]
OnCalendar=*-*-* 04:00:00 UTC
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now murmur-backup.timer
systemctl list-timers murmur-backup.timer --no-pager | head -3
