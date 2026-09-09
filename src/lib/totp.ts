import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/**
 * RFC 4226 (HOTP) / RFC 6238 (TOTP) implementation for the CareCircle MFA
 * second factor. Node runtime only (uses node:crypto HMAC-SHA1). Compatible
 * with Google Authenticator, Authy, 1Password, etc. (base32 secret, 30s step,
 * 6 digits, SHA-1).
 */

const DIGITS = 6;
const STEP_SECONDS = 30;

// ---- base32 (RFC 4648, no padding) -----------------------------------------
const B32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += B32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = B32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Generate a new random base32 TOTP secret (default 20 bytes / 160 bits). */
export function generateSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

// ---- HOTP / TOTP -----------------------------------------------------------
function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const buf = Buffer.alloc(8);
  // 64-bit big-endian counter (JS numbers cover the needed range comfortably).
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const hmac = createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

/** Compute the TOTP code for a base32 secret at time `nowMs` (ms since epoch). */
export function totp(
  secretBase32: string,
  nowMs: number,
  opts: { step?: number; digits?: number } = {},
): string {
  const step = opts.step ?? STEP_SECONDS;
  const counter = Math.floor(nowMs / 1000 / step);
  return hotp(base32Decode(secretBase32), counter, opts.digits ?? DIGITS);
}

/**
 * Verify a user-supplied code against the secret, allowing +/- `window` steps
 * of clock skew (default 1 → accepts the previous, current, and next 30s
 * code). Constant-time compare per candidate.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
  opts: { step?: number; digits?: number; window?: number } = {},
): boolean {
  const digits = opts.digits ?? DIGITS;
  const step = opts.step ?? STEP_SECONDS;
  const window = opts.window ?? 1;
  const clean = (code || '').replace(/\s+/g, '');
  if (!/^\d+$/.test(clean) || clean.length !== digits) return false;
  const secret = base32Decode(secretBase32);
  const base = Math.floor(nowMs / 1000 / step);
  for (let w = -window; w <= window; w++) {
    const candidate = hotp(secret, base + w, digits);
    const a = Buffer.from(candidate);
    const b = Buffer.from(clean);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

/** Build an otpauth:// URI for QR provisioning. */
export function otpauthUri(secretBase32: string, account: string, issuer = 'CareCircle'): string {
  // Keep the issuer:account colon literal (otpauth convention); encode each side.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
