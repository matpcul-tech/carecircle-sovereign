import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq, readJson } from "./harness.mts";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

const { POST } = await import("../src/app/api/circle/update-nickname/route.ts");

const stub = new FetchStub();
stub.install();

function withAuthedUser(userId: string | null) {
  stub.reset();
  stub.on("/auth/v1/user", () => (userId ? { json: { id: userId } } : { status: 401, text: "bad token" }));
  stub.on("/rest/v1/care_circle?member_user_id", (c) => {
    // Echo back the patched nickname so we can assert on clamping.
    const patched = JSON.parse(c.body || "{}").patient_nickname;
    return { json: [{ patient_nickname: patched }] };
  });
}

test("requires a Bearer token (401 without one)", async () => {
  withAuthedUser("u1");
  const res = await POST(makeReq("https://care/api/circle/update-nickname", { method: "POST", body: JSON.stringify({ nickname: "Mom" }) }));
  const { status } = await readJson(res);
  assert.equal(status, 401);
});

test("rejects an invalid token (401)", async () => {
  withAuthedUser(null);
  const res = await POST(
    makeReq("https://care/api/circle/update-nickname", {
      method: "POST",
      headers: { authorization: "Bearer bad" },
      body: JSON.stringify({ nickname: "Mom" }),
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 401);
});

test("updates own row and scopes the PATCH to member_user_id", async () => {
  withAuthedUser("u1");
  const res = await POST(
    makeReq("https://care/api/circle/update-nickname", {
      method: "POST",
      headers: { authorization: "Bearer good" },
      body: JSON.stringify({ nickname: "Grandma Mary" }),
    }),
  );
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.nickname, "Grandma Mary");
  const patch = stub.calls.find((c) => c.method === "PATCH")!;
  assert.match(patch.url, /member_user_id=eq\.u1/, "PATCH must be scoped to the caller's own row");
});

test("clamps nickname to 60 chars", async () => {
  withAuthedUser("u1");
  const long = "x".repeat(200);
  const res = await POST(
    makeReq("https://care/api/circle/update-nickname", {
      method: "POST",
      headers: { authorization: "Bearer good" },
      body: JSON.stringify({ nickname: long }),
    }),
  );
  const { body } = await readJson(res);
  assert.equal(body.nickname.length, 60);
});

test("empty/whitespace nickname normalizes to null", async () => {
  withAuthedUser("u1");
  const res = await POST(
    makeReq("https://care/api/circle/update-nickname", {
      method: "POST",
      headers: { authorization: "Bearer good" },
      body: JSON.stringify({ nickname: "   " }),
    }),
  );
  const { body } = await readJson(res);
  assert.equal(body.nickname, null);
});

test("invalid JSON body returns 400", async () => {
  withAuthedUser("u1");
  const res = await POST(
    makeReq("https://care/api/circle/update-nickname", {
      method: "POST",
      headers: { authorization: "Bearer good" },
      body: "{bad",
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 400);
});

test("404 when the caller has no care_circle row", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "u1" } }));
  stub.on("/rest/v1/care_circle?member_user_id", () => ({ json: [] }));
  const res = await POST(
    makeReq("https://care/api/circle/update-nickname", {
      method: "POST",
      headers: { authorization: "Bearer good" },
      body: JSON.stringify({ nickname: "Mom" }),
    }),
  );
  const { status } = await readJson(res);
  assert.equal(status, 404);
});
