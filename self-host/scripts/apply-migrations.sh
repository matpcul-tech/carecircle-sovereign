#!/usr/bin/env bash
# Apply the CareCircle app migrations to the self-hosted database, in order,
# after GoTrue and Storage have created their own schemas (auth.*, storage.*),
# which the app migrations depend on (FKs to auth.users, the vault bucket row).
#
# Run from the self-host/ directory with the stack already up:
#   docker compose up -d
#   ./scripts/apply-migrations.sh
set -euo pipefail

cd "$(dirname "$0")/.."                 # -> self-host/
MIG_DIR="../supabase/migrations"
DB_NAME="${POSTGRES_DB:-postgres}"
# DC lets a caller (e.g. restore.sh) target a different compose project, such
# as an isolated scratch stack. Defaults to the production stack.
DC="${DC:-docker compose}"

psql() { $DC exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" "$@"; }

echo "Waiting for GoTrue to create auth.users ..."
until [ "$(psql -tAc "select to_regclass('auth.users') is not null" | tr -d '[:space:]')" = "t" ]; do
  sleep 2
done

echo "Waiting for Storage to create storage.buckets ..."
until [ "$(psql -tAc "select to_regclass('storage.buckets') is not null" | tr -d '[:space:]')" = "t" ]; do
  sleep 2
done

echo "Applying app migrations from ${MIG_DIR} ..."
for f in $(ls "$MIG_DIR"/*.sql | sort); do
  echo "  == $(basename "$f")"
  psql < "$f"
done

echo "Verifying the vault storage bucket exists ..."
bucket="$(psql -tAc "select id from storage.buckets where id = 'care-circle-vault'" | tr -d '[:space:]')"
if [ "$bucket" = "care-circle-vault" ]; then
  echo "OK: care-circle-vault bucket present."
else
  echo "WARNING: care-circle-vault bucket missing - check migration 20260505000001." >&2
  exit 1
fi

echo "Migrations applied successfully."
