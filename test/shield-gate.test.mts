import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq, readJson } from "./harness.mts";

// The server-side gate is read once at module load, so proving the OFF case
// needs a process where AI_CHAT_ENABLED was never set to "true". node:test
// runs each file in its own process, which is what makes this file work.
// Credentials are deliberately present and valid-looking: the point is that
// a fully configured deployment still serves nothing while the flag is off.
delete process.env.AI_CHAT_ENABLED;
process.env.ANTHROPIC_API_KEY = "sk-test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

const { POST } = await import("../src/app/api/shield/route.ts");

const stub = new FetchStub();
stub.install();

function req(body: unknown, headers: Record<string, string> = {}) {
  return makeReq("https://cc.test/api/shield", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("AI off: an authenticated request gets 404 and never reaches a provider", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "member-1" } }));
  stub.on("api.anthropic.com", () => ({ json: { content: [{ text: "SHOULD NOT HAPPEN" }] } }));

  const res = await POST(req({ messages: [{ role: "user", content: "hello" }] }, { authorization: "Bearer good" }));
  const { status } = await readJson(res);

  assert.equal(status, 404, "the route must behave as if it does not exist");
  assert.equal(
    stub.calls.filter((c) => c.url.includes("anthropic")).length,
    0,
    "no provider call may be made while the flag is off",
  );
});

test("AI off: the gate runs before auth, so an anonymous request also gets 404", async () => {
  stub.reset();
  const res = await POST(req({ messages: [{ role: "user", content: "hello" }] }));
  const { status } = await readJson(res);
  // 404 rather than 401: a disabled route should not disclose that it would
  // otherwise have asked for credentials.
  assert.equal(status, 404);
});

test("AI off: no outbound request of any kind is made", async () => {
  stub.reset();
  await POST(req({ messages: [{ role: "user", content: "my ssn is 123-45-6789" }] }, { authorization: "Bearer good" }));
  assert.equal(stub.calls.length, 0, "the handler must return before auth, rate limiting and the provider");
});
