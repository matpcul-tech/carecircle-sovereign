import test from "node:test";
import assert from "node:assert/strict";
import { validatePassword, scorePassword } from "../src/lib/password-policy.ts";

test("rejects short passwords", () => {
  assert.equal(validatePassword("Ab1!xyz").ok, false);
  assert.equal(validatePassword("Abc123!def").ok, false); // 10 chars, still < 12
});

test("rejects too few character classes", () => {
  const r = validatePassword("alllowercaseletters"); // 1 class, long enough
  assert.equal(r.ok, false);
  assert.match(r.reason!, /3 of/);
});

test("accepts a strong password", () => {
  const r = validatePassword("Correct-Horse-9Battery");
  assert.equal(r.ok, true);
});

test("rejects common passwords even if long", () => {
  assert.equal(validatePassword("password123").ok, false);
});

test("rejects passwords containing the email local-part", () => {
  const r = validatePassword("Marypoppins-99!", { email: "mary@example.com" });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /email/);
});

test("rejects passwords containing the member name", () => {
  const r = validatePassword("Johnson-Str0ng-Key!", { name: "Johnson" });
  assert.equal(r.ok, false);
  assert.match(r.reason!, /name/);
});

test("rejects over-long passwords", () => {
  assert.equal(validatePassword("Aa1!" + "x".repeat(200)).ok, false);
});

test("score increases with length and class diversity", () => {
  assert.ok(scorePassword("short") < scorePassword("Longer-Passphrase-9!"));
  assert.equal(scorePassword("aaaaaaaaaaaa"), 1); // 12 chars, 1 class
  assert.equal(scorePassword("Abcdefgh1!xyzz"), 3); // 14 chars (<16), 4 classes
  assert.equal(scorePassword("Abcdefgh1!xyzz-QQ"), 4); // 17 chars, 4 classes
});
