import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getUserId } from '@/lib/api-auth';
import { verifyTotp } from '@/lib/totp';
import { loadMfa, activateMfa, generateBackupCodes } from '@/lib/mfa';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT = { name: 'mfa-activate', max: 10, windowSeconds: 60 };

// Verify the first TOTP code and activate the factor. Returns one-time backup
// codes (shown once). Rate-limited to blunt code brute-forcing.
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
  if (!rec || !rec.secretBase32) {
    return NextResponse.json({ error: 'start enrollment first' }, { status: 400 });
  }
  if (rec.enabled) {
    return NextResponse.json({ error: 'MFA already enabled' }, { status: 409 });
  }
  if (!verifyTotp(rec.secretBase32, code, Date.now())) {
    return NextResponse.json({ error: 'invalid code' }, { status: 401 });
  }

  const backup = generateBackupCodes(10);
  const ok = await activateMfa(userId, backup.hashes);
  if (!ok) return NextResponse.json({ error: 'could not activate MFA' }, { status: 502 });

  return NextResponse.json({ ok: true, backup_codes: backup.plain });
}
