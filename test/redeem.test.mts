import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq, readJson } from "./harness.mts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

const { GET, POST } = await import("../src/app/api/circle/redeem/route.ts");

const stub = new FetchStub();
stub.install();

const future = new Date(Date.now() + 86_400_000).toISOString();
const past = new Date(Date.now() - 86_400_000).toISOString();

function inviteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv1",
    code: "ABCDEFGH",
    patient_id: "patient-1",
    patient_name: "Mary",
    suggested_relationship: "Daughter",
    suggested_alert_level: "informational",
    expires_at: future,
    used_at: null,
    revoked_at: null,
    ...overrides,
  };
}

test("GET validates a good code", async () => {
  stub.reset();
  stub.on("care_circle_invites?code", () => ({ json: [inviteRow()] }));
  const res = await GET(makeReq("https://care/api/circle/redeem?code=abcdefgh"));
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.valid, true);
  assert.equal(body.patient_name, "Mary");
});

test("rate limit: brute-force GET is throttled 429 before any invite lookup", async () => {
  stub.reset();
  stub.on("/rest/v1/rpc/rate_limit_hit", () => ({ json: false }));
  stub.on("care_circle_invites?code", () => ({ json: [inviteRow()] }));
  const res = await GET(makeReq("https://care/api/circle/redeem?code=ABCDEFGH"));
  const { status } = await readJson(res);
  assert.equal(status, 429);
  assert.equal(stub.calls.some((c) => c.url.includes("care_circle_invites?code")), false);
});

test("rate limit: over-limit POST is throttled 429 before account creation", async () => {
  stub.reset();
  stub.on("/rest/v1/rpc/rate_limit_hit", () => ({ json: false }));
  const res = await POST(
    makeReq("https://care/api/circle/redeem", {
      method: "POST",
      body: JSON.stringify({ code: "ABCDEFGH", email: "f@x.com", password: "Str0ng-Passphrase!", member_name: "Fam" }),
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 429);
  assert.equal(stub.calls.some((c) => c.url.includes("/auth/v1/admin/users")), false);
});

test("GET on an expired invite returns 410", async () => {
  stub.reset();
  stub.on("care_circle_invites?code", () => ({ json: [inviteRow({ expires_at: past })] }));
  const res = await GET(makeReq("https://care/api/circle/redeem?code=ABCDEFGH"));
  const { status, body } = await readJson(res);
  assert.equal(status, 410);
  assert.match(body.error, /expired/);
});

test("GET on a revoked invite returns 410", async () => {
  stub.reset();
  stub.on("care_circle_invites?code", () => ({ json: [inviteRow({ revoked_at: past })] }));
  const res = await GET(makeReq("https://care/api/circle/redeem?code=ABCDEFGH"));
  const { status, body } = await readJson(res);
  assert.equal(status, 410);
  assert.match(body.error, /revoked/);
});

test("GET on an already-used invite returns 410", async () => {
  stub.reset();
  stub.on("care_circle_invites?code", () => ({ json: [inviteRow({ used_at: past })] }));
  const res = await GET(makeReq("https://care/api/circle/redeem?code=ABCDEFGH"));
  const { status, body } = await readJson(res);
  assert.equal(status, 410);
  assert.match(body.error, /redeemed/);
});

test("GET on an unknown code returns 404", async () => {
  stub.reset();
  stub.on("care_circle_invites?code", () => ({ json: [] }));
  const res = await GET(makeReq("https://care/api/circle/redeem?code=ZZZZZZZZ"));
  const { status } = await readJson(res);
  assert.equal(status, 404);
});

test("POST rejects a short password before creating anything", async () => {
  stub.reset();
  stub.on("care_circle_invites?code", () => ({ json: [inviteRow()] }));
  const res = await POST(
    makeReq("https://care/api/circle/redeem", {
      method: "POST",
      body: JSON.stringify({ code: "ABCDEFGH", email: "f@x.com", password: "short", member_name: "Fam" }),
    }),
  );
  const { status, body } = await readJson(res);
  assert.equal(status, 400);
  assert.match(body.error, /at least 12/);
  // No auth-user creation should have been attempted.
  assert.equal(stub.calls.some((c) => c.url.includes("/auth/v1/admin/users")), false);
});

test("POST rejects an invalid email", async () => {
  stub.reset();
  const res = await POST(
    makeReq("https://care/api/circle/redeem", {
      method: "POST",
      body: JSON.stringify({ code: "ABCDEFGH", email: "nope", password: "Str0ng-Passphrase!", member_name: "Fam" }),
    }),
  );
  const { status, body } = await readJson(res);
  assert.equal(status, 400);
  assert.match(body.error, /valid email/);
});

test("POST on an expired invite returns 410 and creates no user", async () => {
  stub.reset();
  stub.on("care_circle_invites?code", () => ({ json: [inviteRow({ expires_at: past })] }));
  const res = await POST(
    makeReq("https://care/api/circle/redeem", {
      method: "POST",
      body: JSON.stringify({ code: "ABCDEFGH", email: "f@x.com", password: "Str0ng-Passphrase!", member_name: "Fam" }),
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 410);
  assert.equal(stub.calls.some((c) => c.url.includes("/auth/v1/admin/users")), false);
});

test("POST happy path creates user, links circle, marks invite used, returns session", async () => {
  stub.reset();
  let inviteUsedPatched = false;
  stub
    .on("care_circle_invites?code", () => ({ json: [inviteRow()] }))
    .on("/auth/v1/admin/users", (c) => {
      if (c.method === "POST") return { json: { id: "new-user", email: "f@x.com" } };
      return undefined;
    })
    .on("/rest/v1/care_circle", (c) =>
      c.method === "POST" ? { json: [{ id: "cc1", patient_id: "patient-1" }] } : undefined,
    )
    .on("care_circle_invites?id", (c) => {
      // The atomic claim is a conditional PATCH setting used_at to a
      // timestamp; model the winning UPDATE by returning a non-empty row set.
      if (c.method === "PATCH" && (c.body || "").includes('"used_at":"')) inviteUsedPatched = true;
      return { json: [{ id: "inv1" }] };
    })
    .on("/auth/v1/token", () => ({ json: { access_token: "at", refresh_token: "rt", expires_at: 999 } }));
  const res = await POST(
    makeReq("https://care/api/circle/redeem", {
      method: "POST",
      body: JSON.stringify({ code: "ABCDEFGH", email: "f@x.com", password: "Str0ng-Passphrase!", member_name: "Fam" }),
    }),
  );
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.user.id, "new-user");
  assert.equal(body.session.access_token, "at");
  assert.equal(inviteUsedPatched, true, "invite must be atomically claimed (used_at set)");
  // The claim must be a conditional update guarded on used_at IS NULL.
  const claim = stub.calls.find(
    (c) => c.method === "PATCH" && c.url.includes("care_circle_invites?id") && c.url.includes("used_at=is.null"),
  );
  assert.ok(claim, "redeem must claim the invite via a used_at=is.null conditional PATCH");
});

test("POST rolls back the auth user if the circle insert fails", async () => {
  stub.reset();
  let deletedUser = false;
  stub
    .on("care_circle_invites?code", () => ({ json: [inviteRow()] }))
    .on("/auth/v1/admin/users", (c) => {
      if (c.method === "POST") return { json: { id: "new-user", email: "f@x.com" } };
      if (c.method === "DELETE") {
        deletedUser = true;
        return { json: {} };
      }
      return undefined;
    })
    .on("/rest/v1/care_circle", (c) =>
      c.method === "POST" ? { status: 500, text: "boom" } : undefined,
    )
    .on("care_circle_invites?id", () => ({ json: [{ id: "inv1" }] }));
  const res = await POST(
    makeReq("https://care/api/circle/redeem", {
      method: "POST",
      body: JSON.stringify({ code: "ABCDEFGH", email: "f@x.com", password: "Str0ng-Passphrase!", member_name: "Fam" }),
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 500);
  assert.equal(deletedUser, true, "orphaned auth user must be cleaned up on circle-insert failure");
  // The claim must be released so the invite is reusable after the failure.
  const released = stub.calls.some(
    (c) => c.method === "PATCH" && c.url.includes("care_circle_invites?id") && (c.body || "").includes('"used_at":null'),
  );
  assert.ok(released, "a failed redemption must release its invite claim");
});

// Helper: run a full happy-path redeem and return the care_role written to
// the care_circle insert. `inviteOverrides` and `body` tune the invite's
// suggested_role and the client-requested role.
async function redeemAndCaptureRole(
  inviteOverrides: Record<string, unknown>,
  bodyExtra: Record<string, unknown>,
): Promise<string | undefined> {
  stub.reset();
  let insertedRole: string | undefined;
  stub
    .on("care_circle_invites?code", () => ({ json: [inviteRow(inviteOverrides)] }))
    .on("care_circle_invites?id", () => ({ json: [{ id: "inv1" }] }))
    .on("/auth/v1/admin/users", (c) => (c.method === "POST" ? { json: { id: "new-user", email: "f@x.com" } } : undefined))
    .on("/rest/v1/care_circle", (c) => {
      if (c.method === "POST") {
        insertedRole = JSON.parse(c.body || "[]")[0]?.care_role;
        return { json: [{ id: "cc1", patient_id: "patient-1" }] };
      }
      return undefined;
    })
    .on("/auth/v1/token", () => ({ json: { access_token: "at", refresh_token: "rt", expires_at: 999 } }));
  const res = await POST(
    makeReq("https://care/api/circle/redeem", {
      method: "POST",
      body: JSON.stringify({ code: "ABCDEFGH", email: "f@x.com", password: "Str0ng-Passphrase!", member_name: "Fam", ...bodyExtra }),
    }),
  );
  await readJson(res);
  return insertedRole;
}

test("redeem assigns the invite's suggested_role", async () => {
  const role = await redeemAndCaptureRole({ suggested_role: "viewer" }, {});
  assert.equal(role, "viewer");
});

test("redeem defaults to caregiver when the invite suggests no role", async () => {
  const role = await redeemAndCaptureRole({}, {});
  assert.equal(role, "caregiver");
});

test("SECURITY: client CANNOT escalate above the invite's suggested_role", async () => {
  const role = await redeemAndCaptureRole({ suggested_role: "viewer" }, { role: "admin" });
  assert.equal(role, "viewer", "a viewer invite must not be redeemable as admin");
});

test("client MAY narrow below the suggested role", async () => {
  const role = await redeemAndCaptureRole({ suggested_role: "admin" }, { role: "viewer" });
  assert.equal(role, "viewer");
});

test("POST maps duplicate-email auth error to 409", async () => {
  stub.reset();
  stub
    .on("care_circle_invites?code", () => ({ json: [inviteRow()] }))
    .on("/auth/v1/admin/users", (c) =>
      c.method === "POST" ? { status: 422, text: "User already registered" } : undefined,
    )
    .on("care_circle_invites?id", () => ({ json: [{ id: "inv1" }] }));
  const res = await POST(
    makeReq("https://care/api/circle/redeem", {
      method: "POST",
      body: JSON.stringify({ code: "ABCDEFGH", email: "dupe@x.com", password: "Str0ng-Passphrase!", member_name: "Fam" }),
    }),
  );
  const { status, body } = await readJson(res);
  assert.equal(status, 409);
  assert.match(body.error, /already exists/);
  // A duplicate-email failure must also release the claim (didn't consume it).
  const released = stub.calls.some(
    (c) => c.method === "PATCH" && c.url.includes("care_circle_invites?id") && (c.body || "").includes('"used_at":null'),
  );
  assert.ok(released, "duplicate-email redemption must release its invite claim");
});
