import { NextRequest, NextResponse } from 'next/server';
import { bearerToken } from '@/lib/api-auth';
import { validatePassword } from '@/lib/password-policy';
import { verifyTotp } from '@/lib/totp';
import { loadMfa, consumeBackupCode } from '@/lib/mfa';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const RATE_LIMIT = { name: 'change-password', max: 5, windowSeconds: 900 };

/**
 * Change the password of the signed-in user. Requires the CURRENT password
 * (so a stolen session alone cannot change it) and, when MFA is enabled, a
 * current second factor. Enforces the shared password policy and updates the
 * password through the GoTrue admin API.
 */
export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  const token = bearerToken(req);
  if (!token) return NextResponse.json({ error: 'authentication required' }, { status: 401 });

  // Resolve the caller's id + email from their token.
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!userRes.ok) return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  const user = (await userRes.json()) as {
    id: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  };
  if (!user.email) return NextResponse.json({ error: 'account has no email' }, { status: 400 });

  if (!(await checkRateLimit(RATE_LIMIT, user.id))) return tooManyRequests(RATE_LIMIT);

  let body: { current_password?: string; new_password?: string; code?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  const currentPassword = body.current_password || '';
  const newPassword = body.new_password || '';

  // Verify the current password by attempting a password grant.
  const grant = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: user.email, password: currentPassword }),
    cache: 'no-store',
  });
  if (!grant.ok) {
    return NextResponse.json({ error: 'current password is incorrect' }, { status: 401 });
  }

  // Enforce the shared policy on the new password.
  const name =
    typeof user.user_metadata?.full_name === 'string' ? (user.user_metadata.full_name as string) : '';
  const pw = validatePassword(newPassword, { email: user.email, name });
  if (!pw.ok) return NextResponse.json({ error: pw.reason }, { status: 400 });
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: 'new password must differ from the current one' }, { status: 400 });
  }

  // If MFA is on, require a current second factor too.
  const mfa = await loadMfa(user.id);
  if (mfa?.enabled) {
    const code = (body.code || '').trim();
    const totpOk = mfa.secretBase32 ? verifyTotp(mfa.secretBase32, code, Date.now()) : false;
    const backupOk = totpOk ? false : await consumeBackupCode(user.id, code, mfa.backupHashes);
    if (!totpOk && !backupOk) {
      return NextResponse.json({ error: 'a valid two-factor code is required' }, { status: 401 });
    }
  }

  // Update the password via the admin API.
  const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify({ password: newPassword }),
  });
  if (!upd.ok) {
    return NextResponse.json({ error: 'could not update password' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
