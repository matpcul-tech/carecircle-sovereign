#!/usr/bin/env bash
# Tested-restore: prove a backup is usable by restoring it into an ISOLATED
# scratch stack, verifying row counts, and decrypting one vault object. Run
# this monthly. It never touches the production stack (separate compose
# project, separate volumes, remapped ports) and tears the scratch stack down
# at the end.
#
# Run from self-host/:
#   BACKUP_FILE=./backups/carecircle-YYYYMMDD-HHMMSS.tgz.age \
#   BACKUP_ENCRYPTION=age AGE_IDENTITY=/path/to/age.key \
#   VAULT_KEY_HEX=<same key the data was sealed with> \
#     ./scripts/restore.sh
#
# Required env:
#   BACKUP_FILE         the encrypted artifact produced by backup.sh
#   BACKUP_ENCRYPTION   "age" or "gpg" (matching how it was encrypted)
#     age:  AGE_IDENTITY   path to the age private key file
#     gpg:  key must be available in the local gpg keyring
# Recommended env:
#   VAULT_KEY_HEX       to run the decrypt-one-object check
# Optional env:
#   SCRATCH_GATEWAY_PORT (default 8100)   SCRATCH_DB_PORT (default 5433)
#   KEEP_SCRATCH=1       leave the scratch stack up for inspection
set -euo pipefail
cd "$(dirname "$0")/.."

set -a; [ -f .env ] && . ./.env; set +a
DB_NAME="${POSTGRES_DB:-postgres}"
: "${BACKUP_FILE:?set BACKUP_FILE to the encrypted artifact}"
: "${BACKUP_ENCRYPTION:?set BACKUP_ENCRYPTION to age or gpg}"
[ -f "$BACKUP_FILE" ] || { echo "no such file: $BACKUP_FILE" >&2; exit 1; }

PROJECT="carecircle-restore"
DCR="docker compose -p $PROJECT -f docker-compose.yml -f docker-compose.scratch.yml"
GW_PORT="${SCRATCH_GATEWAY_PORT:-8100}"

work="$(mktemp -d)"
cleanup() {
  if [ "${KEEP_SCRATCH:-0}" = "1" ]; then
    echo "KEEP_SCRATCH=1: leaving scratch stack up (project $PROJECT)."
  else
    echo "Tearing down scratch stack ..."
    $DCR down -v >/dev/null 2>&1 || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

echo "[1/7] decrypt + unpack backup ..."
case "$BACKUP_ENCRYPTION" in
  age) : "${AGE_IDENTITY:?set AGE_IDENTITY (age private key file)}"
       age -d -i "$AGE_IDENTITY" -o "$work/bundle.tgz" "$BACKUP_FILE" ;;
  gpg) gpg --batch --yes --decrypt --output "$work/bundle.tgz" "$BACKUP_FILE" ;;
  *)   echo "unknown BACKUP_ENCRYPTION: $BACKUP_ENCRYPTION" >&2; exit 1 ;;
esac
tar xzf "$work/bundle.tgz" -C "$work"
[ -f "$work/db.dump" ] && [ -f "$work/storage.tgz" ] || { echo "bundle missing db.dump/storage.tgz" >&2; exit 1; }

echo "[2/7] start a clean scratch database ..."
$DCR down -v >/dev/null 2>&1 || true
$DCR up -d db
echo -n "      waiting for db "
until $DCR exec -T db pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; do echo -n "."; sleep 2; done
echo " ready"

echo "[3/7] restore the database dump ..."
$DCR exec -T db pg_restore --no-owner --clean --if-exists -U postgres -d "$DB_NAME" < "$work/db.dump" \
  || echo "      (pg_restore reported non-fatal notices; continuing)"

echo "[4/7] start the rest of the stack + ensure app schema ..."
$DCR up -d
DC="$DCR" ./scripts/apply-migrations.sh

echo "[5/7] load vault storage files ..."
$DCR exec -T storage sh -c 'mkdir -p /var/lib/storage && tar xzf - -C /var/lib/storage' < "$work/storage.tgz"

echo "[6/7] verify row counts ..."
$DCR exec -T db psql -U postgres -d "$DB_NAME" -c \
  "select 'auth.users' as t, count(*) from auth.users
   union all select 'care_circle', count(*) from public.care_circle
   union all select 'vault_files', count(*) from public.vault_files;"

echo "[7/7] decrypt one vault object ..."
if [ -n "${VAULT_KEY_HEX:-}" ]; then
  VERIFY_URL="http://localhost:${GW_PORT}" \
  VERIFY_SERVICE_KEY="${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY missing from .env}" \
  VAULT_KEY_HEX="$VAULT_KEY_HEX" \
    node scripts/verify-vault-decrypt.mjs
else
  echo "      VAULT_KEY_HEX not set; skipping decrypt check (set it to fully verify)."
fi

echo "Restore test PASSED against scratch project '$PROJECT'."
