# Day-2 operations for the self-hosted stack

Backups, tested restores, monitoring, and upgrades once CareCircle is running
on your own stack. Everything here is destination-agnostic: you supply the
encryption recipient, the offsite target, and the alert URL via env. No
secrets live in this repo.

Scripts referenced:
- `scripts/backup.sh` nightly encrypted backup
- `scripts/restore.sh` monthly tested restore into an isolated scratch stack
- `scripts/verify-vault-decrypt.mjs` decrypt-one-object check used by restore

## 1. Backups (nightly)

`backup.sh` produces one artifact per run: a full `pg_dump` of the database
plus a tar of the vault storage files, bundled and encrypted with `age` or
`gpg` BEFORE anything leaves the host, then handed to your upload command.

### Encryption key setup (pick one)

age:
```bash
age-keygen -o /root/.config/carecircle/age.key      # keep the private key OFF this host's backups
grep 'public key' /root/.config/carecircle/age.key   # this is AGE_RECIPIENT
```

gpg:
```bash
gpg --quick-generate-key "carecircle-backups" default encrypt never
# use the key id / email as GPG_RECIPIENT
```

Store the PRIVATE decryption key somewhere separate from the backups (a
password manager or an offline vault). If it lives only next to the backups,
an attacker who takes the backups can read them, and a host loss takes the key
with it.

### Run it

```bash
cd self-host
BACKUP_ENCRYPTION=age \
AGE_RECIPIENT=age1examplexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
BACKUP_UPLOAD_CMD='rclone copy "$1" offsite:carecircle-backups/' \
HEALTHCHECK_URL=https://hc-ping.com/your-uuid \
  ./scripts/backup.sh
```

`BACKUP_UPLOAD_CMD` receives the artifact path as `"$1"`, so any tool works
(`rclone`, `aws s3 cp`, `scp`, `restic`, ...). Leave it unset to keep the
artifact local while you are setting things up. Local artifacts older than
`BACKUP_KEEP_DAYS` (default 14) are pruned; your offsite target keeps its own
retention.

### Schedule (cron example, 02:30 nightly)

```cron
30 2 * * *  cd /opt/care-os/self-host && \
  BACKUP_ENCRYPTION=age AGE_RECIPIENT=age1... \
  BACKUP_UPLOAD_CMD='rclone copy "$1" offsite:carecircle-backups/' \
  HEALTHCHECK_URL=https://hc-ping.com/your-uuid \
  ./scripts/backup.sh >> /var/log/carecircle-backup.log 2>&1
```

Keep secrets out of the crontab in production: put them in an env file the job
sources, or in your scheduler's secret store.

## 2. Tested restore (monthly)

A backup you have never restored is a guess. `restore.sh` proves it: it
decrypts a chosen artifact, brings up an isolated scratch stack (separate
compose project, separate volumes, remapped ports, so production is untouched),
restores the dump, loads the vault files, verifies row counts, and decrypts one
vault object with `VAULT_KEY_HEX`. It tears the scratch stack down afterward.

```bash
cd self-host
BACKUP_FILE=./backups/carecircle-20260210-023000.tgz.age \
BACKUP_ENCRYPTION=age AGE_IDENTITY=/root/.config/carecircle/age.key \
VAULT_KEY_HEX=<the same key the data was sealed with> \
  ./scripts/restore.sh
```

Cadence: run it monthly and after any stack upgrade. If the decrypt check
fails, your `VAULT_KEY_HEX` and your backups have drifted apart; stop and fix
that before trusting the backups. Schedule it like the backup (for example the
first of the month) and point its own `HEALTHCHECK_URL` at a separate check so
a skipped restore test also alerts.

## 3. Monitoring basics

- Disk. The `db-data` and `storage-data` volumes grow. Alert before full:
  ```bash
  df -h /var/lib/docker    # or wherever the volumes live
  ```
  A simple cron that pings a healthcheck only when free space is above a
  threshold turns "disk filling up" into an alert.
- Container health. The compose services define healthchecks; watch them:
  ```bash
  docker compose ps
  docker events --filter event=health_status   # stream health transitions
  ```
- Backup success alert. `backup.sh` pings `HEALTHCHECK_URL` on success and
  `HEALTHCHECK_URL/fail` on error. Point it at a healthchecks.io check (or any
  dead-man's-switch); the service alerts you when the expected daily ping does
  not arrive, which catches a cron that silently stopped running.
- App liveness. The gateway answers `GET /healthz`; the app container has its
  own Docker healthcheck. Put both behind your uptime monitor.

## 4. Patching and upgrades

Container images are pinned in `docker-compose.yml`. Treat an upgrade as a
change with a backout, not a `latest` pull.

Procedure:
1. Take a fresh backup and run a tested restore first (`restore.sh`).
2. Bump ONE image pin at a time in `docker-compose.yml`.
3. `docker compose pull && docker compose up -d`.
4. `./scripts/smoke-test.sh`, then a real login and a vault download.
5. Watch logs for the changed service: `docker compose logs -f <service>`.
6. If anything is wrong, revert the pin and `docker compose up -d`; restore
   from backup only if data was affected.

### GoTrue version pinning rules

GoTrue owns the `auth` schema, so its version is the one that can bite you:
- Never downgrade GoTrue below the schema currently in the database. It runs
  forward-only migrations at startup; an older image against a newer schema can
  fail to start.
- At cutover, the self-hosted GoTrue must be the same major version or newer
  than the managed project (see `preflight-census.sh` output). That is what
  lets the migrated `auth.users` (with bcrypt password hashes) load cleanly.
- Upgrade in small steps (one minor line at a time), and run the tested restore
  after each so a schema migration surprise shows up in the scratch stack, not
  in production.
- Postgres major upgrades (for example 15 to 16) are a dump-and-load, not an
  in-place image bump; do them with the backup/restore flow and a maintenance
  window.
