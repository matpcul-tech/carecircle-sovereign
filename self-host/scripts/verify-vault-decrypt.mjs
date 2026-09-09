#!/usr/bin/env node
// Restore-verification helper: prove that a restored vault object still
// decrypts with VAULT_KEY_HEX. Pulls one vault_files row from a stack over its
// REST API, downloads the object from that stack's storage, and runs the exact
// AES-256-GCM open the app uses (ciphertext = data || 16-byte GCM tag; iv from
// the row). A successful tag verification means the backup's blobs and the key
// are intact. Nothing is written; the plaintext is discarded.
//
// Required env:
//   VERIFY_URL           base URL of the stack to check (e.g. http://localhost:8100)
//   VERIFY_SERVICE_KEY   that stack's service_role key
//   VAULT_KEY_HEX        64 hex chars, the same key the objects were sealed with
// Optional:
//   BUCKET               default care-circle-vault
import { createDecipheriv } from 'node:crypto';

const BUCKET = process.env.BUCKET || 'care-circle-vault';
for (const k of ['VERIFY_URL', 'VERIFY_SERVICE_KEY', 'VAULT_KEY_HEX']) {
  if (!process.env[k]) { console.error(`missing env ${k}`); process.exit(2); }
}
const { VERIFY_URL, VERIFY_SERVICE_KEY, VAULT_KEY_HEX } = process.env;
if (!/^[0-9a-fA-F]{64}$/.test(VAULT_KEY_HEX)) {
  console.error('VAULT_KEY_HEX must be 64 hex chars'); process.exit(2);
}
const key = Buffer.from(VAULT_KEY_HEX, 'hex');
const svc = { apikey: VERIFY_SERVICE_KEY, Authorization: `Bearer ${VERIFY_SERVICE_KEY}` };

const listRes = await fetch(
  `${VERIFY_URL}/rest/v1/vault_files?select=storage_path,iv,filename,size_bytes&limit=1`,
  { headers: svc, cache: 'no-store' },
);
if (!listRes.ok) { console.error(`vault_files query ${listRes.status}`); process.exit(1); }
const rows = await listRes.json();
if (!rows.length) { console.log('OK: no vault files present to verify (empty vault).'); process.exit(0); }

const { storage_path, iv, filename, size_bytes } = rows[0];
const dl = await fetch(`${VERIFY_URL}/storage/v1/object/${BUCKET}/${storage_path}`, {
  headers: svc, cache: 'no-store',
});
if (!dl.ok) { console.error(`download ${storage_path} -> ${dl.status}`); process.exit(1); }
const blob = Buffer.from(await dl.arrayBuffer());
if (blob.length < 16) { console.error('object too short to contain a GCM tag'); process.exit(1); }

const ivBuf = Buffer.from(iv, 'base64');
const tag = blob.subarray(blob.length - 16);
const ct = blob.subarray(0, blob.length - 16);
try {
  const d = createDecipheriv('aes-256-gcm', key, ivBuf);
  d.setAuthTag(tag);
  const plain = Buffer.concat([d.update(ct), d.final()]);
  const sizeNote = typeof size_bytes === 'number'
    ? (plain.length === size_bytes ? ' size matches' : ` WARNING size ${plain.length} != recorded ${size_bytes}`)
    : '';
  console.log(`OK: decrypted "${filename}" (${plain.length} bytes).${sizeNote}`);
  process.exit(0);
} catch (e) {
  console.error(`FAIL: decrypt/tag verification failed for "${filename}": ${e.message}`);
  process.exit(1);
}
