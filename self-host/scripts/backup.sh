#!/usr/bin/env bash
# Nightly backup of the SELF-HOSTED stack: a full logical dump of the database
# plus the vault storage files, bundled and ENCRYPTED before anything leaves
# the host, then handed to your offsite upload command. Destination-agnostic:
# you supply the encryption recipient and the upload command via env.
#
# Run from self-host/ with the stack up:
#   ./scripts/backup.sh
#
# Required env:
#   BACKUP_ENCRYPTION   "age" or "gpg"
#     age:  AGE_RECIPIENT   an age public key (age1...)
#     gpg:  GPG_RECIPIENT   a gpg key id / email in your keyring
#
# Optional env:
#   BACKUP_DIR          local dir for artifacts (default ./backups)
#   BACKUP_UPLOAD_CMD   offsite upload; receives the artifact path as "$1",
#                       e.g. 'rclone copy "$1" remote:carecircle/'  or
#                            'aws s3 cp "$1" s3://bucket/carecircle/'
#   BACKUP_KEEP_DAYS    prune local artifacts older than N days (default 14)
#   HEALTHCHECK_URL     healthchecks.io-style URL; pinged /start, success, /fail
#   POSTGRES_DB         database name (default from .env, else "postgres")
#   DC                  compose invocation (default "docker compose")
set -euo pipefail
cd "$(dirname "$0")/.."

# Pull POSTGRES_DB (and nothing sensitive is echoed) from .env if present.
set -a; [ -f .env ] && . ./.env; set +a
DB_NAME="${POSTGRES_DB:-postgres}"
DC="${DC:-docker compose}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
: "${BACKUP_ENCRYPTION:?set BACKUP_ENCRYPTION to age or gpg}"

ping() { [ -n "${HEALTHCHECK_URL:-}" ] && curl -fsS -m 15 "${HEALTHCHECK_URL%/}$1" >/dev/null 2>&1 || true; }
fail() { ping "/fail"; }
trap fail ERR

ping "/start"

stamp="$(date -u '+%Y%m%d-%H%M%S')"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$BACKUP_DIR"

echo "[1/5] pg_dump (custom format, all schemas) ..."
$DC exec -T db pg_dump -U postgres -Fc "$DB_NAME" > "$work/db.dump"

echo "[2/5] vault storage files ..."
$DC exec -T storage tar czf - -C /var/lib/storage . > "$work/storage.tgz"

echo "[3/5] bundle ..."
tar czf "$work/bundle.tgz" -C "$work" db.dump storage.tgz

echo "[4/5] encrypt ($BACKUP_ENCRYPTION), on-host, before upload ..."
case "$BACKUP_ENCRYPTION" in
  age)
    : "${AGE_RECIPIENT:?set AGE_RECIPIENT (age public key)}"
    artifact="$BACKUP_DIR/carecircle-$stamp.tgz.age"
    age -r "$AGE_RECIPIENT" -o "$artifact" "$work/bundle.tgz"
    ;;
  gpg)
    : "${GPG_RECIPIENT:?set GPG_RECIPIENT (gpg key id/email)}"
    artifact="$BACKUP_DIR/carecircle-$stamp.tgz.gpg"
    gpg --batch --yes --encrypt --recipient "$GPG_RECIPIENT" --output "$artifact" "$work/bundle.tgz"
    ;;
  *) echo "unknown BACKUP_ENCRYPTION: $BACKUP_ENCRYPTION" >&2; exit 1 ;;
esac
echo "      wrote $artifact ($(du -h "$artifact" | cut -f1))"

echo "[5/5] offsite upload + prune ..."
if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  bash -c "$BACKUP_UPLOAD_CMD" _ "$artifact"
  echo "      uploaded via BACKUP_UPLOAD_CMD"
else
  echo "      BACKUP_UPLOAD_CMD not set; artifact stays local at $artifact"
fi
find "$BACKUP_DIR" -type f -name 'carecircle-*.tgz.*' -mtime "+$KEEP_DAYS" -delete 2>/dev/null || true

ping ""   # success ping
echo "Backup complete: $artifact"
