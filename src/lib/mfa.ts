import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { encryptGCM, decryptGCM } from '@/lib/vault-crypto';

/**
 * Server-side MFA helpers (Node runtime). Persists TOTP factors in
 * public.user_mfa via the service role, with the shared secret encrypted at
 * rest (AES-256-GCM, VAULT_KEY_HEX) and backup codes stored only as SHA-256
 * hashes. Also mints/parses the short-lived encrypted "pending login" token
 * used to gate a password login behind a second factor.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export interface MfaRecord {
  enabled: boolean;
  secretBase32: string | null;
  backupHashes: string[];
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Generate N human-friendly one-time backup codes + their stored hashes. */
export function generateBackupCodes(n = 10): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  for (let i = 0; i < n; i++) {
    // 10 hex chars, grouped for readability, e.g. "a1b2c-3d4e5".
    const hex = randomBytes(5).toString('hex');
    plain.push(`${hex.slice(0, 5)}-${hex.slice(5)}`);
  }
  return { plain, hashes: plain.map((c) => sha256Hex(c.replace(/-/g, ''))) };
}

async function sb(method: string, path: string, body?: unknown, prefer?: string) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
}

/** Load a user's MFA record (decrypting the secret), or null if none. */
export async function loadMfa(userId: string): Promise<MfaRecord | null> {
  const r = await sb(
    'GET',
    `user_mfa?user_id=eq.${encodeURIComponent(userId)}&select=secret_cipher,secret_iv,enabled,backup_codes&limit=1`,
  );
  if (!r.ok) return null;
  const rows = (await r.json()) as Array<{
    secret_cipher: string;
    secret_iv: string;
    enabled: boolean;
    backup_codes: string[];
  }>;
  if (rows.length === 0) return null;
  const row = rows[0];
  let secretBase32: string | null = null;
  try {
    secretBase32 = decryptGCM(Buffer.from(row.secret_cipher, 'base64'), row.secret_iv).toString('utf8');
  } catch {
    secretBase32 = null;
  }
  return {
    enabled: row.enabled,
    secretBase32,
    backupHashes: Array.isArray(row.backup_codes) ? row.backup_codes : [],
  };
}

/** Upsert an (unverified) enrollment: encrypts and stores the secret, enabled=false. */
export async function saveEnrollment(userId: string, secretBase32: string): Promise<boolean> {
  const enc = encryptGCM(Buffer.from(secretBase32, 'utf8'));
  const r = await sb(
    'POST',
    'user_mfa',
    [
      {
        user_id: userId,
        secret_cipher: enc.ciphertext.toString('base64'),
        secret_iv: enc.ivBase64,
        enabled: false,
        backup_codes: [],
        enrolled_at: null,
        updated_at: new Date().toISOString(),
      },
    ],
    'resolution=merge-duplicates',
  );
  return r.ok;
}

/** Mark a factor active and store backup-code hashes. */
export async function activateMfa(userId: string, backupHashes: string[]): Promise<boolean> {
  const r = await sb(
    'PATCH',
    `user_mfa?user_id=eq.${encodeURIComponent(userId)}`,
    { enabled: true, backup_codes: backupHashes, enrolled_at: new Date().toISOString(), updated_at: new Date().toISOString() },
  );
  return r.ok;
}

/** Remove a user's factor entirely. */
export async function disableMfa(userId: string): Promise<boolean> {
  const r = await sb('DELETE', `user_mfa?user_id=eq.${encodeURIComponent(userId)}`);
  return r.ok;
}

/** Consume a backup code if it matches an unused hash; returns true on success. */
export async function consumeBackupCode(
  userId: string,
  code: string,
  currentHashes: string[],
): Promise<boolean> {
  const target = sha256Hex((code || '').replace(/[\s-]/g, '').toLowerCase());
  const match = currentHashes.find((h) => hashesEqual(h, target));
  if (!match) return false;
  const remaining = currentHashes.filter((h) => h !== match);
  const r = await sb(
    'PATCH',
    `user_mfa?user_id=eq.${encodeURIComponent(userId)}`,
    { backup_codes: remaining, updated_at: new Date().toISOString() },
  );
  return r.ok;
}

// ---- Pending-login token (encrypted, short-lived) --------------------------

export interface PendingLogin {
  user_id: string;
  session: unknown; // the withheld Supabase session
  circle: { patient_id: string; patient_name: string | null } | null;
  exp: number; // epoch seconds
}

/** Encrypt a pending-login payload into an opaque token: base64(iv).base64(ct). */
export function encodeMfaToken(payload: PendingLogin): string {
  const enc = encryptGCM(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${enc.ivBase64}.${enc.ciphertext.toString('base64')}`;
}

/** Decrypt + validate a pending-login token. Returns null if invalid/expired. */
export function decodeMfaToken(token: string, nowMs: number): PendingLogin | null {
  const parts = (token || '').split('.');
  if (parts.length !== 2) return null;
  try {
    const plain = decryptGCM(Buffer.from(parts[1], 'base64'), parts[0]);
    const payload = JSON.parse(plain.toString('utf8')) as PendingLogin;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}
