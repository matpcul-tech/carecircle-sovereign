# Fresh start: self-hosted CareCircle with no data to migrate

Use this when the managed project has no real users or data. You skip the
whole migration path and stand the stack up clean. This page is self-contained;
run it top to bottom.

## 1. Stack bring-up

All commands run from `self-host/`.

```bash
cp .env.example .env
node scripts/generate-keys.mjs
```

`generate-keys.mjs` prints `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`,
`SERVICE_ROLE_KEY`, and a `VAULT_KEY_HEX`. Paste the first four into `.env`.
Also set in `.env`:

- `API_EXTERNAL_URL` the public URL of your gateway (put TLS in front; use https).
- `SITE_URL` the public URL of your app.

Keep the printed `VAULT_KEY_HEX` for the app env (step 5) and for custody
(step 2). Then:

```bash
docker compose up -d
./scripts/apply-migrations.sh     # waits for auth.* and storage.*, then applies app migrations
./scripts/smoke-test.sh           # checks /auth/v1, /rest/v1, /storage/v1 and JWT role mapping
```

Green smoke test means the stack is up and correctly wired.

## 2. Key custody (do this the same day)

Two secrets become permanent the moment the first user exists:

- `VAULT_KEY_HEX` encrypts every vault document and every MFA secret.
- `JWT_SECRET` signs sessions and the anon/service keys.

Once a user uploads a vault file or enrolls MFA, `VAULT_KEY_HEX` can never
change. Once anyone is signed in, changing `JWT_SECRET` logs everyone out and
forces the anon/service keys to be regenerated together. Treat both as
write-once.

The same day you generate them, store all three of these off the host, in a
password manager or a sealed offline copy:

- `VAULT_KEY_HEX`
- `JWT_SECRET`
- the age or gpg PRIVATE key you will use for backups (step 3)

State it plainly: backups cannot recover vault files or MFA secrets without
`VAULT_KEY_HEX`. The database dump and the storage blobs are ciphertext. So
host loss plus key loss is permanent data loss even with perfect backups. The
key must live somewhere the host does not.

## 3. Gate 0.5: backups and one tested restore, on the empty stack

Do this now, while the database is empty, so a failure costs nothing and the
run doubles as the first live validation of scripts that have only been
syntax-checked.

Configure and take one backup (age shown; gpg works the same with
`BACKUP_ENCRYPTION=gpg` and `GPG_RECIPIENT`):

```bash
BACKUP_ENCRYPTION=age \
AGE_RECIPIENT=age1yourpublickeyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
BACKUP_UPLOAD_CMD='rclone copy "$1" offsite:carecircle-backups/' \
  ./scripts/backup.sh
```

Then run one full restore cycle into the isolated scratch stack and confirm it
passes end to end (row counts plus the decrypt-one-object check):

```bash
BACKUP_FILE=./backups/carecircle-YYYYMMDD-HHMMSS.tgz.age \
BACKUP_ENCRYPTION=age AGE_IDENTITY=/path/to/age.key \
VAULT_KEY_HEX=<the key you generated in step 1> \
  ./scripts/restore.sh
```

If restore passes on the empty stack, the backup and restore machinery is
proven before any real data depends on it. Schedule the nightly backup and the
monthly restore per OPERATIONS.md.

## 4. Happy-path verification

Signup is invite-based, so seed one test patient and invite once. The service
key bypasses RLS; only do this on a fresh test stack.

```bash
API="https://api.yourdomain"        # your API_EXTERNAL_URL
SVC="<SERVICE_ROLE_KEY from .env>"
PID=$(curl -s -X POST "$API/auth/v1/admin/users" \
  -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H "Content-Type: application/json" \
  -d '{"email":"patient@test.local","password":"Test-Patient-9x!","email_confirm":true,"user_metadata":{"full_name":"Test Patient"}}' \
  | grep -oE '"id":"[0-9a-f-]+"' | head -1 | cut -d'"' -f4)
curl -s -X POST "$API/rest/v1/care_circle_invites" \
  -H "apikey: $SVC" -H "Authorization: Bearer $SVC" -H "Content-Type: application/json" \
  -d "[{\"code\":\"TESTINVITE\",\"patient_id\":\"$PID\",\"patient_name\":\"Test Patient\",\"suggested_role\":\"admin\",\"expires_at\":\"2999-01-01T00:00:00Z\"}]"
```

Now walk the real flow in the app and confirm each step:

- Signup: open `/signup?code=TESTINVITE`, complete it with a 12+ char password.
  You should land in the app.
- Vault upload: on the Vault tab, upload a small PDF or image. It should list.
- Vault download: download that file and confirm the bytes open. This proves
  storage plus `VAULT_KEY_HEX` plus the encrypt and decrypt round trip.
- MFA enroll: on the Family page, Account security, enable two-factor, add the
  secret to an authenticator app, verify a code, and save the backup codes.
- Logout and login: clear the session, sign in again at `/login`. You should be
  prompted for the second factor and get in with a current TOTP code.

If any step fails, fix it before inviting real users. Delete the test patient,
invite, and any test uploads when done.

## 5. Repoint the app, then decommission the managed project

Point the app at your stack. In the app environment set:

```
NEXT_PUBLIC_SUPABASE_URL=https://api.yourdomain      # your gateway (TLS)
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from .env>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from .env>
VAULT_KEY_HEX=<the key from step 1>
```

`NEXT_PUBLIC_*` are compiled into the browser bundle, so a redeploy or rebuild
is required for the change to take effect. Two ways:

- Vercel (or wherever the app runs): update those env vars and redeploy.
- Same host as the stack: run the app container via
  `docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --build`.

Confirm the deployed app talks to your gateway (repeat the happy path once
against the real deployment).

Then decommission the managed project so nothing routes there anymore:

- Pause or delete the managed Supabase project.
- Rotate its service_role key (so any leaked copy is dead).
- Purge its URL and keys from everywhere they were stored: the app env, CI and
  deploy secrets, local `.env` files, and any notes.

## 6. Before real PHI

Do not invite real users until all of these are true:

- [ ] Nightly backups run and the last one succeeded (green).
- [ ] One full `restore.sh` cycle passed, including the decrypt-one-object check.
- [ ] `VAULT_KEY_HEX`, `JWT_SECRET`, and the backup private key are custodied
      off the host.
- [ ] The managed project is decommissioned and its keys rotated and purged.
- [ ] TLS is in front of the gateway and the data volumes are on encrypted disk
      (see the hardening checklist in README.md).

Only then invite real users.
