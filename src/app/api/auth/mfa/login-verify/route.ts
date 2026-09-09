import { NextRequest, NextResponse } from 'next/server';
import { verifyTotp } from '@/lib/totp';
import { loadMfa, consumeBackupCode, decodeMfaToken } from '@/lib/mfa';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT = { name: 'mfa-login-verify', max: 10, windowSeconds: 60 };

/**
 * Second step of an MFA-gated login. Exchanges the short-lived mfa_token from
 * /api/auth/login plus a valid TOTP code (or one unused backup code) for the
 * withheld session. Rate-limited per user to blunt code brute-forcing.
 */
export async function POST(req: NextRequest) {
  let body: { mfa_token?: string; code?: string };
  try {
    body = (await req.json()) as { mfa_token?: string; code?: string };
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }

  const pending = decodeMfaToken(body.mfa_token || '', Date.now());
  if (!pending) {
    return NextResponse.json({ error: 'expired or invalid session, please sign in again' }, { status: 401 });
  }

  if (!(await checkRateLimit(RATE_LIMIT, pending.user_id))) return tooManyRequests(RATE_LIMIT);

  const code = (body.code || '').trim();
  const rec = await loadMfa(pending.user_id);
  if (!rec || !rec.enabled || !rec.secretBase32) {
    return NextResponse.json({ error: 'MFA not configured' }, { status: 400 });
  }

  const totpOk = verifyTotp(rec.secretBase32, code, Date.now());
  const backupOk = totpOk ? false : await consumeBackupCode(pending.user_id, code, rec.backupHashes);
  if (!totpOk && !backupOk) {
    return NextResponse.json({ error: 'invalid code' }, { status: 401 });
  }

  return NextResponse.json({
    session: pending.session,
    circle: pending.circle,
    no_circle: pending.circle === null,
    used_backup_code: backupOk,
  });
}
