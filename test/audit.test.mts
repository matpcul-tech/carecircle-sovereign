import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub } from "./harness.mts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

const { logPhiAccess, requestContext } = await import("../src/lib/audit.ts");
const { canReadVault, canWriteVault, canDeleteVault } = await import("../src/lib/vault-auth.ts");

const stub = new FetchStub();
stub.install();

test("logPhiAccess posts a well-formed row via the service role", async () => {
  stub.reset();
  stub.on("/rest/v1/phi_access_log", () => ({ json: {} }));
  const ok = await logPhiAccess({
    patientId: "p1",
    actorUserId: "u1",
    actorRole: "caregiver",
    action: "download",
    resourceType: "vault_file",
    resourceId: "f1",
    detail: { filename: "labs.pdf" },
    ip: "1.2.3.4",
    userAgent: "jest",
  });
  assert.equal(ok, true);
  const call = stub.calls.find((c) => c.url.includes("/rest/v1/phi_access_log"))!;
  assert.equal(call.method, "POST");
  assert.equal(call.headers["apikey"], "service-role-key");
  const row = JSON.parse(call.body || "[]")[0];
  assert.equal(row.patient_id, "p1");
  assert.equal(row.actor_user_id, "u1");
  assert.equal(row.actor_role, "caregiver");
  assert.equal(row.action, "download");
  assert.equal(row.resource_type, "vault_file");
  assert.equal(row.resource_id, "f1");
  assert.equal(row.source, "api");
  assert.equal(row.ip, "1.2.3.4");
});

test("logPhiAccess returns false (and does not throw) when the write fails", async () => {
  stub.reset();
  stub.on("/rest/v1/phi_access_log", () => ({ status: 500, text: "boom" }));
  const ok = await logPhiAccess({ patientId: "p1", action: "ai_query", resourceType: "ai_chat" });
  assert.equal(ok, false);
});

test("requestContext extracts the first x-forwarded-for hop and the UA", () => {
  const h = new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1", "user-agent": "curl/8" });
  const ctx = requestContext(h);
  assert.equal(ctx.ip, "9.9.9.9");
  assert.equal(ctx.userAgent, "curl/8");
});

test("vault capability tiers match the SQL cc_can_* semantics", () => {
  // read/upload: admin + caregiver; delete: admin only.
  assert.equal(canReadVault("admin"), true);
  assert.equal(canReadVault("caregiver"), true);
  assert.equal(canReadVault("viewer"), false);
  assert.equal(canWriteVault("caregiver"), true);
  assert.equal(canWriteVault("viewer"), false);
  assert.equal(canDeleteVault("admin"), true);
  assert.equal(canDeleteVault("caregiver"), false);
  assert.equal(canDeleteVault("viewer"), false);
});
