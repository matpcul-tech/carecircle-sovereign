import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getUserId } from '@/lib/api-auth';
import { generateSecret, otpauthUri } from '@/lib/totp';
import { loadMfa, saveEnrollment } from '@/lib/mfa';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT = { name: 'mfa-enroll', max: 10, windowSeconds: 60 };

// Begin TOTP enrollment: generates a secret (stored encrypted, not yet active)
// and returns the base32 secret + otpauth URI so the client can show a QR
// code. The factor is not active until /activate verifies a code.
export async function POST(req: NextRequest) {
  const userId = await getUserId(bearerToken(req));
  if (!userId) return NextResponse.json({ error: 'authentication required' }, { status: 401 });

  if (!(await checkRateLimit(RATE_LIMIT, userId))) return tooManyRequests(RATE_LIMIT);

  const existing = await loadMfa(userId);
  if (existing?.enabled) {
    return NextResponse.json(
      { error: 'MFA is already enabled; disable it before re-enrolling' },
      { status: 409 },
    );
  }

  const secret = generateSecret();
  const ok = await saveEnrollment(userId, secret);
  if (!ok) return NextResponse.json({ error: 'could not start enrollment' }, { status: 502 });

  // account label is best-effort; the client can pass a friendlier one later.
  const uri = otpauthUri(secret, userId);
  return NextResponse.json({ secret, otpauth_uri: uri });
}
