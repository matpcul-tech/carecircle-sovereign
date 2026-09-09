import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq, readJson } from "./harness.mts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
process.env.ANTHROPIC_API_KEY = "sk-test";

const shield = await import("../src/app/api/shield/route.ts");
const redeem = await import("../src/app/api/circle/redeem/route.ts");

const stub = new FetchStub();
stub.install();

const AUTH = { authorization: "Bearer good" };
function shieldReady() {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "member-1" } }));
  stub.on("api.anthropic.com", () => ({ json: { content: [{ text: "ok" }] } }));
}
function shieldReq(content: string) {
  return makeReq("https://care/api/shield", {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ messages: [{ role: "user", content }] }),
  });
}

// F1 fix verification. The old serverScan() sanitized via
// `matches.forEach(m => sanitized.replace(m, token))` — O(matches x length),
// quadratic on date-dense input — and /api/shield had no input cap, so a
// ~250 KB anonymous body pinned a CPU for tens of seconds. The fix caps each
// message to 8000 chars and does one linear regex.replace() per pattern.
// This test asserts the blowup is gone: even a 1 MB date-dense body returns
// quickly and stays well under any human-perceptible ceiling.
test("F1 fixed: date-dense 1 MB body scans fast (no quadratic DoS)", async () => {
  shieldReady();
  const t = Date.now();
  const res = await shield.POST(shieldReq("12/34/".repeat(170_000))); // ~1 MB
  const { status } = await readJson(res);
  const elapsed = Date.now() - t;
  assert.equal(status, 200);
  assert.ok(elapsed < 250, `scan took ${elapsed}ms — expected fast, bounded work`);
});

test("F1 fixed: 200 large date-dense requests stay fast in aggregate", async () => {
  shieldReady();
  const t = Date.now();
  for (let i = 0; i < 200; i++) {
    const res = await shield.POST(shieldReq("01/02/1990 ".repeat(5000)));
    await readJson(res);
  }
  const elapsed = Date.now() - t;
  assert.ok(elapsed < 3000, `200 requests took ${elapsed}ms — expected bounded per-request work`);
});

test("STRESS: shield stays correct across 500 mixed-PII messages", async () => {
  shieldReady();
  for (let i = 0; i < 500; i++) {
    const res = await shield.POST(shieldReq(`patient ${i} ssn 111-22-3333 dob: 01/02/1944`));
    const { body } = await readJson(res);
    assert.ok(body.shield.flags.includes("SSN"));
    assert.ok(body.shield.riskScore >= 40);
  }
});

test("F5 fixed (TOCTOU): concurrent redemptions of one code — exactly one wins", async () => {
  stub.reset();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  let usersCreated = 0;
  let circleRows = 0;
  // Model the DB-enforced atomic claim: the invite lookup always shows the
  // row as unused (both requests pass the friendly inviteUsable() check), but
  // the conditional "used_at IS NULL" claim PATCH succeeds only ONCE. The
  // first claim returns a row (winner); every later claim returns [] (loser).
  let claimed = false;
  stub
    .on("care_circle_invites?code", () => ({
      json: [
        {
          id: "inv1",
          code: "ABCDEFGH",
          patient_id: "patient-1",
          patient_name: "Mary",
          suggested_relationship: "Daughter",
          suggested_alert_level: "informational",
          expires_at: future,
          used_at: null,
          revoked_at: null,
        },
      ],
    }))
    .on("care_circle_invites?id", (c) => {
      // Only the conditional claim (used_at set to a timestamp) is gated.
      if (c.method === "PATCH" && (c.body || "").includes('"used_at":"')) {
        if (claimed) return { json: [] }; // already claimed -> loser
        claimed = true;
        return { json: [{ id: "inv1" }] }; // winner
      }
      return { json: [{ id: "inv1" }] };
    })
    .on("/auth/v1/admin/users", (c) => {
      if (c.method === "POST") {
        usersCreated++;
        return { json: { id: `user-${usersCreated}`, email: "f@x.com" } };
      }
      return undefined;
    })
    .on("/rest/v1/care_circle", (c) => {
      if (c.method === "POST") {
        circleRows++;
        return { json: [{ id: `cc-${circleRows}`, patient_id: "patient-1" }] };
      }
      return undefined;
    })
    .on("/auth/v1/token", () => ({ json: { access_token: "at", refresh_token: "rt", expires_at: 999 } }));

  const mk = (email: string) =>
    redeem.POST(
      makeReq("https://care/api/circle/redeem", {
        method: "POST",
        body: JSON.stringify({ code: "ABCDEFGH", email, password: "Str0ng-Passphrase!", member_name: "Fam" }),
      }),
    );

  const [r1, r2] = await Promise.all([mk("a@x.com"), mk("b@x.com")]);
  const statuses = [(await readJson(r1)).status, (await readJson(r2)).status].sort();

  // Exactly one 200 and one 410 — the loser is rejected before creating an account.
  assert.deepEqual(statuses, [200, 410], "one redemption succeeds, the other is rejected 410");
  assert.equal(usersCreated, 1, "single-use invite must create exactly one account");
  assert.equal(circleRows, 1, "single-use invite must produce exactly one circle membership");
});
