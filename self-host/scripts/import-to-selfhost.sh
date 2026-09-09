#!/usr/bin/env bash
# Load the managed-project dump (from export-from-managed.sh) into the running
# self-hosted database. Run from self-host/ with the stack up and app
# migrations already applied (./scripts/apply-migrations.sh).
#
#   ./scripts/import-to-selfhost.sh
#
# Triggers and FK checks are disabled for the load (session_replication_role =
# replica) so the audit triggers don't fire on imported rows and load order
# doesn't matter. Superuser (postgres) is required and used.
#
# ⚠️ Idempotency: this appends rows. Run it ONCE against a fresh target, or
# TRUNCATE the target tables first. Read MIGRATION.md.
set -euo pipefail
cd "$(dirname "$0")/.."
DB_NAME="${POSTGRES_DB:-postgres}"
DC="docker compose"

load() {
  [ -f "$1" ] || { echo "missing $1 - run export-from-managed.sh first" >&2; exit 1; }
  echo "Loading $1 ..."
  { echo "SET session_replication_role = replica;"; cat "$1"; } \
    | $DC exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME"
}

load dump/01-auth-data.sql
load dump/02-public-data.sql
load dump/03-storage-objects.sql

echo "Row counts on the self-hosted DB:"
$DC exec -T db psql -U postgres -d "$DB_NAME" -c \
  "select 'auth.users' t, count(*) from auth.users
   union all select 'care_circle', count(*) from public.care_circle
   union all select 'vault_files', count(*) from public.vault_files;"

echo "Data import complete. Next: copy the storage blobs with migrate-storage.mjs."
