import { NextRequest, NextResponse } from 'next/server';
import { validatePassword } from '@/lib/password-policy';
import { peekResetToken, consumeResetToken } from '@/lib/password-reset';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const RATE_LIMIT = { name: 'reset-consume', max: 20, windowSeconds: 900 };

/**
 * Complete a password reset: validate the token, enforce the password policy,
 * atomically consume the token (single-use), and set the new password via the
 * GoTrue admin API. MFA is intentionally NOT required here (this is the
 * account-recovery path); the second factor is still enforced at next login.
 */
export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  if (!(await checkRateLimit(RATE_LIMIT, clientIp(req)))) {
    return NextResponse.json({ error: 'too many attempts, try again later' }, { status: 429 });
  }

  let body: { token?: string; new_password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  const token = (body.token || '').trim();
  const newPassword = body.new_password || '';
  if (!token) return NextResponse.json({ error: 'reset token required' }, { status: 400 });

  // Peek first so a weak-password typo does not burn the token.
  const claim = await peekResetToken(token, Date.now());
  if (!claim) {
    return NextResponse.json({ error: 'invalid or expired reset link' }, { status: 400 });
  }

  const pw = validatePassword(newPassword, { email: claim.email });
  if (!pw.ok) return NextResponse.json({ error: pw.reason }, { status: 400 });

  // Atomically consume (single-use); loses the race gracefully.
  const consumed = await consumeResetToken(token, Date.now());
  if (!consumed) {
    return NextResponse.json({ error: 'this reset link has already been used' }, { status: 400 });
  }

  const upd = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(claim.user_id)}`, {
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
