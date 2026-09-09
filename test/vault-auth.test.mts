import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq } from "./harness.mts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

const { authVault, authVaultForFile } = await import("../src/lib/vault-auth.ts");

const stub = new FetchStub();
stub.install();

test("denies a request with no Authorization header (401)", async () => {
  stub.reset();
  const r = await authVault(makeReq("https://care/api/vault/upload", { method: "POST" }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 401);
});

test("denies an invalid token (401)", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ status: 401, text: "bad" }));
  const r = await authVault(makeReq("https://care/api/vault/upload", { method: "POST", headers: { authorization: "Bearer bad" } }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 401);
});

test("denies a valid user with no care_circle membership (403)", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "u1" } }));
  stub.on("/rest/v1/care_circle?member_user_id", () => ({ json: [] }));
  const r = await authVault(makeReq("https://care/api/vault/upload", { method: "POST", headers: { authorization: "Bearer good" } }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 403);
});

test("authorizes a member and returns their patient_id", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "u1" } }));
  stub.on("/rest/v1/care_circle?member_user_id", () => ({ json: [{ patient_id: "patient-9" }] }));
  const r = await authVault(makeReq("https://care/api/vault/upload", { method: "POST", headers: { authorization: "Bearer good" } }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.patientId, "patient-9");
    assert.equal(r.userId, "u1");
  }
});

test("SECURITY: authVaultForFile blocks a file belonging to another patient (403 IDOR guard)", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "u1" } }));
  stub.on("/rest/v1/care_circle?member_user_id", () => ({ json: [{ patient_id: "patient-9" }] }));
  stub.on("/rest/v1/vault_files?id", () => ({ json: [{ patient_id: "patient-OTHER" }] }));
  const r = await authVaultForFile(
    makeReq("https://care/api/vault/download/f1", { headers: { authorization: "Bearer good" } }),
    "f1",
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 403);
});

test("authVaultForFile allows a file owned by the caller's patient", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "u1" } }));
  stub.on("/rest/v1/care_circle?member_user_id", () => ({ json: [{ patient_id: "patient-9" }] }));
  stub.on("/rest/v1/vault_files?id", () => ({ json: [{ patient_id: "patient-9" }] }));
  const r = await authVaultForFile(
    makeReq("https://care/api/vault/download/f1", { headers: { authorization: "Bearer good" } }),
    "f1",
  );
  assert.equal(r.ok, true);
});

test("authVaultForFile returns 404 for a nonexistent file id", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "u1" } }));
  stub.on("/rest/v1/care_circle?member_user_id", () => ({ json: [{ patient_id: "patient-9" }] }));
  stub.on("/rest/v1/vault_files?id", () => ({ json: [] }));
  const r = await authVaultForFile(
    makeReq("https://care/api/vault/download/missing", { headers: { authorization: "Bearer good" } }),
    "missing",
  );
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 404);
});
