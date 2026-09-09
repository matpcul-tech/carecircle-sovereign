import test from "node:test";
import assert from "node:assert/strict";
import { FetchStub, makeReq, readJson } from "./harness.mts";

const { chatComplete, llmConfigError } = await import("../src/lib/providers/llm.ts");
const { sendEmail } = await import("../src/lib/providers/email.ts");
const { sendSms } = await import("../src/lib/providers/sms.ts");

const stub = new FetchStub();
stub.install();

// Snapshot/restore the env keys these providers read.
const ENV_KEYS = [
  "LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "ANTHROPIC_API_KEY",
  "EMAIL_PROVIDER", "RESEND_API_KEY", "RESEND_FROM_EMAIL", "EMAIL_WEBHOOK_URL", "EMAIL_WEBHOOK_TOKEN",
  "SMS_PROVIDER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER", "SMS_WEBHOOK_URL",
];
function resetEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

// ---------------- LLM ----------------
test("LLM anthropic (default): system top-level, no system in messages, parses content", async () => {
  resetEnv();
  process.env.ANTHROPIC_API_KEY = "sk-ant";
  stub.reset();
  stub.on("api.anthropic.com", (c) => {
    const b = JSON.parse(c.body || "{}");
    return { json: { content: [{ text: `A:${b.system}|${b.messages.length}` }] } };
  });
  const out = await chatComplete({
    system: "SYS",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 100,
  });
  assert.equal(out.provider, "anthropic");
  const call = stub.calls.find((c) => c.url.includes("api.anthropic.com"))!;
  const body = JSON.parse(call.body || "{}");
  assert.equal(body.system, "SYS");
  assert.equal(body.messages.every((m: any) => m.role !== "system"), true);
  assert.equal(out.text, "A:SYS|1");
});

test("LLM openai-compatible (local model): posts to BASE/chat/completions with system as first message", async () => {
  resetEnv();
  process.env.LLM_PROVIDER = "openai";
  process.env.LLM_BASE_URL = "http://localhost:11434/v1";
  process.env.LLM_MODEL = "llama3.1";
  stub.reset();
  stub.on("/chat/completions", (c) => {
    const b = JSON.parse(c.body || "{}");
    return { json: { choices: [{ message: { content: `LOCAL:${b.model}:${b.messages[0].role}` } }] } };
  });
  const out = await chatComplete({ system: "SYS", messages: [{ role: "user", content: "hi" }] });
  assert.equal(out.provider, "openai");
  assert.equal(out.model, "llama3.1");
  const call = stub.calls.find((c) => c.url.includes("/chat/completions"))!;
  assert.equal(call.url, "http://localhost:11434/v1/chat/completions");
  const body = JSON.parse(call.body || "{}");
  assert.equal(body.messages[0].role, "system"); // system folded into messages
  assert.equal(body.messages[0].content, "SYS");
  assert.equal(out.text, "LOCAL:llama3.1:system");
});

test("LLM openai sends a bearer token only when LLM_API_KEY is set", async () => {
  resetEnv();
  process.env.LLM_PROVIDER = "openai";
  process.env.LLM_BASE_URL = "http://gpu.internal/v1";
  process.env.LLM_API_KEY = "local-secret";
  stub.reset();
  stub.on("/chat/completions", () => ({ json: { choices: [{ message: { content: "ok" } }] } }));
  await chatComplete({ messages: [{ role: "user", content: "x" }] });
  const call = stub.calls.find((c) => c.url.includes("/chat/completions"))!;
  assert.equal(call.headers["authorization"] || call.headers["Authorization"], "Bearer local-secret");
});

test("llmConfigError flags each misconfiguration", () => {
  resetEnv();
  process.env.LLM_PROVIDER = "anthropic";
  assert.match(llmConfigError()!, /ANTHROPIC_API_KEY/);
  process.env.ANTHROPIC_API_KEY = "sk";
  assert.equal(llmConfigError(), null);

  resetEnv();
  process.env.LLM_PROVIDER = "openai";
  assert.match(llmConfigError()!, /LLM_BASE_URL/);
  process.env.LLM_BASE_URL = "http://x/v1";
  assert.equal(llmConfigError(), null);

  resetEnv();
  process.env.LLM_PROVIDER = "bogus";
  assert.match(llmConfigError()!, /unknown LLM_PROVIDER/);
});

// ---------------- Email ----------------
test("email resend (default) posts to Resend", async () => {
  resetEnv();
  process.env.RESEND_API_KEY = "re_key";
  stub.reset();
  stub.on("api.resend.com", () => ({ json: { id: "email_1" } }));
  const r = await sendEmail({ to: "a@x.com", subject: "S", html: "<p>h</p>" });
  assert.equal(r.sent, true);
  assert.equal(r.id, "email_1");
  assert.equal(stub.calls.some((c) => c.url.includes("api.resend.com")), true);
});

test("email http provider posts to the configured webhook", async () => {
  resetEnv();
  process.env.EMAIL_PROVIDER = "http";
  process.env.EMAIL_WEBHOOK_URL = "https://mail.internal/send";
  process.env.EMAIL_WEBHOOK_TOKEN = "tok";
  stub.reset();
  stub.on("mail.internal/send", () => ({ json: { id: "m1" } }));
  const r = await sendEmail({ to: "a@x.com", subject: "S", html: "<p>h</p>" });
  assert.equal(r.sent, true);
  const call = stub.calls.find((c) => c.url.includes("mail.internal"))!;
  assert.equal(call.headers["authorization"] || call.headers["Authorization"], "Bearer tok");
  assert.equal(stub.calls.some((c) => c.url.includes("api.resend.com")), false);
});

test("email returns a reason when the selected provider is unconfigured", async () => {
  resetEnv();
  process.env.EMAIL_PROVIDER = "http"; // no EMAIL_WEBHOOK_URL
  const r = await sendEmail({ to: "a@x.com", subject: "S", html: "h" });
  assert.equal(r.sent, false);
  assert.match(r.reason!, /EMAIL_WEBHOOK_URL/);
});

// ---------------- SMS ----------------
test("sms twilio (default) posts to Twilio", async () => {
  resetEnv();
  process.env.TWILIO_ACCOUNT_SID = "AC1";
  process.env.TWILIO_AUTH_TOKEN = "tok";
  process.env.TWILIO_FROM_NUMBER = "+15550000000";
  stub.reset();
  stub.on("api.twilio.com", () => ({ json: { sid: "SM1" } }));
  const r = await sendSms({ to: "+15551112222", body: "hi" });
  assert.equal(r.sent, true);
  assert.equal(r.sid, "SM1");
});

test("sms http provider posts to the configured gateway", async () => {
  resetEnv();
  process.env.SMS_PROVIDER = "http";
  process.env.SMS_WEBHOOK_URL = "https://sms.internal/send";
  stub.reset();
  stub.on("sms.internal/send", () => ({ json: { id: "x1" } }));
  const r = await sendSms({ to: "+1555", body: "hi" });
  assert.equal(r.sent, true);
  assert.equal(r.sid, "x1");
  assert.equal(stub.calls.some((c) => c.url.includes("api.twilio.com")), false);
});

// ---------------- End-to-end through the shield route ----------------
test("shield route runs against a local OpenAI-compatible model (no Anthropic call)", async () => {
  resetEnv();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://sb.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  process.env.LLM_PROVIDER = "openai";
  process.env.LLM_BASE_URL = "http://localhost:11434/v1";
  process.env.LLM_MODEL = "llama3.1";

  const shield = await import("../src/app/api/shield/route.ts");
  stub.reset();
  stub.on("/auth/v1/user", () => ({ json: { id: "member-1" } }));
  stub.on("/rest/v1/rpc/rate_limit_hit", () => ({ json: true }));
  stub.on("/rest/v1/phi_access_log", () => ({ json: {} }));
  stub.on("/chat/completions", () => ({ json: { choices: [{ message: { content: "hello from local model" } }] } }));

  const res = await shield.POST(
    makeReq("https://care/api/shield", {
      method: "POST",
      headers: { authorization: "Bearer good", "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], patientId: "p1" }),
    }),
  );
  const { status, body } = await readJson(res);
  assert.equal(status, 200);
  assert.equal(body.content, "hello from local model");
  assert.equal(stub.calls.some((c) => c.url.includes("api.anthropic.com")), false);
  assert.equal(stub.calls.some((c) => c.url.includes("/chat/completions")), true);
});
