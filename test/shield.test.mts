import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq, readJson } from "./harness.mts";

process.env.ANTHROPIC_API_KEY = "sk-test";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

const { POST } = await import("../src/app/api/shield/route.ts");

const stub = new FetchStub();
stub.install();

const AUTH = { authorization: "Bearer good" };

// Default stub: a valid authenticated user + an echoing Anthropic endpoint.
function ready() {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "member-1" } }));
  stub.on("api.anthropic.com", (c) => {
    const sent = JSON.parse(c.body || "{}");
    const last = sent.messages[sent.messages.length - 1]?.content ?? "";
    return { json: { content: [{ text: `ECHO:${last}` }] } };
  });
}

function shieldReq(bodyObj: unknown, headers: Record<string, string> = AUTH) {
  return makeReq("https://care/api/shield", {
    method: "POST",
    headers,
    body: JSON.stringify(bodyObj),
  });
}

test("SECURITY (F2 fixed): anonymous request is rejected 401, never reaches the LLM", async () => {
  ready();
  const res = await POST(shieldReq({ messages: [{ role: "user", content: "hello" }] }, {}));
  const { status } = await readJson(res);
  assert.equal(status, 401);
  assert.equal(stub.calls.some((c) => c.url.includes("api.anthropic.com")), false);
});

test("SECURITY (F2 fixed): an invalid token is rejected 401", async () => {
  stub.reset();
  stub.on("/auth/v1/user", () => ({ status: 401, text: "bad token" }));
  const res = await POST(shieldReq({ messages: [{ role: "user", content: "hi" }] }));
  const { status } = await readJson(res);
  assert.equal(status, 401);
});

test("rate limit: over-limit user gets 429 and never reaches the model", async () => {
  ready();
  stub.on("/rest/v1/rpc/rate_limit_hit", () => ({ json: false })); // limiter says: denied
  const res = await POST(shieldReq({ messages: [{ role: "user", content: "hi" }], patientId: "p1" }));
  const { status } = await readJson(res);
  assert.equal(status, 429);
  assert.equal(stub.calls.some((c) => c.url.includes("api.anthropic.com")), false);
});

test("SSN is redacted before reaching the model", async () => {
  ready();
  const res = await POST(shieldReq({ messages: [{ role: "user", content: "My SSN is 123-45-6789" }], patientId: "p1" }));
  const { body } = await readJson(res);
  assert.match(body.content, /\[SSN_PROTECTED\]/);
  assert.doesNotMatch(body.content, /123-45-6789/);
  assert.equal(body.shield.action, "PII_REDACTED");
  assert.ok(body.shield.flags.includes("SSN"));
});

test("clean text passes through and is marked CLEAN_PASS", async () => {
  ready();
  const res = await POST(shieldReq({ messages: [{ role: "user", content: "How do I refill a prescription?" }] }));
  const { body } = await readJson(res);
  assert.equal(body.shield.action, "CLEAN_PASS");
  assert.equal(body.shield.flags.length, 0);
});

test("F6 fixed: PII in earlier (non-last) messages IS sanitized", async () => {
  ready();
  const res = await POST(
    shieldReq({
      messages: [
        { role: "user", content: "Her SSN is 987-65-4321" }, // earlier turn
        { role: "assistant", content: "Noted." },
        { role: "user", content: "Thanks" },
      ],
    }),
  );
  await readJson(res);
  const llmCall = stub.calls.find((c) => c.url.includes("api.anthropic.com"))!;
  const sentMessages = JSON.parse(llmCall.body || "{}").messages;
  const firstContent = sentMessages[0].content;
  assert.doesNotMatch(firstContent, /987-65-4321/, "SSN in a prior turn must be redacted");
  assert.match(firstContent, /\[SSN_PROTECTED\]/);
});

test("empty/missing messages array returns 400 (not a crash)", async () => {
  ready();
  const res = await POST(shieldReq({ patientId: "p1" }));
  const { status, body } = await readJson(res);
  assert.equal(status, 400);
  assert.ok(body.error);
});

test("risk score is capped at 100", async () => {
  ready();
  const flood = Array.from({ length: 20 }, (_, i) => `1${String(i).padStart(2, "0")}-45-6789`).join(" ");
  const res = await POST(shieldReq({ messages: [{ role: "user", content: flood }] }));
  const { body } = await readJson(res);
  assert.ok(body.shield.riskScore <= 100);
});

function auditRows() {
  return stub.calls
    .filter((c) => c.url.includes("/rest/v1/phi_access_log") && c.method === "POST")
    .flatMap((c) => JSON.parse(c.body || "[]"));
}

test("AI query is written to the audit trail with patient + actor", async () => {
  ready();
  const res = await POST(shieldReq({ messages: [{ role: "user", content: "refill?" }], patientId: "patient-1" }));
  await readJson(res);
  const rows = auditRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "ai_query");
  assert.equal(rows[0].resource_type, "ai_chat");
  assert.equal(rows[0].patient_id, "patient-1");
  assert.equal(rows[0].actor_user_id, "member-1");
});

test("AI query with no patientId is not patient-scoped-audited (table requires patient_id)", async () => {
  ready();
  const res = await POST(shieldReq({ messages: [{ role: "user", content: "hi" }] }));
  await readJson(res);
  assert.equal(auditRows().length, 0);
});

test("message content is truncated to the 8000-char cap before the LLM call", async () => {
  ready();
  const res = await POST(shieldReq({ messages: [{ role: "user", content: "a".repeat(50_000) }] }));
  await readJson(res);
  const llmCall = stub.calls.find((c) => c.url.includes("api.anthropic.com"))!;
  const sent = JSON.parse(llmCall.body || "{}").messages;
  assert.ok(sent[sent.length - 1].content.length <= 8000);
});
