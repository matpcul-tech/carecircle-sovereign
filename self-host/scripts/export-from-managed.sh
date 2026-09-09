#!/usr/bin/env bash
# Export DATA from a MANAGED Supabase project so it can be loaded into the
# self-hosted stack. Run this from a machine that can reach the managed DB.
#
#   MANAGED_DB_URL="postgresql://postgres:PW@db.<ref>.supabase.co:5432/postgres" \
#     ./scripts/export-from-managed.sh
#
# Get MANAGED_DB_URL from Supabase → Settings → Database → Connection string
# (URI). Use the DIRECT connection (port 5432), not the pooler (6543), for
# pg_dump. Requires a pg_dump client whose major version matches the server
# (Supabase is Postgres 15).
#
# ⚠️ Test this against a staging clone first, and read MIGRATION.md.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${MANAGED_DB_URL:?set MANAGED_DB_URL to the managed Postgres URI (see header)}"
mkdir -p dump

common=(--data-only --no-owner --no-privileges --no-comments)

echo "1/3  auth accounts (users keep their bcrypt hashes → passwords still work)"
pg_dump "$MANAGED_DB_URL" "${common[@]}" \
  -t 'auth.users' -t 'auth.identities' \
  --file dump/01-auth-data.sql

echo "2/3  app data (public schema; new tables are fresh on the target and skipped)"
pg_dump "$MANAGED_DB_URL" "${common[@]}" \
  -t 'public.care_circle' \
  -t 'public.care_circle_invites' \
  -t 'public.medications' \
  -t 'public.medication_logs' \
  -t 'public.appointments' \
  -t 'public.care_tasks' \
  -t 'public.vault_files' \
  -t 'public.family_messages' \
  -t 'public.care_circle_alerts' \
  --file dump/02-public-data.sql

echo "3/3  storage object metadata (the encrypted blobs are copied by migrate-storage.mjs)"
pg_dump "$MANAGED_DB_URL" "${common[@]}" \
  -t 'storage.objects' \
  --file dump/03-storage-objects.sql

echo "Done. Wrote dump/01-auth-data.sql, dump/02-public-data.sql, dump/03-storage-objects.sql"
echo "These files contain PHI - keep them encrypted and delete after import."
