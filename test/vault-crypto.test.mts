import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

const KEY = "a".repeat(64); // 32 bytes of 0xaa
process.env.VAULT_KEY_HEX = KEY;

const { encryptGCM, decryptGCM } = await import("../src/lib/vault-crypto.ts");

test("round-trips a simple payload", () => {
  const pt = Buffer.from("hello care vault");
  const { ivBase64, ciphertext } = encryptGCM(pt);
  assert.deepEqual(decryptGCM(ciphertext, ivBase64), pt);
});

test("round-trips empty buffer", () => {
  const pt = Buffer.alloc(0);
  const { ivBase64, ciphertext } = encryptGCM(pt);
  // ciphertext is just the 16-byte tag for empty plaintext
  assert.equal(ciphertext.length, 16);
  assert.deepEqual(decryptGCM(ciphertext, ivBase64), pt);
});

test("unique IV per call (no nonce reuse across 5000 encryptions)", () => {
  const seen = new Set<string>();
  const pt = Buffer.from("same plaintext every time");
  for (let i = 0; i < 5000; i++) {
    const { ivBase64 } = encryptGCM(pt);
    assert.equal(seen.has(ivBase64), false, "IV repeated — nonce reuse breaks GCM");
    seen.add(ivBase64);
  }
});

test("ciphertext of identical plaintext differs (semantic security)", () => {
  const pt = Buffer.from("repeat me");
  const a = encryptGCM(pt);
  const b = encryptGCM(pt);
  assert.notEqual(a.ciphertext.toString("hex"), b.ciphertext.toString("hex"));
});

test("tampering with ciphertext body is rejected by the GCM tag", () => {
  const { ivBase64, ciphertext } = encryptGCM(Buffer.from("integrity matters"));
  const bad = Buffer.from(ciphertext);
  bad[0] ^= 0xff; // flip a byte in the ciphertext
  assert.throws(() => decryptGCM(bad, ivBase64));
});

test("tampering with the auth tag is rejected", () => {
  const { ivBase64, ciphertext } = encryptGCM(Buffer.from("integrity matters"));
  const bad = Buffer.from(ciphertext);
  bad[bad.length - 1] ^= 0x01; // flip a bit in the trailing tag
  assert.throws(() => decryptGCM(bad, ivBase64));
});

test("wrong IV fails to authenticate", () => {
  const { ciphertext } = encryptGCM(Buffer.from("bind the iv"));
  const otherIv = randomBytes(12).toString("base64");
  assert.throws(() => decryptGCM(ciphertext, otherIv));
});

test("decrypt with a different key fails", async () => {
  const { ivBase64, ciphertext } = encryptGCM(Buffer.from("key binding"));
  // Re-import module with a different key via a fresh env + query string.
  process.env.VAULT_KEY_HEX = "b".repeat(64);
  const mod2 = await import("../src/lib/vault-crypto.ts?v=2");
  assert.throws(() => mod2.decryptGCM(ciphertext, ivBase64));
  process.env.VAULT_KEY_HEX = KEY; // restore
});

test("rejects IV of wrong length", () => {
  const { ciphertext } = encryptGCM(Buffer.from("x"));
  assert.throws(() => decryptGCM(ciphertext, Buffer.alloc(8).toString("base64")), /invalid IV length/);
});

test("rejects ciphertext shorter than the tag", () => {
  const iv = randomBytes(12).toString("base64");
  assert.throws(() => decryptGCM(Buffer.alloc(15), iv), /ciphertext too short/);
});

test("rejects a malformed key (bad length)", async () => {
  process.env.VAULT_KEY_HEX = "abcd";
  const mod = await import("../src/lib/vault-crypto.ts?v=badlen");
  assert.throws(() => mod.encryptGCM(Buffer.from("x")), /64 hex chars/);
  process.env.VAULT_KEY_HEX = KEY;
});

test("rejects a non-hex key", async () => {
  process.env.VAULT_KEY_HEX = "z".repeat(64);
  const mod = await import("../src/lib/vault-crypto.ts?v=nonhex");
  assert.throws(() => mod.encryptGCM(Buffer.from("x")), /64 hex chars/);
  process.env.VAULT_KEY_HEX = KEY;
});

test("STRESS: round-trips the 25 MB max upload size", () => {
  const big = randomBytes(25 * 1024 * 1024);
  const { ivBase64, ciphertext } = encryptGCM(big);
  const back = decryptGCM(ciphertext, ivBase64);
  assert.equal(back.length, big.length);
  assert.ok(back.equals(big));
});

test("STRESS: 2000 random-size round-trips never corrupt", () => {
  for (let i = 0; i < 2000; i++) {
    const n = Math.floor(Math.random() * 4096);
    const pt = randomBytes(n);
    const { ivBase64, ciphertext } = encryptGCM(pt);
    assert.ok(decryptGCM(ciphertext, ivBase64).equals(pt), `failed at size ${n}`);
  }
});
