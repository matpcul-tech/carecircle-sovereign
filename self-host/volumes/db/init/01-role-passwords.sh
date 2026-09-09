#!/usr/bin/env bash
# Runs once at first DB init. The Supabase Postgres image creates the service
# roles (authenticator, supabase_auth_admin, supabase_storage_admin,
# supabase_admin) but the sidecar services connect over TCP with a password,
# so set each existing role's password to POSTGRES_PASSWORD. Guarded so a
# missing role (image-version drift) is skipped, not fatal.
set -euo pipefail

for role in authenticator supabase_auth_admin supabase_storage_admin supabase_admin; do
  psql -v ON_ERROR_STOP=1 --username postgres --dbname "${POSTGRES_DB:-postgres}" -c \
    "DO \$\$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
         EXECUTE format('ALTER ROLE %I WITH LOGIN PASSWORD %L', '${role}', '${POSTGRES_PASSWORD}');
       END IF;
     END \$\$;"
done
