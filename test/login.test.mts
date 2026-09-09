import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq, readJson } from "./harness.mts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
process.env.VAULT_KEY_HEX = "a".repeat(64);

const { POST } = await import("../src/app/api/auth/login/route.ts");

const stub = new FetchStub();
stub.install();

// Options: whether the password grant succeeds, whether the user has MFA, and
// how the rate limiter responds per key.
function setup(opts: {
  grantOk?: boolean;
  mfaEnabled?: boolean;
  limit?: (key: string) => boolean; // return false to signal "over limit"
} = {}) {
  const { grantOk = true, mfaEnabled = false, limit } = opts;
  stub.reset();
  stub.on("/rest/v1/rpc/rate_limit_hit", (c) => {
    const key = JSON.parse(c.body || "{}").p_key as string;
    return { json: limit ? limit(key) : true };
  });
  stub.on("/auth/v1/token", () =>
    grantOk
      ? { json: { access_token: "AT", refresh_token: "RT", expires_at: 999, user: { id: "member-1" } } }
      : { status: 400, json: { error: "invalid_grant", error_description: "Invalid login credentials" } },
  );
  stub.on("/rest/v1/user_mfa", (c) =>
    c.method === "GET"
      ? { json: mfaEnabled ? [{ enabled: true, secret_cipher: "x", secret_iv: "y", backup_codes: [] }] : [] }
      : { json: {} },
  );
  stub.on("/rest/v1/care_circle?member_user_id", () => ({ json: [{ patient_id: "patient-1", patient_name: "Mary" }] }));
}

function loginReq(email = "fam@x.com", password = "secretpassword", ip = "1.1.1.1") {
  return makeReq("https://care/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ email, password }),
  });
}

test("successful non-MFA login returns session + circle", async () => {
  setup({ grantOk: true, mfaEnabled: false });
  const { status, body } = await readJson(await POST(loginReq()));
  assert.equal(status, 200);
  assert.equal(body.mfa_required, false);
  assert.equal(body.session.access_token, "AT");
  assert.equal(body.circle.patient_id, "patient-1");
});

test("bad credentials return a GENERIC 401 (no user enumeration)", async () => {
  setup({ grantOk: false });
  const { status, body } = await readJson(await POST(loginReq()));
  assert.equal(status, 401);
  assert.equal(body.error, "invalid email or password");
  // Must not leak Supabase's specific reason.
  assert.doesNotMatch(JSON.stringify(body), /invalid_grant|Invalid login credentials/i);
});

test("MFA-enabled account WITHHOLDS the session and returns an mfa_token", async () => {
  setup({ grantOk: true, mfaEnabled: true });
  const { status, body } = await readJson(await POST(loginReq()));
  assert.equal(status, 200);
  assert.equal(body.mfa_required, true);
  assert.ok(typeof body.mfa_token === "string" && body.mfa_token.includes("."));
  assert.equal(body.session, undefined, "session must not be returned before the second factor");
});

test("per-email lockout returns 429 and never calls the token endpoint", async () => {
  setup({ limit: (key) => !key.startsWith("login-fail:") }); // fail-key over limit
  const { status, body } = await readJson(await POST(loginReq()));
  assert.equal(status, 429);
  assert.match(body.error, /locked/i);
  assert.equal(stub.calls.some((c) => c.url.includes("/auth/v1/token")), false);
});

test("per-IP flood returns 429 before anything else", async () => {
  setup({ limit: (key) => !key.startsWith("login-ip:") });
  const { status, body } = await readJson(await POST(loginReq()));
  assert.equal(status, 429);
  assert.match(body.error, /too many attempts/i);
  assert.equal(stub.calls.some((c) => c.url.includes("/auth/v1/token")), false);
});

test("successful login clears the failure counter (reset DELETE issued)", async () => {
  setup({ grantOk: true });
  await readJson(await POST(loginReq("fam@x.com")));
  const reset = stub.calls.find(
    (c) => c.method === "DELETE" && c.url.includes("/rest/v1/rate_limits?key=eq.login-fail%3Afam%40x.com"),
  );
  assert.ok(reset, "a successful login should reset the per-email failure counter");
});

test("invalid email shape is rejected 400 before any grant", async () => {
  setup();
  const { status } = await readJson(await POST(loginReq("not-an-email")));
  assert.equal(status, 400);
  assert.equal(stub.calls.some((c) => c.url.includes("/auth/v1/token")), false);
});
