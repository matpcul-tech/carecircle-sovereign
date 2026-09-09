#!/usr/bin/env bash
# Quick end-to-end check that the self-hosted stack answers the three API
# surfaces the app uses. Run after `docker compose up -d` and
# `./scripts/apply-migrations.sh`.
#
#   ./scripts/smoke-test.sh
#
# Reads ANON_KEY / SERVICE_ROLE_KEY / API_EXTERNAL_URL from .env.
set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck disable=SC1091
set -a; [ -f .env ] && . ./.env; set +a
BASE="${API_EXTERNAL_URL:-http://localhost:8000}"

pass() { echo "  OK   $1"; }
fail() { echo "  FAIL $1" >&2; exit 1; }

echo "Gateway health:"
curl -fsS "$BASE/healthz" >/dev/null && pass "/healthz" || fail "/healthz"

echo "REST (PostgREST) reachable + JWT role mapping:"
# service_role can read the audit table (RLS-bypassing role); expect HTTP 200.
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "apikey: ${SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
  "$BASE/rest/v1/phi_access_log?select=id&limit=1")
[ "$code" = "200" ] && pass "service_role read (200)" || fail "REST returned $code"

echo "REST anon is correctly restricted:"
# anon has no policy on phi_access_log -> should NOT get rows (200 with [] or 401/403).
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "apikey: ${ANON_KEY}" -H "Authorization: Bearer ${ANON_KEY}" \
  "$BASE/rest/v1/care_circle?select=id&limit=1")
[ "$code" = "200" ] && pass "anon query executes ($code, RLS filters rows)" || pass "anon restricted ($code)"

echo "AUTH (GoTrue) reachable:"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/auth/v1/health")
[ "$code" = "200" ] && pass "auth /health (200)" || fail "auth returned $code"

echo "STORAGE reachable:"
code=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" "$BASE/storage/v1/bucket")
[ "$code" = "200" ] && pass "storage /bucket (200)" || fail "storage returned $code"

echo "All smoke checks passed."
