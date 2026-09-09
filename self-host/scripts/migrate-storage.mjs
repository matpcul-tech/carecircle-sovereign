#!/usr/bin/env node
// Copy the encrypted vault objects from the MANAGED Supabase storage bucket to
// the SELF-HOSTED one. The DB rows (vault_files, storage.objects) are moved by
// the SQL dump; this moves the actual file bytes.
//
//   MANAGED_URL=https://<ref>.supabase.co \
//   MANAGED_SERVICE_KEY=<managed service_role key> \
//   SELFHOST_URL=https://api.yourdomain \
//   SELFHOST_SERVICE_KEY=<self-hosted SERVICE_ROLE_KEY> \
//     node scripts/migrate-storage.mjs
//
// Reads the file list from the managed project's vault_files table, downloads
// each object, and uploads it to the self-hosted bucket (idempotent upsert).
// Bytes are copied verbatim - still AES-256-GCM ciphertext; nothing is
// decrypted here.
const BUCKET = process.env.BUCKET || 'care-circle-vault';
const need = ['MANAGED_URL', 'MANAGED_SERVICE_KEY', 'SELFHOST_URL', 'SELFHOST_SERVICE_KEY'];
for (const k of need) if (!process.env[k]) { console.error(`missing env ${k}`); process.exit(1); }
const { MANAGED_URL, MANAGED_SERVICE_KEY, SELFHOST_URL, SELFHOST_SERVICE_KEY } = process.env;

const svc = (key) => ({ apikey: key, Authorization: `Bearer ${key}` });

async function listPaths() {
  const paths = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const r = await fetch(
      `${MANAGED_URL}/rest/v1/vault_files?select=storage_path&order=uploaded_at.asc&limit=${pageSize}&offset=${offset}`,
      { headers: svc(MANAGED_SERVICE_KEY), cache: 'no-store' },
    );
    if (!r.ok) throw new Error(`list vault_files ${r.status}: ${await r.text()}`);
    const rows = await r.json();
    for (const row of rows) if (row.storage_path) paths.push(row.storage_path);
    if (rows.length < pageSize) break;
  }
  return paths;
}

async function copyOne(path) {
  const dl = await fetch(`${MANAGED_URL}/storage/v1/object/${BUCKET}/${path}`, {
    headers: svc(MANAGED_SERVICE_KEY),
    cache: 'no-store',
  });
  if (!dl.ok) throw new Error(`download ${path} → ${dl.status}`);
  const bytes = new Uint8Array(await dl.arrayBuffer());

  const up = await fetch(`${SELFHOST_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...svc(SELFHOST_SERVICE_KEY), 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
    body: bytes,
  });
  if (!up.ok) throw new Error(`upload ${path} → ${up.status}: ${(await up.text()).slice(0, 160)}`);
  return bytes.length;
}

const paths = await listPaths();
console.log(`Copying ${paths.length} vault object(s) → ${SELFHOST_URL} / ${BUCKET}`);
let ok = 0, bytes = 0;
for (const p of paths) {
  try {
    bytes += await copyOne(p);
    ok++;
    if (ok % 25 === 0 || ok === paths.length) console.log(`  ${ok}/${paths.length}`);
  } catch (e) {
    console.error(`  FAILED ${p}: ${e.message}`);
  }
}
console.log(`Done: ${ok}/${paths.length} objects, ${(bytes / 1024 / 1024).toFixed(1)} MB.`);
if (ok !== paths.length) process.exit(1);
