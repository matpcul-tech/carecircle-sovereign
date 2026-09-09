import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq, readJson } from "./harness.mts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
process.env.VAULT_KEY_HEX = "a".repeat(64);

const enroll = await import("../src/app/api/auth/mfa/enroll/route.ts");
const activate = await import("../src/app/api/auth/mfa/activate/route.ts");
const status = await import("../src/app/api/auth/mfa/status/route.ts");
const disable = await import("../src/app/api/auth/mfa/disable/route.ts");
const loginVerify = await import("../src/app/api/auth/mfa/login-verify/route.ts");
const { totp } = await import("../src/lib/totp.ts");
const { encodeMfaToken } = await import("../src/lib/mfa.ts");

const stub = new FetchStub();
stub.install();

const AUTH = { authorization: "Bearer good", "content-type": "application/json" };

// Model the single user_mfa row (per user) that the DB would hold.
function setup(userId = "member-1") {
  const state: { row: Record<string, unknown> | null } = { row: null };
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: userId } }));
  stub.on("/rest/v1/rpc/rate_limit_hit", () => ({ json: true }));
  stub.on("/rest/v1/user_mfa", (c) => {
    if (c.method === "GET") return { json: state.row ? [state.row] : [] };
    if (c.method === "POST") {
      state.row = { ...(JSON.parse(c.body || "[]")[0] || {}) };
      return { json: {} };
    }
    if (c.method === "PATCH") {
      state.row = { ...(state.row || {}), ...JSON.parse(c.body || "{}") };
      return { json: {} };
    }
    if (c.method === "DELETE") {
      state.row = null;
      return { json: {} };
    }
    return undefined;
  });
  return state;
}

function req(body?: unknown, method = "POST") {
  return makeReq("https://care/api/auth/mfa", {
    method,
    headers: AUTH,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test("full enroll -> activate -> status flow with a real TOTP code", async () => {
  setup();
  // 1. enroll
  const eRes = await enroll.POST(req());
  const e = await readJson(eRes);
  assert.equal(e.status, 200);
  assert.match(e.body.otpauth_uri, /^otpauth:\/\/totp\//);
  const secret = e.body.secret as string;

  // 2. activate with the current code
  const code = totp(secret, Date.now());
  const aRes = await activate.POST(req({ code }));
  const a = await readJson(aRes);
  assert.equal(a.status, 200);
  assert.equal(a.body.backup_codes.length, 10);

  // 3. status reflects enabled
  const sRes = await status.GET(req(undefined, "GET"));
  const s = await readJson(sRes);
  assert.equal(s.body.enabled, true);
  assert.equal(s.body.backup_codes_remaining, 10);
});

test("activate rejects a wrong code (401) and stays disabled", async () => {
  setup();
  await enroll.POST(req());
  const aRes = await activate.POST(req({ code: "000000" }));
  assert.equal((await readJson(aRes)).status, 401);
  const s = await readJson(await status.GET(req(undefined, "GET")));
  assert.equal(s.body.enabled, false);
});

test("enroll is blocked (409) when MFA is already enabled", async () => {
  const state = setup();
  const e = await readJson(await enroll.POST(req()));
  await activate.POST(req({ code: totp(e.body.secret, Date.now()) }));
  assert.equal(state.row!.enabled, true);
  const again = await enroll.POST(req());
  assert.equal((await readJson(again)).status, 409);
});

test("login-verify accepts a valid TOTP and returns the withheld session", async () => {
  const state = setup();
  const e = await readJson(await enroll.POST(req()));
  const secret = e.body.secret as string;
  await activate.POST(req({ code: totp(secret, Date.now()) }));

  const token = encodeMfaToken({
    user_id: "member-1",
    session: { access_token: "AT", refresh_token: "RT", expires_at: 999, user_id: "member-1" },
    circle: { patient_id: "patient-1", patient_name: "Mary" },
    exp: Math.floor(Date.now() / 1000) + 300,
  });

  const okRes = await loginVerify.POST(
    makeReq("https://care/api/auth/mfa/login-verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mfa_token: token, code: totp(secret, Date.now()) }),
    }),
  );
  const ok = await readJson(okRes);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.session.access_token, "AT");
  assert.equal(ok.body.circle.patient_id, "patient-1");
  assert.ok(state.row); // still enabled
});

test("login-verify rejects a wrong code (401)", async () => {
  const state = setup();
  const e = await readJson(await enroll.POST(req()));
  await activate.POST(req({ code: totp(e.body.secret, Date.now()) }));
  const token = encodeMfaToken({
    user_id: "member-1",
    session: {},
    circle: null,
    exp: Math.floor(Date.now() / 1000) + 300,
  });
  const res = await loginVerify.POST(
    makeReq("https://care/api/auth/mfa/login-verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mfa_token: token, code: "000000" }),
    }),
  );
  assert.equal((await readJson(res)).status, 401);
  void state;
});

test("login-verify rejects an expired mfa_token (401)", async () => {
  setup();
  const token = encodeMfaToken({
    user_id: "member-1",
    session: {},
    circle: null,
    exp: Math.floor(Date.now() / 1000) - 10, // already expired
  });
  const res = await loginVerify.POST(
    makeReq("https://care/api/auth/mfa/login-verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mfa_token: token, code: "123456" }),
    }),
  );
  const r = await readJson(res);
  assert.equal(r.status, 401);
  assert.match(r.body.error, /expired|invalid session/i);
});

test("a one-time backup code works once and is then consumed", async () => {
  const state = setup();
  const e = await readJson(await enroll.POST(req()));
  const secret = e.body.secret as string;
  const act = await readJson(await activate.POST(req({ code: totp(secret, Date.now()) })));
  const backup = act.body.backup_codes[0] as string;

  const token = () =>
    encodeMfaToken({
      user_id: "member-1",
      session: { access_token: "AT" },
      circle: null,
      exp: Math.floor(Date.now() / 1000) + 300,
    });

  // First use: accepted.
  const first = await readJson(
    await loginVerify.POST(
      makeReq("https://care/api/auth/mfa/login-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mfa_token: token(), code: backup }),
      }),
    ),
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.used_backup_code, true);

  // Second use of the same backup code: rejected (consumed).
  const second = await readJson(
    await loginVerify.POST(
      makeReq("https://care/api/auth/mfa/login-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mfa_token: token(), code: backup }),
      }),
    ),
  );
  assert.equal(second.status, 401);
  void state;
});

test("disable requires a valid code; wrong code is rejected", async () => {
  const state = setup();
  const e = await readJson(await enroll.POST(req()));
  const secret = e.body.secret as string;
  await activate.POST(req({ code: totp(secret, Date.now()) }));

  assert.equal((await readJson(await disable.POST(req({ code: "000000" })))).status, 401);
  assert.ok(state.row); // still enabled

  const good = await disable.POST(req({ code: totp(secret, Date.now()) }));
  assert.equal((await readJson(good)).status, 200);
  assert.equal(state.row, null); // removed
});
