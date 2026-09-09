import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq, readJson } from "./harness.mts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
process.env.RESEND_API_KEY = "resend-key";

const { GET, POST } = await import("../src/app/api/circle/route.ts");

const stub = new FetchStub();
stub.install();

const AUTH = { authorization: "Bearer good" };

// Authenticate the caller as `userId`, and make the membership lookup return
// a row (authorized) or empty (not a member) for the target patient.
function auth(userId: string | null, isMember: boolean) {
  stub.on("/auth/v1/user", () => (userId ? { json: { id: userId } } : { status: 401, text: "bad" }));
  stub.on("/rest/v1/care_circle?patient_id", (c) => {
    // The authorization probe selects id with member_user_id filter.
    if (c.url.includes("member_user_id")) return { json: isMember ? [{ id: "cc-self" }] : [] };
    return undefined; // fall through to data responders below
  });
}

test("SECURITY (F3 fixed): GET without a token is rejected 401 (no PII leak)", async () => {
  stub.reset();
  auth("u1", true);
  const res = await GET(makeReq("https://care/api/circle?patient_id=any-uuid")); // no Authorization
  const { status } = await readJson(res);
  assert.equal(status, 401);
});

test("SECURITY (F3 fixed): GET by a non-member is rejected 403", async () => {
  stub.reset();
  auth("stranger", false);
  const res = await GET(makeReq("https://care/api/circle?patient_id=victim-uuid", { headers: AUTH }));
  const { status } = await readJson(res);
  assert.equal(status, 403);
});

test("GET by the patient themselves is authorized", async () => {
  stub.reset();
  // userId === patientId short-circuits to authorized without a membership row.
  stub.on("/auth/v1/user", () => ({ json: { id: "patient-1" } }));
  stub.on("/rest/v1/care_circle?patient_id", (c) => {
    if (c.url.includes("member_user_id")) return { json: [] };
    if (c.url.includes("order=created_at")) {
      return { json: [{ id: "m1", member_email: "a@x.com", member_name: "A", relationship: "Son", alert_level: "critical" }] };
    }
    return undefined;
  });
  const res = await GET(makeReq("https://care/api/circle?patient_id=patient-1", { headers: AUTH }));
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.members.length, 1);
});

test("GET by an authorized member returns the circle", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "member-9" } }));
  stub.on("/rest/v1/care_circle?patient_id", (c) => {
    if (c.url.includes("member_user_id")) return { json: [{ id: "cc-self" }] }; // is a member
    if (c.url.includes("order=created_at")) {
      return { json: [{ id: "m1", member_email: "a@x.com", member_name: "A", relationship: "Son", alert_level: "critical" }] };
    }
    return undefined;
  });
  const res = await GET(makeReq("https://care/api/circle?patient_id=patient-1", { headers: AUTH }));
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.members[0].member_email, "a@x.com");
});

test("SECURITY (F3 fixed): POST without a token is rejected 401 (no member added, no email)", async () => {
  stub.reset();
  auth("u1", true);
  stub.on("api.resend.com", () => ({ json: { id: "e" } }));
  const res = await POST(
    makeReq("https://care/api/circle", {
      method: "POST",
      body: JSON.stringify({ patient_id: "victim-uuid", member_email: "attacker@evil.com", member_name: "Mallory", relationship: "Friend", alert_level: "critical" }),
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 401);
  assert.equal(stub.calls.some((c) => c.url.includes("api.resend.com")), false);
});

test("SECURITY (F3 fixed): POST by a non-member is rejected 403", async () => {
  stub.reset();
  auth("stranger", false);
  const res = await POST(
    makeReq("https://care/api/circle", {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ patient_id: "victim-uuid", member_email: "attacker@evil.com", member_name: "Mallory", relationship: "Friend", alert_level: "critical" }),
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 403);
});

test("authorized POST adds a member and sends the invite email", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "patient-1" } })); // patient adds to own circle
  stub.on("/rest/v1/care_circle", (c) => {
    if (c.url.includes("member_user_id")) return { json: [] }; // membership probe (unused; patient short-circuits)
    if (c.method === "POST") return { json: [{ id: "new", ...JSON.parse(c.body || "[]")[0] }] };
    return undefined;
  });
  stub.on("api.resend.com", () => ({ json: { id: "email_x" } }));
  const res = await POST(
    makeReq("https://care/api/circle", {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ patient_id: "patient-1", member_email: "sis@x.com", member_name: "Sis", relationship: "Daughter", alert_level: "critical" }),
    }),
  );
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.member.member_email, "sis@x.com");
  assert.equal(stub.calls.some((c) => c.url.includes("api.resend.com")), true);
});

test("POST validates email format before auth-independent checks", async () => {
  stub.reset();
  auth("patient-1", true);
  const res = await POST(
    makeReq("https://care/api/circle", {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ patient_id: "p", member_email: "not-an-email", member_name: "X", relationship: "Son", alert_level: "critical" }),
    }),
  );
  const { status, body } = await readJson(res);
  assert.equal(status, 400);
  assert.match(body.error, /valid member_email/);
});

test("GET without patient_id returns 400", async () => {
  stub.reset();
  auth("u1", true);
  const res = await GET(makeReq("https://care/api/circle", { headers: AUTH }));
  const { status } = await readJson(res);
  assert.equal(status, 400);
});

test("POST rejects an invalid care_role", async () => {
  stub.reset();
  auth("patient-1", true);
  const res = await POST(
    makeReq("https://care/api/circle", {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ patient_id: "p", member_email: "a@x.com", member_name: "X", relationship: "Son", alert_level: "critical", care_role: "root" }),
    }),
  );
  const { status, body } = await readJson(res);
  assert.equal(status, 400);
  assert.match(body.error, /care_role/);
});

test("authorized POST persists the chosen care_role", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "patient-1" } }));
  let insertedRole: string | undefined;
  stub.on("/rest/v1/care_circle", (c) => {
    if (c.method === "POST") {
      insertedRole = JSON.parse(c.body || "[]")[0]?.care_role;
      return { json: [{ id: "new", ...JSON.parse(c.body || "[]")[0] }] };
    }
    return undefined;
  });
  stub.on("api.resend.com", () => ({ json: { id: "e" } }));
  const res = await POST(
    makeReq("https://care/api/circle", {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ patient_id: "patient-1", member_email: "v@x.com", member_name: "V", relationship: "Friend", alert_level: "informational", care_role: "viewer" }),
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(insertedRole, "viewer");
});
