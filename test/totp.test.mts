import test from "node:test";
import assert from "node:assert/strict";
import { base32Encode, base32Decode, totp, verifyTotp, otpauthUri, generateSecret } from "../src/lib/totp.ts";

// RFC 4226 Appendix D secret: ASCII "12345678901234567890".
const RFC_SECRET_B32 = base32Encode(Buffer.from("12345678901234567890"));

// RFC 4226 HOTP(counter) 6-digit reference values. TOTP with step=1 and
// nowMs = counter*1000 reduces to HOTP(counter), so we can validate the core
// against the canonical vectors.
const HOTP_VECTORS = [
  "755224", "287082", "359152", "969429", "338314",
  "254676", "287922", "162583", "399871", "520489",
];

test("base32 round-trips arbitrary bytes", () => {
  for (const s of ["", "f", "fo", "foo", "foob", "fooba", "foobar", "12345678901234567890"]) {
    const b = Buffer.from(s);
    assert.equal(base32Decode(base32Encode(b)).toString(), b.toString(), `round-trip ${s}`);
  }
  // Known RFC 4648 vector.
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
});

test("HOTP matches RFC 4226 test vectors (via TOTP step=1)", () => {
  for (let c = 0; c < HOTP_VECTORS.length; c++) {
    assert.equal(totp(RFC_SECRET_B32, c * 1000, { step: 1 }), HOTP_VECTORS[c], `counter ${c}`);
  }
});

test("verifyTotp accepts the current code and rejects a wrong one", () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const code = totp(secret, now);
  assert.equal(verifyTotp(secret, code, now), true);
  assert.equal(verifyTotp(secret, "000000", now), false);
});

test("verifyTotp tolerates +/- one step of skew but not two", () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  const prev = totp(secret, now - 30_000);
  const next = totp(secret, now + 30_000);
  const twoAhead = totp(secret, now + 60_000);
  assert.equal(verifyTotp(secret, prev, now), true);
  assert.equal(verifyTotp(secret, next, now), true);
  assert.equal(verifyTotp(secret, twoAhead, now), false);
});

test("verifyTotp rejects malformed input", () => {
  const secret = generateSecret();
  const now = 1_700_000_000_000;
  assert.equal(verifyTotp(secret, "12ab56", now), false);
  assert.equal(verifyTotp(secret, "1234567", now), false); // wrong length
  assert.equal(verifyTotp(secret, "", now), false);
});

test("otpauthUri encodes issuer, secret, and params", () => {
  const uri = otpauthUri("JBSWY3DPEHPK3PXP", "mom@example.com");
  assert.match(uri, /^otpauth:\/\/totp\/CareCircle:mom%40example\.com\?/);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /issuer=CareCircle/);
  assert.match(uri, /digits=6/);
  assert.match(uri, /period=30/);
});
