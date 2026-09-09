#!/usr/bin/env bash
# Strictly READ-ONLY census of a managed Supabase project. Zero writes.
# Its output is Gate 0 of MIGRATION.md: it tells you how much real data exists
# so you can choose "full migration" vs "stand up fresh and re-invite".
#
# Required env:
#   MANAGED_DB_URL   Postgres URI of the managed project (Settings > Database >
#                    Connection string > URI; use the DIRECT connection on port
#                    5432, not the 6543 pooler).
# Optional env (for the exact GoTrue release string and storage-API byte total):
#   MANAGED_URL          e.g. https://<ref>.supabase.co
#   MANAGED_SERVICE_KEY  the managed project's service_role key
#
# Safety: every DB query runs with default_transaction_read_only = on, so the
# server rejects any accidental write. Nothing is created, updated or deleted.
#
# Usage:
#   MANAGED_DB_URL="postgresql://postgres:PW@db.<ref>.supabase.co:5432/postgres" \
#     ./scripts/preflight-census.sh
set -euo pipefail
cd "$(dirname "$0")/.."
: "${MANAGED_DB_URL:?set MANAGED_DB_URL to the managed Postgres URI (see header)}"

# Hard read-only guarantee for the whole psql session.
export PGOPTIONS="-c default_transaction_read_only=on"

q() { psql "$MANAGED_DB_URL" -v ON_ERROR_STOP=1 -tAqc "$1"; }

exists() { [ "$(q "select to_regclass('$1') is not null")" = "t" ]; }

count_row() {
  # count_row <schema.table> <label>
  local rel="$1" label="$2"
  if exists "$rel"; then
    printf '  %-26s %s\n' "$label" "$(q "select count(*) from $rel")"
  else
    printf '  %-26s %s\n' "$label" "absent"
  fi
}

echo "=================================================================="
echo " CareCircle managed-project census (READ ONLY)"
echo " target: ${MANAGED_URL:-<db-only>}"
echo " time:   $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "=================================================================="

echo
echo "Auth accounts"
count_row "auth.users"      "auth.users"
count_row "auth.identities" "auth.identities"

echo
echo "App tables (public)"
for t in care_circle care_circle_invites medications medication_logs \
         appointments care_tasks vault_files family_messages \
         care_circle_alerts user_mfa phi_access_log; do
  count_row "public.$t" "$t"
done

echo
echo "Vault documents"
if exists "public.vault_files"; then
  printf '  %-26s %s\n' "vault_files rows"  "$(q "select count(*) from public.vault_files")"
  printf '  %-26s %s\n' "vault_files bytes" "$(q "select coalesce(sum(size_bytes),0) from public.vault_files")"
fi
if exists "storage.objects"; then
  printf '  %-26s %s\n' "bucket objects" \
    "$(q "select count(*) from storage.objects where bucket_id='care-circle-vault'")"
  printf '  %-26s %s\n' "bucket bytes" \
    "$(q "select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects where bucket_id='care-circle-vault'")"
fi

echo
echo "GoTrue version (drives the self-host image pin: self-host >= managed)"
if [ -n "${MANAGED_URL:-}" ]; then
  hdr=(); [ -n "${MANAGED_SERVICE_KEY:-}" ] && hdr=(-H "apikey: ${MANAGED_SERVICE_KEY}")
  ver="$(curl -fsS -m 15 "${hdr[@]}" "${MANAGED_URL%/}/auth/v1/health" 2>/dev/null \
        | grep -oE '"version":"[^"]+"' | head -1 | sed 's/.*:"//; s/"//')"
  printf '  %-26s %s\n' "gotrue release" "${ver:-unknown (health endpoint gave no version)}"
else
  printf '  %-26s %s\n' "gotrue schema (hint)" \
    "$(exists auth.schema_migrations && q "select max(version) from auth.schema_migrations" || echo 'n/a')"
  echo "  (set MANAGED_URL + MANAGED_SERVICE_KEY for the exact release string)"
fi

echo
echo "=================================================================="
echo " Decision (Gate 0):"
echo "   - Little/only-test data  -> stand up fresh + re-invite (simplest)."
echo "   - Real accounts + vault  -> full migration per MIGRATION.md."
echo " No changes were made to the managed project."
echo "=================================================================="
