import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { createResetToken } from '@/lib/password-reset';
import { sendEmail } from '@/lib/providers/email';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://care-os.vercel.app').replace(/\/$/, '');

const IP_LIMIT = { name: 'reset-req-ip', max: 15, windowSeconds: 900 };
const EMAIL_LIMIT = { name: 'reset-req-email', max: 5, windowSeconds: 900 };

// Generic response: never reveal whether an email is registered.
const GENERIC = { ok: true, message: 'If an account exists for that email, a reset link has been sent.' };

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Start a password reset. Resolves the member by their care_circle
 * member_email (no auth-schema access needed), mints a single-use token, and
 * emails a reset link. Always returns the same generic message so an
 * attacker cannot enumerate accounts. Rate-limited per IP and per email.
 */
export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  if (!(await checkRateLimit(IP_LIMIT, clientIp(req)))) {
    return NextResponse.json({ error: 'too many attempts, try again later' }, { status: 429 });
  }

  let email = '';
  try {
    email = (((await req.json()) as { email?: string }).email || '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  if (!isEmail(email)) return NextResponse.json({ error: 'valid email required' }, { status: 400 });

  // Per-email throttle (still returns the generic message once over limit, to
  // avoid signaling existence via status differences).
  if (!(await checkRateLimit(EMAIL_LIMIT, email))) {
    return NextResponse.json(GENERIC);
  }

  // Resolve the member from care_circle (service role bypasses RLS).
  const lookup = await fetch(
    `${SUPABASE_URL}/rest/v1/care_circle?member_email=eq.${encodeURIComponent(email)}` +
      `&select=member_user_id,member_name&limit=1`,
    { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` }, cache: 'no-store' },
  );
  const rows = lookup.ok
    ? ((await lookup.json()) as Array<{ member_user_id: string | null; member_name: string | null }>)
    : [];
  const member = rows[0];

  if (member?.member_user_id) {
    const token = await createResetToken(member.member_user_id, email);
    if (token) {
      const link = `${APP_URL}/reset?token=${encodeURIComponent(token)}`;
      const name = member.member_name || 'there';
      const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <h2 style="color:#00a890;margin:0 0 12px">Reset your CareCircle password</h2>
  <p>Hi ${name},</p>
  <p>We received a request to reset your CareCircle password. This link is valid for 30 minutes and can be used once:</p>
  <p>
    <a href="${link}" style="display:inline-block;padding:10px 18px;background:#00a890;color:#fff;text-decoration:none;border-radius:6px">
      Choose a new password
    </a>
  </p>
  <p style="font-size:12px;color:#666;margin-top:24px">
    If you did not request this, you can ignore this email; your password will not change.
  </p>
</div>`.trim();
      // Best-effort send; the generic response does not depend on it.
      await sendEmail({ to: email, subject: 'Reset your CareCircle password', html });
    }
  }

  return NextResponse.json(GENERIC);
}
