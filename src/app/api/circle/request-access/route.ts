import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getUserId } from '@/lib/api-auth';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { validatePassword } from '@/lib/password-policy';
import { sendEmail } from '@/lib/providers/email';
import { ACCESS_REQUEST_RELATIONSHIPS as RELATIONSHIPS, type AccessRequestRow } from '@/lib/access-requests';

export const runtime = 'edge';

/**
 * Family-initiated access requests.
 *
 * care-os only supports patient-initiated invites (the patient makes a code,
 * a family member redeems it). For Chickasaw families the common path runs
 * the other way: a family member asks for access to the elder's Chikasha
 * Health OS record, the elder is notified, and the elder approves or denies
 * from the Family page (or an existing circle admin does).
 *
 * The patient is a Supabase auth user in the Health OS project
 * (care_circle.patient_id = their auth uid), so this app MUST run on the
 * Health OS Supabase project. Every write here goes through the service
 * role; the table has no insert policy on purpose.
 *
 * Enumeration guard: the POST answers with the SAME neutral 202 whether the
 * elder's email belongs to a patient, belongs to nobody, is the requester's
 * own email, or the requester is already in the circle. Only the elder ever
 * learns a request exists.
 */

const RL_POST = { name: 'request-access-post', max: 5, windowSeconds: 600 };
const RL_GET = { name: 'request-access-get', max: 60, windowSeconds: 60 };

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://carecircle-sovereign.vercel.app').replace(/\/$/, '');

const NEUTRAL_MESSAGE =
  'If that email belongs to a Chikasha Health OS patient, they will see your request the next time they open CareCircle or the Health OS and can approve it.';

interface RequestBody {
  patient_email?: string;
  requester_name?: string;
  requester_email?: string;
  requester_phone?: string;
  relationship?: string;
  message?: string;
  password?: string;
}

interface AuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
}

interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function envProblem(): string | null {
  if (!SUPABASE_URL) return 'NEXT_PUBLIC_SUPABASE_URL not set';
  if (!ANON_KEY) return 'NEXT_PUBLIC_SUPABASE_ANON_KEY not set';
  if (!SERVICE_ROLE) return 'SUPABASE_SERVICE_ROLE_KEY not set';
  return null;
}

const SERVICE_HEADERS = {
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
};

async function sb(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, prefer?: string) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...SERVICE_HEADERS,
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
}

/**
 * Look up an auth user by email through the admin API. The listing
 * endpoint may answer with either a bare array or { users: [...] }; both
 * shapes are handled and the match is exact on the lowercased email so a
 * substring filter can never return a neighbour's account.
 */
async function findAuthUserByEmail(email: string): Promise<AuthUser | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, {
    headers: SERVICE_HEADERS,
    cache: 'no-store',
  });
  if (!r.ok) return null;
  const data = (await r.json().catch(() => null)) as unknown;
  const list: AuthUser[] = Array.isArray(data)
    ? (data as AuthUser[])
    : data && typeof data === 'object' && Array.isArray((data as { users?: unknown }).users)
      ? ((data as { users: AuthUser[] }).users)
      : [];
  const wanted = email.toLowerCase();
  return list.find((u) => typeof u?.email === 'string' && u.email.toLowerCase() === wanted) || null;
}

async function getAuthUser(userId: string): Promise<AuthUser | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    headers: SERVICE_HEADERS,
    cache: 'no-store',
  });
  if (!r.ok) return null;
  const data = (await r.json().catch(() => null)) as AuthUser | null;
  return data && typeof data.id === 'string' ? data : null;
}

function displayName(u: AuthUser | null): string | null {
  const meta = u?.user_metadata || {};
  const full = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
  if (full) return full;
  const name = typeof meta.name === 'string' ? meta.name.trim() : '';
  if (name) return name;
  if (typeof u?.email === 'string' && u.email.includes('@')) {
    const local = u.email.split('@')[0].trim();
    if (local) return local;
  }
  return null;
}

async function isMember(patientId: string, userId: string): Promise<boolean> {
  const r = await sb(
    'GET',
    `care_circle?patient_id=eq.${encodeURIComponent(patientId)}&member_user_id=eq.${encodeURIComponent(userId)}&select=id&limit=1`,
  );
  if (!r.ok) return false;
  const rows = (await r.json().catch(() => [])) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

async function isAdminFor(patientId: string, userId: string): Promise<boolean> {
  if (patientId === userId) return true;
  const r = await sb(
    'GET',
    `care_circle?patient_id=eq.${encodeURIComponent(patientId)}&member_user_id=eq.${encodeURIComponent(userId)}&care_role=eq.admin&select=id&limit=1`,
  );
  if (!r.ok) return false;
  const rows = (await r.json().catch(() => [])) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

async function notifyPatient(args: { to: string; patientName: string | null; requesterName: string; relationship: string }) {
  const greeting = args.patientName ? `Hi ${args.patientName},` : 'Hello,';
  const subject = `${args.requesterName} is asking to join your Care Circle`;
  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <h2 style="color:#3D8B5E;margin:0 0 12px">A family member is asking for access</h2>
  <p>${greeting}</p>
  <p><strong>${args.requesterName}</strong> (${args.relationship}) has asked to join your CareCircle so they can help coordinate your care and see the same picture you see in Chikasha Health OS.</p>
  <p>Nothing is shared until you approve. You choose what they can see.</p>
  <p>
    <a href="${APP_URL}/app" style="display:inline-block;padding:10px 18px;background:#C07941;color:#fff;text-decoration:none;border-radius:6px">
      Open CareCircle
    </a>
  </p>
  <p style="font-size:13px;color:#444">Open the <strong>Family</strong> tab, find <strong>Access requests</strong>, and choose Approve or Deny.</p>
  <p style="font-size:12px;color:#666;margin-top:24px">
    Sent by CareCircle Sovereign Edition. If you do not recognize this person, deny the request; nothing has been shared.
  </p>
</div>`.trim();
  return sendEmail({ to: args.to, subject, html });
}

function neutral(extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, message: NEUTRAL_MESSAGE, ...extra }, { status: 202 });
}

export async function POST(req: NextRequest) {
  try {
    const envErr = envProblem();
    if (envErr) {
      console.error('[request-access POST] env', envErr);
      return bad('server misconfigured', 500);
    }

    if (!(await checkRateLimit(RL_POST, clientIp(req)))) {
      return bad('rate limit exceeded, please slow down', 429);
    }

    let body: RequestBody;
    try {
      body = (await req.json()) as RequestBody;
    } catch {
      return bad('invalid json body');
    }

    const patientEmail = (body.patient_email || '').trim().toLowerCase();
    const requesterName = (body.requester_name || '').trim();
    const requesterEmailRaw = (body.requester_email || '').trim().toLowerCase();
    const requesterPhone = (body.requester_phone || '').trim() || null;
    const relationship = (body.relationship || '').trim();
    const message = (body.message || '').trim().slice(0, 500) || null;
    const password = body.password || '';

    if (!isEmail(patientEmail)) return bad("a valid email for your elder is required");
    if (!requesterName) return bad('requester_name required');
    if (!(RELATIONSHIPS as readonly string[]).includes(relationship)) {
      return bad('relationship must be one of: ' + RELATIONSHIPS.join(', '));
    }

    // ----- Resolve or create the requester's account ------------------------
    let requesterId: string | null = null;
    let requesterEmail = requesterEmailRaw;
    let session: SessionTokens | null = null;
    let createdAccount = false;

    const token = bearerToken(req);
    if (token) {
      requesterId = await getUserId(token);
      if (!requesterId) return bad('invalid session', 401);
      const me = await getAuthUser(requesterId);
      if (me?.email) requesterEmail = me.email.toLowerCase();
      if (!isEmail(requesterEmail)) return bad('a valid requester email is required');
    } else {
      if (!isEmail(requesterEmail)) return bad('a valid requester email is required');
      const existing = await findAuthUserByEmail(requesterEmail);
      if (existing) {
        return bad('an account with this email already exists, sign in first', 409);
      }
      const pw = validatePassword(password, { email: requesterEmail, name: requesterName });
      if (!pw.ok) return bad(pw.reason || 'password does not meet requirements');

      const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...SERVICE_HEADERS },
        body: JSON.stringify({
          email: requesterEmail,
          password,
          email_confirm: true,
          user_metadata: { full_name: requesterName, role: 'care_circle_member' },
        }),
      });
      if (!createRes.ok) {
        const txt = await createRes.text();
        if (
          createRes.status === 422 ||
          txt.includes('already been registered') ||
          txt.includes('already exists') ||
          txt.includes('User already registered')
        ) {
          return bad('an account with this email already exists, sign in first', 409);
        }
        console.error('[request-access POST] auth create', createRes.status, txt.slice(0, 240));
        return bad('could not create your account', 500);
      }
      const created = (await createRes.json()) as { id: string };
      requesterId = created.id;
      createdAccount = true;

      const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ email: requesterEmail, password }),
      });
      if (tokenRes.ok) {
        const t = (await tokenRes.json()) as SessionTokens;
        session = { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at };
      }
    }

    const accountExtra = createdAccount ? { session, user_id: requesterId } : {};

    // ----- Patient lookup: every non-match is the same neutral answer ------
    if (patientEmail === requesterEmail) return neutral(accountExtra);

    const patient = await findAuthUserByEmail(patientEmail);
    if (!patient) return neutral(accountExtra);
    if (patient.id === requesterId) return neutral(accountExtra);

    // A Health OS patient is a user without the care_circle_member role. A
    // family member's own account is never a valid target.
    const role = patient.user_metadata?.role;
    if (role === 'care_circle_member') return neutral(accountExtra);

    if (await isMember(patient.id, requesterId as string)) return neutral(accountExtra);

    const patientName = displayName(patient);
    const insertRes = await sb(
      'POST',
      'care_circle_access_requests',
      [
        {
          patient_id: patient.id,
          patient_name: patientName,
          requester_user_id: requesterId,
          requester_email: requesterEmail,
          requester_name: requesterName,
          requester_phone: requesterPhone,
          relationship,
          message,
        },
      ],
      'return=minimal',
    );
    if (!insertRes.ok) {
      const txt = await insertRes.text();
      // A pending request already exists for this pair (partial unique
      // index). That is fine: the elder already has it in front of them.
      const duplicate = insertRes.status === 409 || txt.includes('23505') || txt.includes('duplicate');
      if (!duplicate) {
        console.error('[request-access POST] insert', insertRes.status, txt.slice(0, 240));
        return bad('could not record your request', 500);
      }
      return neutral(accountExtra);
    }

    if (patient.email) {
      const mail = await notifyPatient({
        to: patient.email,
        patientName,
        requesterName,
        relationship,
      });
      if (!mail.sent) console.error('[request-access POST] email', mail.reason || 'not sent');
    }

    return neutral(accountExtra);
  } catch (e) {
    console.error('[request-access POST] threw', (e as Error)?.message || 'unknown');
    return bad('Internal error', 500);
  }
}

export async function GET(req: NextRequest) {
  try {
    const envErr = envProblem();
    if (envErr) return bad('server misconfigured', 500);

    const userId = await getUserId(bearerToken(req));
    if (!userId) return bad('authentication required', 401);

    if (!(await checkRateLimit(RL_GET, userId))) {
      return bad('rate limit exceeded, please slow down', 429);
    }

    const url = new URL(req.url);
    const mine = url.searchParams.get('mine') === '1';
    const patientId = (url.searchParams.get('patient_id') || '').trim();

    let path: string;
    if (mine) {
      path = `care_circle_access_requests?requester_user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc`;
    } else if (patientId) {
      if (!(await isAdminFor(patientId, userId))) return bad('forbidden', 403);
      path = `care_circle_access_requests?patient_id=eq.${encodeURIComponent(patientId)}&select=*&order=created_at.desc`;
    } else {
      return bad('mine=1 or patient_id required');
    }

    const r = await sb('GET', path);
    if (!r.ok) return bad(`Supabase ${r.status}`, 502);
    const requests = (await r.json()) as AccessRequestRow[];
    return NextResponse.json({ requests });
  } catch (e) {
    console.error('[request-access GET] threw', (e as Error)?.message || 'unknown');
    return bad('Internal error', 500);
  }
}
