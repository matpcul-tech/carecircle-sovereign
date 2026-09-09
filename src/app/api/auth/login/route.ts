import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, resetRateLimit, clientIp } from '@/lib/rate-limit';
import { loadMfa, encodeMfaToken, type PendingLogin } from '@/lib/mfa';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

// Coarse per-IP throttle on all attempts + per-email failure lockout.
const IP_LIMIT = { name: 'login-ip', max: 30, windowSeconds: 60 };
const FAIL_LIMIT = { name: 'login-fail', max: 5, windowSeconds: 900 }; // 5 fails / 15 min

interface CircleRow {
  patient_id: string;
  patient_name: string | null;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function lookupCircle(userId: string): Promise<CircleRow | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/care_circle?member_user_id=eq.${encodeURIComponent(userId)}&select=patient_id,patient_name&limit=1`,
    { headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` }, cache: 'no-store' },
  );
  if (!r.ok) return null;
  const rows = (await r.json()) as CircleRow[];
  if (rows[0]) return rows[0];

  // No member row. In the Sovereign Edition this app runs on the Chikasha
  // Health OS Supabase project, so the signed-in account may be the PATIENT
  // themselves (care_circle.patient_id is their auth uid). A patient signs
  // in to their own circle to approve family access requests and to see
  // what the family sees. Accounts created by this app for family members
  // carry user_metadata.role = 'care_circle_member' and are never treated
  // as a patient, so a family member with no approved circle still lands on
  // the request-access status page rather than an empty circle of their own.
  return lookupPatientSelf(userId);
}

async function lookupPatientSelf(userId: string): Promise<CircleRow | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
    cache: 'no-store',
  });
  if (!r.ok) return null;
  const data = (await r.json().catch(() => null)) as {
    id?: string;
    email?: string;
    user_metadata?: Record<string, unknown>;
  } | null;
  if (!data || data.id !== userId) return null;
  const meta = data.user_metadata || {};
  if (meta.role === 'care_circle_member') return null;
  const full = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
  const name = typeof meta.name === 'string' ? meta.name.trim() : '';
  const local = typeof data.email === 'string' && data.email.includes('@') ? data.email.split('@')[0].trim() : '';
  return { patient_id: userId, patient_name: full || name || local || null };
}

/**
 * Hardened login proxy: enforces per-IP and per-email lockout, returns a
 * GENERIC error on bad credentials (no user enumeration), and — when the
 * member has MFA enabled — WITHHOLDS the session and returns a short-lived
 * encrypted mfa_token that /api/auth/mfa/login-verify exchanges for the
 * session after a valid second factor.
 */
export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
    return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });
  }

  const ip = clientIp(req);
  if (!(await checkRateLimit(IP_LIMIT, ip))) {
    return NextResponse.json({ error: 'too many attempts, try again shortly' }, { status: 429 });
  }

  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  const email = (body.email || '').trim().toLowerCase();
  const password = body.password || '';
  if (!isEmail(email) || !password) {
    return NextResponse.json({ error: 'invalid email or password' }, { status: 400 });
  }

  // Per-email lockout: this call increments the failure window; a successful
  // login resets it below. Once the window is over the threshold, stop here.
  if (!(await checkRateLimit(FAIL_LIMIT, email))) {
    return NextResponse.json(
      { error: 'account temporarily locked after too many attempts, try again later' },
      { status: 429 },
    );
  }

  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });

  if (!tokenRes.ok) {
    // Generic message — never reveal whether the email exists.
    return NextResponse.json({ error: 'invalid email or password' }, { status: 401 });
  }

  const data = (await tokenRes.json()) as TokenResponse;
  // Successful password step — clear the failure counter for this email.
  await resetRateLimit(FAIL_LIMIT.name, email);

  const circle = await lookupCircle(data.user.id);
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    user_id: data.user.id,
  };

  const mfa = await loadMfa(data.user.id);
  if (mfa?.enabled) {
    const payload: PendingLogin = {
      user_id: data.user.id,
      session,
      circle,
      exp: Math.floor(Date.now() / 1000) + 300, // 5-minute window to complete MFA
    };
    return NextResponse.json({ mfa_required: true, mfa_token: encodeMfaToken(payload) });
  }

  return NextResponse.json({
    mfa_required: false,
    session,
    circle,
    no_circle: circle === null,
  });
}
