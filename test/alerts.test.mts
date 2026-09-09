import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { FetchStub, makeReq, readJson } from "./harness.mts";

// Env must be set before importing the module (read at module load).
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
process.env.CAREIQ_ALERT_SIGNING_KEY = "signing-secret";
process.env.RESEND_API_KEY = "resend-key";
// Deliberately leave TWILIO_* unset to exercise the "not configured" branch.

const { POST } = await import("../src/app/api/alerts/route.ts");

const stub = new FetchStub();
stub.install();

function circleMembers(members: unknown[]) {
  stub
    .on("/rest/v1/care_circle?patient_id", () => ({ json: members }))
    .on("api.resend.com", () => ({ json: { id: "email_1" } }))
    .on("/rest/v1/care_circle_alerts", (c) => ({
      json: JSON.parse(c.body || "[]").map((r: any, i: number) => ({
        id: `alert_${i}`,
        metric: r.metric,
        severity: r.severity,
        fired_at: r.fired_at,
      })),
    }));
}

function sign(ts: string, rawBody: string) {
  return createHmac("sha256", "signing-secret").update(ts + ":" + rawBody).digest("hex");
}

// Build a correctly-signed alert request for the given body object.
function signedReq(bodyObj: unknown) {
  const raw = JSON.stringify(bodyObj);
  const ts = String(Math.floor(Date.now() / 1000));
  return makeReq("https://care/api/alerts", {
    method: "POST",
    headers: { "x-alert-timestamp": ts, "x-alert-signature": sign(ts, raw) },
    body: raw,
  });
}

test("evaluate(): BP over threshold produces a critical flag", async () => {
  stub.reset();
  circleMembers([
    { id: "m1", member_email: "a@x.com", member_name: "A", member_phone: null, alert_level: "informational" },
  ]);
  const res = await POST(signedReq({ patient_id: "p1", vitals: { bp_systolic: 180, bp_diastolic: 100 } }));
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.flagged, true);
  const bp = body.flags.find((f: any) => f.metric === "Blood Pressure");
  assert.equal(bp.severity, "critical");
});

test("evaluate(): boundary values do NOT flag (a1c=6.4, ldl=200, bp=140/90)", async () => {
  stub.reset();
  circleMembers([]);
  const res = await POST(
    signedReq({ patient_id: "p1", vitals: { a1c: 6.4, ldl: 200, bp_systolic: 140, bp_diastolic: 90 } }),
  );
  const { body } = await readJson(res);
  assert.equal(body.flagged, false, "threshold uses strict >, boundary must not fire");
});

test("evaluate(): just over each boundary DOES flag", async () => {
  stub.reset();
  circleMembers([]);
  const res = await POST(
    signedReq({ patient_id: "p1", vitals: { a1c: 6.5, ldl: 201, bp_systolic: 141, bp_diastolic: 91 } }),
  );
  const { body } = await readJson(res);
  const metrics = body.flags.map((f: any) => f.metric).sort();
  assert.deepEqual(metrics, ["A1C", "Blood Pressure", "LDL Cholesterol"]);
});

// ---- FIXED F4: the vitals path now requires a valid HMAC signature ----
test("SECURITY (F4 fixed): unsigned vitals request is rejected 401, no fan-out", async () => {
  stub.reset();
  circleMembers([
    { id: "m1", member_email: "victim@x.com", member_name: "V", member_phone: null, alert_level: "informational" },
  ]);
  // No signature/timestamp headers.
  const res = await POST(
    makeReq("https://care/api/alerts", {
      method: "POST",
      body: JSON.stringify({ patient_id: "any-guessed-uuid", vitals: { bp_systolic: 200 } }),
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 401);
  const emailed = stub.calls.some((c) => c.url.includes("api.resend.com"));
  assert.equal(emailed, false, "no alert email may be sent for an unsigned request");
});

test("SECURITY (F4 fixed): a tampered vitals body fails the signature 401", async () => {
  stub.reset();
  circleMembers([]);
  const ts = String(Math.floor(Date.now() / 1000));
  const signedRaw = JSON.stringify({ patient_id: "p1", vitals: { bp_systolic: 130 } });
  const sig = sign(ts, signedRaw);
  const tampered = JSON.stringify({ patient_id: "p1", vitals: { bp_systolic: 200 } });
  const res = await POST(
    makeReq("https://care/api/alerts", {
      method: "POST",
      headers: { "x-alert-timestamp": ts, "x-alert-signature": sig },
      body: tampered,
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 401);
});

test("signed vitals request is accepted and fans out", async () => {
  stub.reset();
  circleMembers([
    { id: "m1", member_email: "a@x.com", member_name: "A", member_phone: null, alert_level: "informational" },
  ]);
  const res = await POST(signedReq({ patient_id: "p1", vitals: { bp_systolic: 200 } }));
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.flagged, true);
  assert.equal(stub.calls.some((c) => c.url.includes("api.resend.com")), true);
});

test("alert dispatch is written to the audit trail (system actor)", async () => {
  stub.reset();
  circleMembers([
    { id: "m1", member_email: "a@x.com", member_name: "A", member_phone: null, alert_level: "informational" },
  ]);
  const res = await POST(signedReq({ patient_id: "p1", vitals: { bp_systolic: 200 } }));
  await readJson(res);
  const rows = stub.calls
    .filter((c) => c.url.includes("/rest/v1/phi_access_log") && c.method === "POST")
    .flatMap((c) => JSON.parse(c.body || "[]"));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "alert_sent");
  assert.equal(rows[0].resource_type, "alert");
  assert.equal(rows[0].actor_role, "system");
  assert.equal(rows[0].patient_id, "p1");
  assert.ok(rows[0].detail.metrics.includes("Blood Pressure"));
});

test("grade-change WITHOUT signature is rejected 401", async () => {
  stub.reset();
  circleMembers([]);
  const res = await POST(
    makeReq("https://care/api/alerts", {
      method: "POST",
      body: JSON.stringify({ patient_id: "p1", panel_grade_change: { prev_grade: "A", new_grade: "C" } }),
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 401);
});

test("grade-change WITH a valid signature is accepted", async () => {
  stub.reset();
  circleMembers([
    { id: "m1", member_email: "a@x.com", member_name: "A", member_phone: null, alert_level: "informational" },
  ]);
  const res = await POST(signedReq({ patient_id: "p1", panel_grade_change: { prev_grade: "A", new_grade: "C" } }));
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.flags[0].metric, "Longevity Panel Grade");
  assert.equal(body.flags[0].severity, "critical"); // 2-step drop A->C
});

test("grade-change with a STALE timestamp fails 401", async () => {
  stub.reset();
  circleMembers([]);
  const ts = String(Math.floor(Date.now() / 1000) - 3600); // 1h old, > 300s window
  const raw = JSON.stringify({ patient_id: "p1", panel_grade_change: { prev_grade: "A", new_grade: "B" } });
  const res = await POST(
    makeReq("https://care/api/alerts", {
      method: "POST",
      headers: { "x-alert-timestamp": ts, "x-alert-signature": sign(ts, raw) },
      body: raw,
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 401);
});

test("single-step grade drop is informational, not critical", async () => {
  stub.reset();
  circleMembers([]);
  const res = await POST(signedReq({ patient_id: "p1", panel_grade_change: { prev_grade: "A", new_grade: "B" } }));
  const { body } = await readJson(res);
  assert.equal(body.flags[0].severity, "informational");
});

test("an improving grade (C->A) produces no flag", async () => {
  stub.reset();
  circleMembers([]);
  const res = await POST(signedReq({ patient_id: "p1", panel_grade_change: { prev_grade: "C", new_grade: "A" } }));
  const { body } = await readJson(res);
  assert.equal(body.flagged, false);
});

test("critical-only members do not receive informational-only alerts", async () => {
  stub.reset();
  circleMembers([
    { id: "m1", member_email: "crit@x.com", member_name: "C", member_phone: null, alert_level: "critical" },
  ]);
  // a1c=7 is informational-only. A critical-only member should get nothing.
  const res = await POST(signedReq({ patient_id: "p1", vitals: { a1c: 7 } }));
  const { body } = await readJson(res);
  assert.equal(body.flagged, true);
  assert.equal(body.delivery.length, 0, "no email to critical-only member for an informational flag");
  const emailed = stub.calls.some((c) => c.url.includes("api.resend.com"));
  assert.equal(emailed, false);
});

test("invalid JSON body returns 400", async () => {
  stub.reset();
  circleMembers([]);
  // Signature is over the raw body; sign the malformed string so we reach the
  // JSON.parse guard rather than failing signature first.
  const raw = "{not json";
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await POST(
    makeReq("https://care/api/alerts", {
      method: "POST",
      headers: { "x-alert-timestamp": ts, "x-alert-signature": sign(ts, raw) },
      body: raw,
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 400);
});
