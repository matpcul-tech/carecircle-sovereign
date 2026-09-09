import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getUserId } from '@/lib/api-auth';
import { verifyTotp } from '@/lib/totp';
import { loadMfa, disableMfa, consumeBackupCode } from '@/lib/mfa';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT = { name: 'mfa-disable', max: 10, windowSeconds: 60 };

// Disable MFA. Requires proof of possession — a current TOTP code or an unused
// backup code — so a hijacked (single-factor) session cannot silently strip
// the second factor.
export async function POST(req: NextRequest) {
  const userId = await getUserId(bearerToken(req));
  if (!userId) return NextResponse.json({ error: 'authentication required' }, { status: 401 });

  if (!(await checkRateLimit(RATE_LIMIT, userId))) return tooManyRequests(RATE_LIMIT);

  let body: { code?: string };
  try {
    body = (await req.json()) as { code?: string };
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  const code = (body.code || '').trim();

  const rec = await loadMfa(userId);
  if (!rec || !rec.enabled) {
    return NextResponse.json({ error: 'MFA is not enabled' }, { status: 400 });
  }

  const totpOk = rec.secretBase32 ? verifyTotp(rec.secretBase32, code, Date.now()) : false;
  const backupOk = totpOk ? false : await consumeBackupCode(userId, code, rec.backupHashes);
  if (!totpOk && !backupOk) {
    return NextResponse.json({ error: 'invalid code' }, { status: 401 });
  }

  const ok = await disableMfa(userId);
  if (!ok) return NextResponse.json({ error: 'could not disable MFA' }, { status: 502 });
  return NextResponse.json({ ok: true });
}
