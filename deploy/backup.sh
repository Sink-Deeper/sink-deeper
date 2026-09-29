#!/usr/bin/env bash
# Nightly off-site backup to Backblaze B2: consistent SQLite copy (sessions stripped), encrypted config,
# and all media (Bunny + any local). Append-only by design: `rclone copy` with a B2 key that lacks delete
# rights; bucket lifecycle prunes old dumps. Writes a status marker the admin page shows.
set -euo pipefail
set -a; . /etc/murmur/env; . /etc/murmur/backup.env; set +a

TS=$(date -u +%Y%m%d-%H%M%S)
TMP=$(mktemp -d); chmod 700 "$TMP"; trap 'rm -rf "$TMP"' EXIT
STATUS_FILE="${DATA_DIR}/backup-status.json"
fail() { printf '{"ok":false,"at":%s,"error":%s}\n' "$(date +%s000)" "$(printf '%s' "$1" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')" > "$STATUS_FILE"; chmod 644 "$STATUS_FILE"; echo "[backup] FAILED: $1" >&2; exit 1; }
trap 'fail "step failed at line $LINENO"' ERR

# rclone remotes from env (no config file on disk)
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_B2_TYPE=b2 RCLONE_CONFIG_B2_ACCOUNT="$B2_KEY_ID" RCLONE_CONFIG_B2_KEY="$B2_APP_KEY"
if [[ -n "${BUNNY_STORAGE_HOST:-}" ]]; then
  export RCLONE_CONFIG_BUNNY_TYPE=ftp RCLONE_CONFIG_BUNNY_HOST="$BUNNY_STORAGE_HOST" RCLONE_CONFIG_BUNNY_USER="$BUNNY_STORAGE_ZONE" \
         RCLONE_CONFIG_BUNNY_PASS="$(rclone obscure "$BUNNY_STORAGE_KEY")" RCLONE_CONFIG_BUNNY_EXPLICIT_TLS=true
fi
DEST="b2:$B2_BUCKET"

echo "[backup] db"
# Online backup for a consistent copy, then strip live session tokens from the copy before it leaves the box
node -e '
  const D = require("/opt/murmur/node_modules/better-sqlite3");
  const src = new D(process.argv[1], { readonly: true });
  src.backup(process.argv[2]).then(() => {
    const c = new D(process.argv[2]);
    c.exec("DELETE FROM sessions;"); try { c.exec("DELETE FROM action_ips;"); } catch (e) {} c.exec("VACUUM;");
    c.close(); process.exit(0);
  }).catch((e) => { console.error(e); process.exit(1); });
' "$DATA_DIR/app.db" "$TMP/app-$TS.db"
gzip -9 "$TMP/app-$TS.db"
rclone copyto "$TMP/app-$TS.db.gz" "$DEST/db/app-$TS.db.gz" -q

echo "[backup] config"
if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
  echo "[backup] BACKUP_PASSPHRASE not set in /etc/murmur/backup.env; skipping config backup (it contains secrets)" >&2
else
  # Everything in this tarball is secret material (env with storage keys, the B2 key); encrypt at rest off-box.
  tar czf - -C / etc/murmur/env etc/murmur/backup.env etc/caddy/Caddyfile etc/systemd/system/murmur.service 2>/dev/null \
    | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$TMP/config-$TS.tgz.enc"
  rclone copyto "$TMP/config-$TS.tgz.enc" "$DEST/config/config-$TS.tgz.enc" -q
fi

echo "[backup] media (local)"
if [[ -d "$DATA_DIR/media" ]] && [[ -n "$(ls -A "$DATA_DIR/media" 2>/dev/null)" ]]; then
  rclone copy "$DATA_DIR/media" "$DEST/media" --size-only --transfers 4 -q
fi
if [[ -n "${BUNNY_STORAGE_HOST:-}" ]]; then
  echo "[backup] media (bunny)"
  # Bunny's FTP reports an empty/absent folder as "not found"; nothing to copy in that case
  # (Bunny's FTP rejects leading slashes: use "bunny:media", not "bunny:/media")
  # An empty folder is also reported as missing, so check for at least one file before copying
  if [[ -n "$(rclone lsf "bunny:media" --files-only 2>/dev/null | head -1)" ]]; then
    rclone copy "bunny:media" "$DEST/media" --size-only --transfers 4 --checkers 8 -q
  else
    echo "[backup] no media on bunny, skipping"
  fi
fi

SIZE=$(rclone size "$DEST" --json 2>/dev/null || echo '{}')
printf '{"ok":true,"at":%s,"size":%s}\n' "$(date +%s000)" "$SIZE" > "$STATUS_FILE"; chmod 644 "$STATUS_FILE"
echo "[backup] done: $SIZE"
