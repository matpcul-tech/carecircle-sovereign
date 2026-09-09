import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getUserId } from '@/lib/api-auth';
import { loadMfa } from '@/lib/mfa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Report whether the authenticated member has an active TOTP factor, and how
// many backup codes remain.
export async function GET(req: NextRequest) {
  const userId = await getUserId(bearerToken(req));
  if (!userId) return NextResponse.json({ error: 'authentication required' }, { status: 401 });

  const rec = await loadMfa(userId);
  return NextResponse.json({
    enabled: !!rec?.enabled,
    backup_codes_remaining: rec?.enabled ? rec.backupHashes.length : 0,
  });
}
