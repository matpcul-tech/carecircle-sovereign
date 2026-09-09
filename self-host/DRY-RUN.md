# Dry run: rehearse the cutover before you touch production

This is the mandatory rehearsal before any real cutover. You stand up a
throwaway STAGING copy of the self-hosted stack, run every step of
`MIGRATION.md` against it end to end, verify the result, then tear it down.
Nothing here writes to the managed project: the only managed access is the
read-only export and the read-only storage copy, exactly as in the real
cutover. Production is never involved.

Why bother: the dry run is where you find the version mismatch, the missing
`VAULT_KEY_HEX`, the wrong connection string, or the storage path surprise,
while the cost of being wrong is a `docker compose down -v`, not a lockout.

## Prerequisites

- A host with Docker where you can run a scratch stack (this can be a laptop or
  a temporary VM; it is destination-agnostic and disposable).
- Read-only access to the managed project: `MANAGED_DB_URL` (direct 5432),
  `MANAGED_URL`, `MANAGED_SERVICE_KEY`.
- The current `VAULT_KEY_HEX` from the live app's environment.
- You have read `MIGRATION.md`.

## Steps

### 1. Census (Gate 0 rehearsal)
```bash
cd self-host
MANAGED_DB_URL=... MANAGED_URL=... MANAGED_SERVICE_KEY=... \
  ./scripts/preflight-census.sh
```
Note the counts and the GoTrue version. Confirm `docker-compose.yml` pins a
GoTrue image that is the same major version or newer.

### 2. Bring up an isolated staging stack
Reuse the scratch overlay under a staging project name and distinct ports:
```bash
cp .env.example .env        # if you do not already have one
node scripts/generate-keys.mjs   # paste the four secrets into .env
# set API_EXTERNAL_URL=http://localhost:8100 and SITE_URL to anything for staging

docker compose -p carecircle-staging \
  -f docker-compose.yml -f docker-compose.scratch.yml up -d

DC="docker compose -p carecircle-staging -f docker-compose.yml -f docker-compose.scratch.yml" \
  ./scripts/apply-migrations.sh
```

### 3. Export from managed (read-only) and import into staging
```bash
MANAGED_DB_URL=... ./scripts/export-from-managed.sh

DC="docker compose -p carecircle-staging -f docker-compose.yml -f docker-compose.scratch.yml" \
  ./scripts/import-to-selfhost.sh
```

### 4. Copy vault blobs into staging (read-only from managed)
```bash
MANAGED_URL=... MANAGED_SERVICE_KEY=... \
SELFHOST_URL=http://localhost:8100 \
SELFHOST_SERVICE_KEY=<staging SERVICE_ROLE_KEY from .env> \
  node scripts/migrate-storage.mjs
```

### 5. Verification checklist
- [ ] Row counts in staging match the census numbers:
  ```bash
  docker compose -p carecircle-staging -f docker-compose.yml -f docker-compose.scratch.yml \
    exec -T db psql -U postgres -d postgres -c \
    "select 'auth.users', count(*) from auth.users
     union all select 'care_circle', count(*) from public.care_circle
     union all select 'vault_files', count(*) from public.vault_files;"
  ```
- [ ] One vault object decrypts with the real key:
  ```bash
  VERIFY_URL=http://localhost:8100 \
  VERIFY_SERVICE_KEY=<staging SERVICE_ROLE_KEY> \
  VAULT_KEY_HEX=<the real key> \
    node scripts/verify-vault-decrypt.mjs
  ```
- [ ] A known test user can log in against the staging gateway (password
  carried over from managed).
- [ ] If a user had MFA, the staging login shows the second-factor prompt.
- [ ] `./scripts/smoke-test.sh` is green (point `API_EXTERNAL_URL` at
  `http://localhost:8100` in `.env` or export it for the run).

If any box fails, fix the cause and repeat. Do not proceed to a real cutover
until every box passes.

### 6. Teardown
```bash
docker compose -p carecircle-staging -f docker-compose.yml -f docker-compose.scratch.yml down -v
rm -rf dump               # the export contains PHI
```

## After a clean dry run

You now know the cutover works with your data, your key, and your version pins.
Proceed to `MIGRATION.md`, whose Gate 0 (census) and Gate 0.5 (backups plus one
tested restore) must both be satisfied before the real cutover.
