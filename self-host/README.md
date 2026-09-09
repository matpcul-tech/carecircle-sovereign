# Self-hosted Supabase for CareCircle

Run the data layer yourself instead of on Supabase's managed cloud. This
stack is the **same Supabase software** the platform runs - Postgres, GoTrue
(auth), PostgREST (`/rest`), Storage - behind an nginx gateway that exposes
the identical API surface (`/auth/v1`, `/rest/v1`, `/storage/v1`). Your
existing `supabase/migrations` and RLS policies run **unchanged**; the app
only needs `NEXT_PUBLIC_SUPABASE_URL` pointed here.

> ⚠️ **This gets you a working, correct stack - not an automatically
> HIPAA-compliant one.** Self-hosting *moves* the safeguards onto you: TLS,
> disk encryption, backups, patching, and key management are now your job.
> Work through the **Hardening** checklist below before any real PHI, and get
> a BAA with whoever hosts the servers (AWS/GCP/colo).

> **Already live on managed Supabase and want to cut over?** After this stack
> is up and migrated, follow **[MIGRATION.md](./MIGRATION.md)** to move your
> existing accounts, data, and encrypted vault files off the managed project
> and onto your own - then decommission the managed project.

## Architecture

```
                         ┌───────────────────────── nginx gateway (:8000) ─────────────────────────┐
  CareCircle app ───────▶│  /auth/v1/*  →  gotrue:9999      (strip /auth/v1)                        │
  (browser + Next API)   │  /rest/v1/*  →  postgrest:3000   (strip /rest/v1)                        │
                         │  /storage/v1/* → storage:5000    (strip /storage/v1)                     │
                         └───────────────┬───────────────────────┬───────────────────────┬─────────┘
                                         ▼                       ▼                       ▼
                                     gotrue                  postgrest                storage-api
                                         └───────────────┬───────┴───────────────┬───────┘
                                                         ▼                       ▼
                                                    Postgres (auth.*, public.*, storage.*)
```

Auth is enforced by the **JWT**, exactly as on hosted Supabase: PostgREST maps
the token's `role` claim (`anon` / `authenticated` / `service_role`) to a
Postgres role and applies your RLS; GoTrue checks admin JWTs. The gateway does
path routing + CORS only.

## Prerequisites

- Docker + Docker Compose v2 (`docker compose`, not `docker-compose`)
- Node 18+ (only to generate keys)
- ~2 GB RAM for the containers

## Bring-up

All commands run from this `self-host/` directory.

```bash
# 1. Generate secrets and start an .env from the template.
cp .env.example .env
node scripts/generate-keys.mjs        # prints POSTGRES_PASSWORD, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY
#   → paste those four values into .env, and set API_EXTERNAL_URL / SITE_URL.

# 2. Start the stack.
docker compose up -d

# 3. Apply the CareCircle app migrations (waits for auth.* and storage.* first).
./scripts/apply-migrations.sh

# 4. Smoke-test the three API surfaces.
./scripts/smoke-test.sh
```

Optional admin dashboard (Supabase Studio) on http://localhost:3001:

```bash
docker compose --profile studio up -d
```

## Point the app at your stack

In the CareCircle app's `.env.local` (see the repo-root `.env.example`), set:

```
NEXT_PUBLIC_SUPABASE_URL=https://api.yourdomain.example   # this gateway, behind TLS
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
VAULT_KEY_HEX=<64 hex chars>        # unchanged - the app's document/MFA encryption key
```

`generate-keys.mjs` also prints a fresh `VAULT_KEY_HEX` you can use if you
don't already have one. **Keep the same `VAULT_KEY_HEX` across deploys** - it
decrypts existing vault files and MFA secrets.

Nothing else in the app changes: every route already talks to Supabase over
`SUPABASE_URL` with the anon/service keys.

## Run the CareCircle app in the same stack (one host, one BAA)

To host the app container *next to* the database - same machine, same Docker
network, one infrastructure BAA - use the app overlay. The image is built from
the repo root (`../Dockerfile`, standalone Next.js output).

```bash
# 1. App runtime secrets (VAULT_KEY_HEX, AI/email/SMS provider keys, signing key).
cp app.env.example app.env      # then fill it in

# 2. Build + start everything together.
docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --build

# 3. First time only, apply migrations (same as before).
./scripts/apply-migrations.sh
```

The app is now on `:3000`, Supabase on `:8000`, sharing one network.
`SUPABASE_SERVICE_ROLE_KEY` and the `NEXT_PUBLIC_*` values are injected from
the stack's `.env`; the rest come from `app.env`.

### ⚠️ The `NEXT_PUBLIC_SUPABASE_URL` reachability rule

`NEXT_PUBLIC_SUPABASE_URL` is **baked into the browser bundle at build time**
and is *also* used by the app's server routes. It must therefore be **one URL
reachable by both the browser and the app container** - your **public gateway
URL** (`API_EXTERNAL_URL`), not an internal Docker name and not `localhost`:

- **Production (correct):** put TLS in front and route two hostnames to the
  two services - `app.yourdomain → app:3000`, `api.yourdomain → gateway:8000`.
  Set `API_EXTERNAL_URL=https://api.yourdomain`. The browser and the app
  container both resolve it; done.
- **`localhost` will NOT work** for the container: inside the app container
  `http://localhost:8000` is the container's own localhost, not the gateway.
  For a quick local trial without a domain, set `API_EXTERNAL_URL` to the
  host's LAN IP (e.g. `http://192.168.1.10:8000`) so both sides can reach it.

Because that URL is compiled in, **rebuild the app image when it changes**
(`--build`). Server-only secrets are runtime env, so those you can change with
just a restart.

## What this includes (and doesn't)

Included, because the app uses them: **Postgres, GoTrue, PostgREST, Storage**,
plus an optional Studio. Deliberately **not** included: Realtime, Edge
Functions, and the analytics/logflare stack - the app uses none of them. Add
them from the upstream Supabase compose if you need them later.

The gateway does **not** enforce the hosted platform's `apikey` gate or
per-key rate limits (auth still holds via JWT). If you want that,
drop in Supabase's Kong config in place of nginx - the routes are identical.

## Hardening checklist (do before real PHI)

- [ ] **TLS everywhere.** Put Caddy/nginx/an ALB with a real certificate in
      front of `:8000`; set `API_EXTERNAL_URL`/`SITE_URL` to `https://`. Never
      send PHI or tokens over plaintext http.
- [ ] **Encrypt data at rest.** Host the `db-data` and `storage-data` volumes
      on an encrypted disk (LUKS, or a cloud encrypted EBS/PD). Postgres +
      file storage hold PHI in the clear at rest otherwise.
- [ ] **Lock down the network.** The compose binds Postgres to `127.0.0.1`
      only - keep it off the public internet. Expose *only* the TLS gateway.
      Put the containers on a private network/VPC.
- [ ] **Secret management.** Don't leave `.env` on disk in prod - inject
      `JWT_SECRET`, `POSTGRES_PASSWORD`, `SERVICE_ROLE_KEY` from a secrets
      manager. Rotate `JWT_SECRET` deliberately (it invalidates all tokens and
      the anon/service keys - regenerate them together).
- [ ] **Backups + tested restore.** Automate `pg_dump`/`pg_basebackup` and
      back up the storage volume; encrypt the backups; test a restore. See
      below.
- [ ] **Audit + retention.** You already have `phi_access_log`; ship Postgres
      logs somewhere immutable and set a retention policy.
- [ ] **Patch cadence.** Pin versions (done here) and update the images on a
      schedule; watch Supabase/Postgres CVEs.
- [ ] **BAA with the infra host.** Self-hosting doesn't remove this - you need
      a signed BAA covering the machines the containers run on.

## Backups

```bash
# Database (schema + data), gzipped:
docker compose exec -T db pg_dump -U postgres -Fc postgres > backup-$(date +%F).dump

# Storage objects (encrypted vault blobs live here):
docker run --rm -v carecircle-supabase_storage-data:/data -v "$PWD":/out alpine \
  tar czf /out/storage-$(date +%F).tgz -C /data .

# Restore the database into a fresh stack:
docker compose exec -T db pg_restore -U postgres -d postgres --clean --if-exists < backup-YYYY-MM-DD.dump
```

Encrypt the resulting files (they contain PHI) and store them off-host.

## Operations

```bash
docker compose ps                 # status
docker compose logs -f auth rest  # tail service logs
docker compose down               # stop (keeps volumes/data)
docker compose down -v            # stop AND DELETE all data - destructive
```

Re-running `./scripts/apply-migrations.sh` is safe: the migrations are written
`if not exists` / `create or replace` and the one-time data steps are guarded.

## Troubleshooting

- **`apply-migrations.sh` hangs on "Waiting for auth.users"** - GoTrue hasn't
  finished its first-run migration. `docker compose logs auth`; a common cause
  is the `supabase_auth_admin` password not matching (re-check `.env`, then
  `docker compose down -v` and start clean so initdb re-runs).
- **App calls 401 from `/rest/v1`** - the app's `SUPABASE_SERVICE_ROLE_KEY` /
  anon key must be the ones signed with THIS stack's `JWT_SECRET`. Regenerate
  from the same secret with `scripts/generate-keys.mjs`.
- **CORS errors in the browser** - set the gateway's allowed origin to your
  app URL (edit `$cors_origin` in `volumes/gateway/nginx.conf`) and ensure
  `SITE_URL` matches.
- **`auth.uid()` errors / RLS denies everything** - confirm
  `02-auth-helpers.sql` ran (it only runs on a fresh volume); on an existing
  volume, apply it manually:
  `docker compose exec -T db psql -U postgres -d postgres < volumes/db/init/02-auth-helpers.sql`.

## Version pins

| Service | Image |
|---|---|
| Postgres | `supabase/postgres:15.1.1.78` |
| GoTrue | `supabase/gotrue:v2.151.0` |
| PostgREST | `postgrest/postgrest:v12.2.0` |
| Storage | `supabase/storage-api:v1.11.13` |
| Gateway | `nginx:1.27-alpine` |

These are a known-good baseline; verify against the current Supabase
self-hosting release before bumping, and re-run the smoke test after any
change.
