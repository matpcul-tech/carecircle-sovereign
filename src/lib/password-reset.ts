import { createHash, randomBytes } from 'crypto';

/**
 * Server-side helpers for the forgot-password flow (Node runtime).
 * Persists single-use reset tokens in public.password_reset_tokens via the
 * service role, storing only the SHA-256 hash of each token. The plaintext
 * token is returned once (to be emailed) and never stored.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
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

/**
 * Create a reset token for a user and store its hash. Returns the plaintext
 * token (to email), or null on failure. TTL defaults to 30 minutes.
 */
export async function createResetToken(
  userId: string,
  email: string,
  ttlMinutes = 30,
): Promise<string | null> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const r = await sb('POST', 'password_reset_tokens', [
    { user_id: userId, email, token_hash: sha256(token), expires_at: expiresAt },
  ]);
  return r.ok ? token : null;
}

/**
 * Look up an unused, unexpired token without consuming it. Returns the
 * associated user, or null. Lets the reset route validate the new password
 * before burning the token on a typo.
 */
export async function peekResetToken(
  token: string,
  nowMs: number,
): Promise<{ user_id: string; email: string } | null> {
  const now = new Date(nowMs).toISOString();
  const r = await sb(
    'GET',
    `password_reset_tokens?token_hash=eq.${encodeURIComponent(sha256(token))}` +
      `&used_at=is.null&expires_at=gt.${encodeURIComponent(now)}` +
      `&select=user_id,email&limit=1`,
  );
  if (!r.ok) return null;
  const rows = (await r.json()) as Array<{ user_id: string; email: string }>;
  return rows[0] || null;
}

/**
 * Atomically mark a token used (single-use). Returns true only for the caller
 * that flips used_at from null; concurrent reuse gets false.
 */
export async function consumeResetToken(token: string, nowMs: number): Promise<boolean> {
  const now = new Date(nowMs).toISOString();
  const r = await sb(
    'PATCH',
    `password_reset_tokens?token_hash=eq.${encodeURIComponent(sha256(token))}` +
      `&used_at=is.null&expires_at=gt.${encodeURIComponent(now)}`,
    { used_at: now },
    'return=representation',
  );
  if (!r.ok) return false;
  const rows = (await r.json().catch(() => [])) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}
