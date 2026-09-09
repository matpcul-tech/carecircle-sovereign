import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { FetchStub, makeReq, readJson } from "./harness.mts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
process.env.NEXT_PUBLIC_APP_URL = "https://app.test";
process.env.RESEND_API_KEY = "re_key";
process.env.VAULT_KEY_HEX = "a".repeat(64);

const change = await import("../src/app/api/auth/change-password/route.ts");
const requestReset = await import("../src/app/api/auth/request-reset/route.ts");
const reset = await import("../src/app/api/auth/reset/route.ts");
const { encryptGCM } = await import("../src/lib/vault-crypto.ts");
const { totp } = await import("../src/lib/totp.ts");

const stub = new FetchStub();
stub.install();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------------- change-password ----------------
function changeSetup(opts: { grantOk?: boolean; mfa?: { secret: string } | null } = {}) {
  const { grantOk = true, mfa = null } = opts;
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "u1", email: "fam@x.com", user_metadata: { full_name: "Fam Member" } } }));
  stub.on("/rest/v1/rpc/rate_limit_hit", () => ({ json: true }));
  stub.on("/auth/v1/token", () => (grantOk ? { json: { access_token: "x" } } : { status: 400, json: { error: "bad" } }));
  stub.on("/rest/v1/user_mfa", () => {
    if (!mfa) return { json: [] };
    const enc = encryptGCM(Buffer.from(mfa.secret, "utf8"));
    return { json: [{ secret_cipher: enc.ciphertext.toString("base64"), secret_iv: enc.ivBase64, enabled: true, backup_codes: [] }] };
  });
  stub.on("/auth/v1/admin/users/", (c) => (c.method === "PUT" ? { json: {} } : undefined));
}

function changeReq(body: unknown) {
  return makeReq("https://care/api/auth/change-password", {
    method: "POST",
    headers: { authorization: "Bearer good", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("change-password: wrong current password is rejected 401", async () => {
  changeSetup({ grantOk: false });
  const res = await change.POST(changeReq({ current_password: "wrong", new_password: "Str0ng-New-Pass!" }));
  const { status, body } = await readJson(res);
  assert.equal(status, 401);
  assert.match(body.error, /current password/);
});

test("change-password: weak new password is rejected 400 (policy)", async () => {
  changeSetup();
  const res = await change.POST(changeReq({ current_password: "old", new_password: "short" }));
  assert.equal((await readJson(res)).status, 400);
});

test("change-password: new equal to current is rejected 400", async () => {
  changeSetup();
  const res = await change.POST(changeReq({ current_password: "Str0ng-Same-Pass!", new_password: "Str0ng-Same-Pass!" }));
  const { status, body } = await readJson(res);
  assert.equal(status, 400);
  assert.match(body.error, /differ/);
});

test("change-password: success updates via admin API", async () => {
  changeSetup();
  const res = await change.POST(changeReq({ current_password: "old-pass", new_password: "Str0ng-New-Pass!" }));
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  const put = stub.calls.find((c) => c.method === "PUT" && c.url.includes("/auth/v1/admin/users/u1"));
  assert.ok(put, "password must be updated through the admin API");
});

test("change-password: with MFA on, missing/invalid code is rejected 401", async () => {
  const secret = "JBSWY3DPEHPK3PXP";
  changeSetup({ mfa: { secret } });
  const res = await change.POST(changeReq({ current_password: "old", new_password: "Str0ng-New-Pass!", code: "000000" }));
  const { status, body } = await readJson(res);
  assert.equal(status, 401);
  assert.match(body.error, /two-factor/);
});

test("change-password: with MFA on, a valid code succeeds", async () => {
  const secret = "JBSWY3DPEHPK3PXP";
  changeSetup({ mfa: { secret } });
  const res = await change.POST(changeReq({ current_password: "old", new_password: "Str0ng-New-Pass!", code: totp(secret, Date.now()) }));
  assert.equal((await readJson(res)).status, 200);
});

// ---------------- request-reset ----------------
function reqResetSetup(found: boolean, opts: { emailLimit?: boolean } = {}) {
  stub.reset();
  stub.on("/rest/v1/rpc/rate_limit_hit", (c) => {
    const key = JSON.parse(c.body || "{}").p_key as string;
    if (opts.emailLimit === false && key.startsWith("reset-req-email:")) return { json: false };
    return { json: true };
  });
  stub.on("/rest/v1/care_circle?member_email", () => ({ json: found ? [{ member_user_id: "u1", member_name: "Fam" }] : [] }));
  stub.on("/rest/v1/password_reset_tokens", () => ({ json: {} }));
  stub.on("api.resend.com", () => ({ json: { id: "email_1" } }));
}

function reqResetReq(email = "fam@x.com") {
  return makeReq("https://care/api/auth/request-reset", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "1.1.1.1" },
    body: JSON.stringify({ email }),
  });
}

test("request-reset: known email mints a token and emails a /reset link", async () => {
  reqResetSetup(true);
  const res = await requestReset.POST(reqResetReq());
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.match(body.message, /reset link/i);
  assert.ok(stub.calls.some((c) => c.method === "POST" && c.url.endsWith("/password_reset_tokens")));
  const mail = stub.calls.find((c) => c.url.includes("api.resend.com"));
  assert.ok(mail, "an email must be sent");
  assert.match(JSON.parse(mail!.body || "{}").html, /\/reset\?token=/);
});

test("request-reset: unknown email returns the SAME generic message, no token, no email", async () => {
  reqResetSetup(false);
  const res = await requestReset.POST(reqResetReq("nobody@x.com"));
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.match(body.message, /If an account exists/i);
  assert.equal(stub.calls.some((c) => c.method === "POST" && c.url.endsWith("/password_reset_tokens")), false);
  assert.equal(stub.calls.some((c) => c.url.includes("api.resend.com")), false);
});

test("request-reset: over the per-email limit still returns generic, no token", async () => {
  reqResetSetup(true, { emailLimit: false });
  const res = await requestReset.POST(reqResetReq());
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.match(body.message, /If an account exists/i);
  assert.equal(stub.calls.some((c) => c.method === "POST" && c.url.endsWith("/password_reset_tokens")), false);
});

// ---------------- reset (consume) ----------------
function resetSetup(token: string) {
  const state = { used: false };
  const hash = sha256(token);
  stub.reset();
  stub.on("/rest/v1/rpc/rate_limit_hit", () => ({ json: true }));
  stub.on("/rest/v1/password_reset_tokens", (c) => {
    const matches = c.url.includes(`token_hash=eq.${hash}`);
    if (c.method === "GET") return { json: matches && !state.used ? [{ user_id: "u1", email: "fam@x.com" }] : [] };
    if (c.method === "PATCH") {
      if (matches && !state.used) { state.used = true; return { json: [{ user_id: "u1" }] }; }
      return { json: [] };
    }
    return undefined;
  });
  stub.on("/auth/v1/admin/users/", (c) => (c.method === "PUT" ? { json: {} } : undefined));
  return state;
}

function resetReq(token: string, pw: string) {
  return makeReq("https://care/api/auth/reset", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "2.2.2.2" },
    body: JSON.stringify({ token, new_password: pw }),
  });
}

test("reset: an unknown/expired token is rejected 400", async () => {
  resetSetup("realtoken");
  const res = await reset.POST(resetReq("wrongtoken", "Str0ng-New-Pass!"));
  const { status, body } = await readJson(res);
  assert.equal(status, 400);
  assert.match(body.error, /invalid or expired/);
});

test("reset: a weak password is rejected 400 and does NOT burn the token", async () => {
  const state = resetSetup("tok-abc");
  const res = await reset.POST(resetReq("tok-abc", "weak"));
  assert.equal((await readJson(res)).status, 400);
  assert.equal(state.used, false, "token must survive a rejected weak password");
  // A follow-up with a strong password then succeeds.
  const ok = await reset.POST(resetReq("tok-abc", "Str0ng-New-Pass!"));
  assert.equal((await readJson(ok)).status, 200);
  assert.equal(state.used, true);
});

test("reset: success updates the password and is single-use", async () => {
  const state = resetSetup("tok-xyz");
  const first = await reset.POST(resetReq("tok-xyz", "Str0ng-New-Pass!"));
  assert.equal((await readJson(first)).status, 200);
  assert.equal(state.used, true);
  const put = stub.calls.find((c) => c.method === "PUT" && c.url.includes("/auth/v1/admin/users/u1"));
  assert.ok(put);
  // Reusing the same token is rejected.
  const second = await reset.POST(resetReq("tok-xyz", "An0ther-Good-Pass!"));
  const { status, body } = await readJson(second);
  assert.equal(status, 400);
  assert.match(body.error, /already been used|invalid or expired/);
});
