import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq, readJson } from "./harness.mts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

const { checkRateLimit, clientIp, tooManyRequests } = await import("../src/lib/rate-limit.ts");

const stub = new FetchStub();
stub.install();

const RULE = { name: "test", max: 5, windowSeconds: 60 };

test("checkRateLimit: allowed when the limiter returns true", async () => {
  stub.reset();
  stub.on("/rest/v1/rpc/rate_limit_hit", () => ({ json: true }));
  assert.equal(await checkRateLimit(RULE, "k1"), true);
});

test("checkRateLimit: denied when the limiter returns false", async () => {
  stub.reset();
  stub.on("/rest/v1/rpc/rate_limit_hit", () => ({ json: false }));
  assert.equal(await checkRateLimit(RULE, "k1"), false);
});

test("checkRateLimit: passes the composed key and rule params to the RPC", async () => {
  stub.reset();
  stub.on("/rest/v1/rpc/rate_limit_hit", () => ({ json: true }));
  await checkRateLimit(RULE, "user-9");
  const call = stub.calls.find((c) => c.url.includes("rate_limit_hit"))!;
  const body = JSON.parse(call.body || "{}");
  assert.equal(body.p_key, "test:user-9");
  assert.equal(body.p_max, 5);
  assert.equal(body.p_window_seconds, 60);
});

test("checkRateLimit: fail-open when the limiter errors", async () => {
  stub.reset();
  stub.on("/rest/v1/rpc/rate_limit_hit", () => ({ status: 500, text: "boom" }));
  assert.equal(await checkRateLimit(RULE, "k1"), true);
});

test("clientIp: first x-forwarded-for hop, else fallback bucket", () => {
  assert.equal(
    clientIp(makeReq("https://x", { headers: { "x-forwarded-for": "3.3.3.3, 4.4.4.4" } })),
    "3.3.3.3",
  );
  assert.equal(clientIp(makeReq("https://x")), "noip");
});

test("tooManyRequests: 429 with Retry-After", async () => {
  const res = tooManyRequests(RULE);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "60");
  const { body } = await readJson(res);
  assert.match(body.error, /rate limit/);
});
