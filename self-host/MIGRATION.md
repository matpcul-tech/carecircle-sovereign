# Cutover: managed Supabase to self-hosted (get off their logs)

> Empty managed project (no real users or data)? Use FRESH-START.md instead and skip this file.
> Populated managed project (real accounts or vault files)? Continue here.

This moves CareCircle from the managed Supabase cloud onto your own stack:
same Supabase software, your host, your logs. When it is done and verified, you
pause and then delete the managed project.

The operator drives this manually and irreversibly at the end. Read it fully,
rehearse it with [DRY-RUN.md](./DRY-RUN.md), and clear both gates below before
touching production.

## Gates (do not skip)

Cutover does not proceed until BOTH gates pass.

### Gate 0: census and the migrate-vs-fresh decision

Run the read-only census against the managed project:
```bash
cd self-host
MANAGED_DB_URL=... MANAGED_URL=... MANAGED_SERVICE_KEY=... \
  ./scripts/preflight-census.sh
```
It writes nothing. Use the counts to choose:
- Little or only-test data: stand up a fresh stack and re-invite users. Skip
  the data export entirely; this is the simplest and safest path.
- Real accounts plus vault documents: do the full migration below.

Also record the managed GoTrue version it reports and confirm
`docker-compose.yml` pins a GoTrue image that is the same major version or
newer (see make-or-break rule 3).

### Gate 0.5: backups configured and one restore tested

On the self-hosted stack, before you put real data on it:
- Configure nightly encrypted backups per [OPERATIONS.md](./OPERATIONS.md)
  (`scripts/backup.sh`).
- Run ONE `scripts/restore.sh` and confirm it passes, including the
  decrypt-one-object check. A backup you have never restored does not count.

You are migrating irreplaceable PHI onto this stack. If it cannot be restored,
do not put data on it yet.

## The three make-or-break rules

1. **`VAULT_KEY_HEX` must be byte-for-byte identical to the managed
   deployment.** Vault documents AND MFA secrets are AES-256-GCM-encrypted with
   it. Copy it from the current app's env (for example Vercel, Project,
   Settings, Environment Variables). Lose it and every vault file and MFA secret
   becomes undecryptable, with no recovery.

2. **`JWT_SECRET` and the anon/service keys are a matched set.** The
   self-hosted `ANON_KEY` and `SERVICE_ROLE_KEY` must be JWTs signed with the
   self-hosted `JWT_SECRET` (that is what `generate-keys.mjs` produces). Do NOT
   paste the managed project's anon/service keys into the self-hosted stack
   unless you also reuse its `JWT_SECRET`. Changing `JWT_SECRET` only means
   existing login sessions end and users sign in again; passwords are unaffected
   (see rule 3).

3. **Match the auth version.** Users' passwords migrate because GoTrue stores
   bcrypt hashes in `auth.users` and the data is copied verbatim. For the load
   to succeed, the self-hosted GoTrue image must be the same major version or
   newer than the managed project's. Check the managed version with
   `preflight-census.sh` and bump the `auth` image pin in `docker-compose.yml`
   if needed.

## Prerequisites

- Both gates above cleared.
- The self-hosted stack running on your host (`docker compose up -d`) with app
  migrations applied (`./scripts/apply-migrations.sh`) and `smoke-test.sh`
  green. See [README.md](./README.md).
- The managed project's DIRECT DB URI (Settings, Database, Connection string,
  URI, port 5432, not the 6543 pooler).
- The managed project's service_role key (Settings, API).
- `pg_dump` and `psql` clients v15, Node 18+.
- The current `VAULT_KEY_HEX`.

## Cutover steps

### 1. Freeze writes (recommended)
Put the app in maintenance or stop accepting writes for the cutover window so no
new data lands in the managed project after you dump it.

### 2. Export from the managed project (read-only)
```bash
cd self-host
export MANAGED_DB_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres"
./scripts/export-from-managed.sh          # writes dump/*.sql (PHI, keep safe)
```

### 3. Import the data into your stack
```bash
./scripts/import-to-selfhost.sh           # loads auth + public + storage rows
```

### 4. Copy the encrypted vault blobs
```bash
MANAGED_URL="https://<ref>.supabase.co" \
MANAGED_SERVICE_KEY="<managed service_role key>" \
SELFHOST_URL="https://api.yourdomain" \
SELFHOST_SERVICE_KEY="<self-hosted SERVICE_ROLE_KEY>" \
  node scripts/migrate-storage.mjs
```

### 5. Point the app at your stack
Update the app's env (Vercel, or wherever it runs) and redeploy:
```
NEXT_PUBLIC_SUPABASE_URL=https://api.yourdomain          # your gateway (TLS)
NEXT_PUBLIC_SUPABASE_ANON_KEY=<self-hosted ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<self-hosted SERVICE_ROLE_KEY>
VAULT_KEY_HEX=<unchanged, same as managed>
```
`NEXT_PUBLIC_*` are compiled into the client bundle, so a redeploy or rebuild is
required for the URL/key change to take effect. (Or run the app in the same
stack via `docker-compose.app.yml`; see the README.)

### 6. Verify before you cut traffic over
- `./scripts/smoke-test.sh` green against the self-hosted gateway.
- Log in as a real migrated user (password should work).
- Open the Vault and download a file (proves blobs plus `VAULT_KEY_HEX` plus
  storage all line up).
- If a user had MFA, confirm the TOTP prompt still accepts their code.
- Spot-check row counts: `auth.users`, `care_circle`, `vault_files` match the
  census numbers.

### 7. Decommission the managed project
Once you are satisfied and traffic is on your stack, pause the managed Supabase
project (reversible) for a cool-off period, then delete it. That is the point
PHI stops flowing through their infrastructure and logs.

### 8. Clean up
Delete the `dump/` files (they contain PHI) or move them to encrypted cold
storage.

## Rollback

Until step 7, rollback is just repointing the app's `NEXT_PUBLIC_SUPABASE_URL`
back to the managed project and redeploying. The managed data is untouched by
this process (all reads). Keep the managed project paused, not deleted, until
you have run on the self-hosted stack long enough to trust it.

## Notes

- `phi_access_log` and `rate_limits` are intentionally NOT exported; they start
  fresh on the new stack (audit history restarts).
- `user_mfa` is also not exported by default, so MFA users re-enroll. To keep
  existing MFA enrollments, add `-t public.user_mfa` to `export-from-managed.sh`
  and they carry over (secrets stay valid because `VAULT_KEY_HEX` is unchanged).
- The import disables triggers during load, so backfilled rows do not spam the
  audit log. After import, triggers are active again automatically for new
  writes.
