import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq, readJson } from "./harness.mts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
process.env.VAULT_KEY_HEX = "a".repeat(64);

const upload = await import("../src/app/api/vault/upload/route.ts");
const download = await import("../src/app/api/vault/download/[id]/route.ts");
const del = await import("../src/app/api/vault/delete/[id]/route.ts");
const { encryptGCM } = await import("../src/lib/vault-crypto.ts");

// A genuinely-encrypted blob so the download route's decrypt step succeeds.
const PLAIN = Buffer.from("real pdf bytes");
const ENC = encryptGCM(PLAIN);

const stub = new FetchStub();
stub.install();

// Wire a member of `patient-1` with the given role, plus vault storage/db and
// the audit sink. `fileOwner` controls which patient the target file belongs
// to (for the download/delete ownership + role checks).
function scenario(role: string, fileOwner = "patient-1") {
  stub.reset();
  stub
    .on("/auth/v1/user", () => ({ json: { id: "member-1" } }))
    .on("/rest/v1/care_circle?member_user_id", () => ({ json: [{ patient_id: "patient-1", care_role: role }] }))
    .on("/rest/v1/vault_files?id", () => ({ json: [{ patient_id: fileOwner, storage_path: "patient-1/f.enc", iv: ENC.ivBase64, filename: "labs.pdf", mime_type: "application/pdf" }] }))
    .on("/storage/v1/object", (c) => (c.method === "GET" ? { bytes: new Uint8Array(ENC.ciphertext) } : { json: {} }))
    .on("/rest/v1/vault_files", (c) => (c.method === "POST" ? { json: [{ id: "file-9", filename: "labs.pdf", mime_type: "application/pdf", size_bytes: 3, uploaded_at: "t" }] } : undefined))
    .on("/rest/v1/phi_access_log", () => ({ json: {} }));
}

function auditRows() {
  return stub.calls
    .filter((c) => c.url.includes("/rest/v1/phi_access_log") && c.method === "POST")
    .flatMap((c) => JSON.parse(c.body || "[]"));
}

function uploadReq() {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "application/pdf" }), "labs.pdf");
  form.append("filename", "labs.pdf");
  return new Request("https://care/api/vault/upload", {
    method: "POST",
    headers: { authorization: "Bearer good" },
    body: form,
  }) as unknown as import("next/server").NextRequest;
}

// ---------- upload (write) ----------
test("viewer CANNOT upload (403), no file written, no audit", async () => {
  scenario("viewer");
  const res = await upload.POST(uploadReq());
  const { status } = await readJson(res);
  assert.equal(status, 403);
  assert.equal(stub.calls.some((c) => c.method === "POST" && c.url.endsWith("/vault_files")), false);
  assert.equal(auditRows().length, 0);
});

test("caregiver CAN upload and it is audited", async () => {
  scenario("caregiver");
  const res = await upload.POST(uploadReq());
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.file.id, "file-9");
  const rows = auditRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "upload");
  assert.equal(rows[0].resource_type, "vault_file");
  assert.equal(rows[0].actor_role, "caregiver");
  assert.equal(rows[0].patient_id, "patient-1");
});

// ---------- download (read) ----------
test("viewer CANNOT download (403)", async () => {
  scenario("viewer");
  const res = await download.GET(makeReq("https://care/api/vault/download/file-9", { headers: { authorization: "Bearer good" } }), { params: { id: "file-9" } });
  const { status } = await readJson(res);
  assert.equal(status, 403);
});

test("caregiver CAN download and it is audited", async () => {
  scenario("caregiver");
  const res = await download.GET(makeReq("https://care/api/vault/download/file-9", { headers: { authorization: "Bearer good" } }), { params: { id: "file-9" } });
  assert.equal(res.status, 200);
  const rows = auditRows();
  assert.equal(rows[0].action, "download");
  assert.equal(rows[0].resource_id, "file-9");
  assert.equal(rows[0].actor_role, "caregiver");
});

test("cross-patient download is blocked 403 before any audit (IDOR guard intact)", async () => {
  scenario("caregiver", "patient-OTHER");
  const res = await download.GET(makeReq("https://care/api/vault/download/file-9", { headers: { authorization: "Bearer good" } }), { params: { id: "file-9" } });
  const { status } = await readJson(res);
  assert.equal(status, 403);
  assert.equal(auditRows().length, 0);
});

// ---------- delete (admin-only) ----------
test("caregiver CANNOT delete (403)", async () => {
  scenario("caregiver");
  const res = await del.DELETE(makeReq("https://care/api/vault/delete/file-9", { method: "DELETE", headers: { authorization: "Bearer good" } }), { params: { id: "file-9" } });
  const { status } = await readJson(res);
  assert.equal(status, 403);
});

test("admin CAN delete and it is audited", async () => {
  scenario("admin");
  const res = await del.DELETE(makeReq("https://care/api/vault/delete/file-9", { method: "DELETE", headers: { authorization: "Bearer good" } }), { params: { id: "file-9" } });
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  const rows = auditRows();
  assert.equal(rows[0].action, "delete");
  assert.equal(rows[0].actor_role, "admin");
});

test("an unknown care_role degrades safely to caregiver (no admin escalation)", async () => {
  scenario("superuser"); // not a valid role
  const res = await del.DELETE(makeReq("https://care/api/vault/delete/file-9", { method: "DELETE", headers: { authorization: "Bearer good" } }), { params: { id: "file-9" } });
  const { status } = await readJson(res);
  assert.equal(status, 403, "unrecognized role must not grant admin delete");
});
