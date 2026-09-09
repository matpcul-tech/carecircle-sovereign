/**
 * Shared password policy for account creation and password changes.
 *
 * Rules (aligned with NIST 800-63B guidance — length-first, block known-bad,
 * avoid forced-rotation gimmicks):
 *   - 12–128 characters
 *   - at least 3 of the 4 character classes (lower, upper, digit, symbol)
 *   - must not contain the email local-part or the member's name
 *   - must not be a well-known weak/common password (small blocklist)
 *
 * Pure and dependency-free so it can run identically on the client (instant
 * feedback) and the server (authoritative enforcement).
 */

const MIN = 12;
const MAX = 128;

// A compact blocklist of the most common leaked passwords / obvious patterns.
// Not exhaustive — a production deploy should also check against a breached-
// password service (e.g. HIBP k-anonymity range API).
const COMMON = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd',
  '123456', '12345678', '123456789', '1234567890', 'qwerty', 'qwertyuiop',
  'letmein', 'welcome', 'welcome1', 'admin', 'administrator', 'iloveyou',
  'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess',
  'abc123', 'changeme', 'test1234', 'carecircle', 'caregiver',
]);

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
  /** 0–4 rough strength score for a UI meter. */
  score: number;
}

function classCount(pw: string): number {
  let n = 0;
  if (/[a-z]/.test(pw)) n++;
  if (/[A-Z]/.test(pw)) n++;
  if (/[0-9]/.test(pw)) n++;
  if (/[^A-Za-z0-9]/.test(pw)) n++;
  return n;
}

export function scorePassword(pw: string): number {
  let score = 0;
  if (pw.length >= MIN) score++;
  if (pw.length >= 16) score++;
  const classes = classCount(pw);
  if (classes >= 3) score++;
  if (classes === 4) score++;
  return Math.min(score, 4);
}

export function validatePassword(
  pw: string,
  ctx: { email?: string; name?: string } = {},
): PasswordCheck {
  const score = scorePassword(pw);
  if (typeof pw !== 'string' || pw.length < MIN) {
    return { ok: false, reason: `Password must be at least ${MIN} characters.`, score };
  }
  if (pw.length > MAX) {
    return { ok: false, reason: `Password must be at most ${MAX} characters.`, score };
  }
  if (classCount(pw) < 3) {
    return {
      ok: false,
      reason: 'Use at least 3 of: lowercase, uppercase, number, symbol.',
      score,
    };
  }
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) {
    return { ok: false, reason: 'That password is too common. Choose something unique.', score };
  }
  const local = (ctx.email || '').split('@')[0]?.trim().toLowerCase();
  if (local && local.length >= 3 && lower.includes(local)) {
    return { ok: false, reason: 'Password must not contain your email.', score };
  }
  const name = (ctx.name || '').trim().toLowerCase();
  if (name && name.length >= 3 && lower.includes(name)) {
    return { ok: false, reason: 'Password must not contain your name.', score };
  }
  return { ok: true, score };
}
