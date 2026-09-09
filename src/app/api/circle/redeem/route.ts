import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { validatePassword } from '@/lib/password-policy';

export const runtime = 'edge';

// Invite codes are 8 chars from a 32-char alphabet. Rate-limit by IP to make
// brute-forcing a valid code over the validate (GET) and redeem (POST)
// endpoints impractical.
const RL_GET = { name: 'redeem-get', max: 30, windowSeconds: 60 };
const RL_POST = { name: 'redeem-post', max: 10, windowSeconds: 60 };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const ALERT_LEVELS = ['critical', 'informational'] as const;
type AlertLevel = (typeof ALERT_LEVELS)[number];

const CARE_ROLES = ['admin', 'caregiver', 'viewer'] as const;
type CareRole = (typeof CARE_ROLES)[number];

interface RedeemBody {
  code?: string;
  email?: string;
  password?: string;
  member_name?: string;
  member_phone?: string;
  relationship?: string;
  alert_level?: string;
  care_role?: string;
  role?: string;
}

interface InviteRow {
  id: string;
  code: string;
  patient_id: string;
  patient_name: string | null;
  suggested_relationship: string | null;
  suggested_alert_level: AlertLevel | null;
  suggested_role: CareRole | null;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function bad(message: string, status = 400, debug?: unknown) {
  const body: Record<string, unknown> = { error: message };
  if (debug !== undefined) body.debug = debug;
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
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

interface LookupResult {
  invite: InviteRow | null;
  status: number;
  bodyText: string;
}

async function lookupInvite(code: string): Promise<LookupResult> {
  const url = `${SUPABASE_URL}/rest/v1/care_circle_invites?code=eq.${encodeURIComponent(code)}&select=*&limit=1`;
  const r = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    cache: 'no-store',
  });
  const bodyText = await r.text();
  if (!r.ok) {
    return { invite: null, status: r.status, bodyText };
  }
  let rows: InviteRow[] = [];
  try {
    rows = JSON.parse(bodyText) as InviteRow[];
  } catch {
    return { invite: null, status: r.status, bodyText: 'unparseable JSON' };
  }
  return { invite: rows[0] || null, status: r.status, bodyText };
}

function inviteUsable(invite: InviteRow): { ok: true } | { ok: false; reason: string } {
  if (invite.revoked_at) return { ok: false, reason: 'invite has been revoked' };
  if (invite.used_at) return { ok: false, reason: 'invite has already been redeemed' };
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'invite has expired' };
  }
  return { ok: true };
}

// Atomically claim an invite: a single conditional UPDATE that flips
// used_at from null -> now(), matching only rows that are still unused and
// unrevoked. PostgREST applies the WHERE-clause server-side, so of N
// concurrent redemptions exactly one gets a non-empty representation back
// and the rest see zero rows. This is the compare-and-set that closes the
// check-then-act race where two requests both pass inviteUsable() before
// either marks the code used. Returns 'claimed' for the winner, 'already'
// for losers/duplicates, and 'error' on any transport/DB failure.
async function claimInvite(
  inviteId: string,
  usedAt: string,
): Promise<'claimed' | 'already' | 'error'> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/care_circle_invites` +
      `?id=eq.${encodeURIComponent(inviteId)}&used_at=is.null&revoked_at=is.null`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ used_at: usedAt }),
    },
  );
  if (!r.ok) return 'error';
  const rows = (await r.json().catch(() => [])) as unknown[];
  return Array.isArray(rows) && rows.length > 0 ? 'claimed' : 'already';
}

// Release a claim we took but could not complete (e.g. the auth-user
// creation or circle insert failed), so the code stays usable for a retry.
// Best-effort: a failure here only means the code remains consumed.
async function releaseInvite(inviteId: string): Promise<void> {
  await fetch(
    `${SUPABASE_URL}/rest/v1/care_circle_invites?id=eq.${encodeURIComponent(inviteId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({ used_at: null, used_by: null }),
    },
  ).catch(() => {});
}

// Backfill patient_name when the invite row was written with null. The
// patient is a Supabase auth user (CareIQ schema: patients.id = auth.uid()),
// and the patients table itself stores only an AES-256-GCM-encrypted
// profile blob that care-os cannot read without CareIQ's vault key. So we
// derive the display name from the auth.users metadata that the patient
// completed during onboarding, falling back to the email local-part if
// metadata is empty too. Anything we resolve here is also written into
// care_circle.patient_name so /login on a return visit can read it
// without going through this fallback again.
async function resolvePatientName(patientId: string): Promise<string | null> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(patientId)}`,
      {
        headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
        cache: 'no-store',
      },
    );
    if (!r.ok) return null;
    const data = (await r.json()) as {
      email?: string;
      user_metadata?: Record<string, unknown>;
    };
    const meta = data.user_metadata || {};
    const fullName =
      typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
    if (fullName) return fullName;
    const name = typeof meta.name === 'string' ? meta.name.trim() : '';
    if (name) return name;
    const first = typeof meta.first_name === 'string' ? meta.first_name.trim() : '';
    const last = typeof meta.last_name === 'string' ? meta.last_name.trim() : '';
    const composed = [first, last].filter(Boolean).join(' ').trim();
    if (composed) return composed;
    if (typeof data.email === 'string' && data.email.includes('@')) {
      const local = data.email.split('@')[0].trim();
      if (local) return local;
    }
    return null;
  } catch {
    return null;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const envErr = envProblem();
    if (envErr) {
      console.error('[redeem GET] env', envErr);
      return bad('server misconfigured', 500, { env: envErr });
    }

    if (!(await checkRateLimit(RL_GET, clientIp(req)))) {
      return bad('rate limit exceeded, please slow down', 429);
    }

    const url = new URL(req.url);
    const code = (url.searchParams.get('code') || '').trim().toUpperCase();
    if (!code) return bad('code required');

    const { invite, status, bodyText } = await lookupInvite(code);
    if (status !== 200) {
      console.error('[redeem GET]', `code:${code}`, 'supabase status', status, bodyText.slice(0, 240));
      return bad('lookup failed', 502, {
        supabase_status: status,
        supabase_body: bodyText.slice(0, 240),
      });
    }
    if (!invite) return bad('invite not found', 404);

    const usable = inviteUsable(invite);
    if (!usable.ok) return bad(usable.reason, 410);

    // GET also returns the resolved name so the signup page header reads
    // "Join {name}'s Care Circle" correctly even when the invite row was
    // written with patient_name=null.
    const resolvedName =
      invite.patient_name || (await resolvePatientName(invite.patient_id));

    return NextResponse.json(
      {
        valid: true,
        patient_name: resolvedName,
        suggested_relationship: invite.suggested_relationship,
        suggested_alert_level: invite.suggested_alert_level,
        expires_at: invite.expires_at,
      },
      { headers: CORS_HEADERS },
    );
  } catch (e) {
    const msg = (e as Error)?.message || 'unknown';
    console.error('[redeem GET] threw', msg);
    return bad('Internal error', 500, { exception: msg });
  }
}

export async function POST(req: NextRequest) {
  try {
    const envErr = envProblem();
    if (envErr) {
      console.error('[redeem POST] env', envErr);
      return bad('server misconfigured', 500, { env: envErr });
    }

    if (!(await checkRateLimit(RL_POST, clientIp(req)))) {
      return bad('rate limit exceeded, please slow down', 429);
    }

    const body = (await req.json()) as RedeemBody;
    const code = (body.code || '').trim().toUpperCase();
    const email = (body.email || '').trim().toLowerCase();
    const password = body.password || '';
    const member_name = (body.member_name || '').trim();
    const member_phone = (body.member_phone || '').trim() || null;
    const relationship = (body.relationship || '').trim();
    const rawLevel = (body.alert_level || '').trim();

    if (!code) return bad('code required');
    if (!isEmail(email)) return bad('valid email required');
    if (!member_name) return bad('member_name required');
    const pw = validatePassword(password, { email, name: member_name });
    if (!pw.ok) return bad(pw.reason || 'password does not meet requirements');

    const { invite, status, bodyText } = await lookupInvite(code);
    if (status !== 200) {
      console.error('[redeem POST]', `code:${code}`, 'supabase status', status, bodyText.slice(0, 240));
      return bad('lookup failed', 502, {
        supabase_status: status,
        supabase_body: bodyText.slice(0, 240),
      });
    }
    if (!invite) return bad('invite not found', 404);
    const usable = inviteUsable(invite);
    if (!usable.ok) return bad(usable.reason, 410);

    // Resolve patient_name with auth-metadata fallback so the cc-session
    // and care_circle row both get a usable display name, even if the
    // invite was created without one.
    const patientName =
      invite.patient_name || (await resolvePatientName(invite.patient_id));

    const finalRelationship =
      relationship || invite.suggested_relationship || 'Family';
    const finalAlertLevel: AlertLevel =
      ((rawLevel as AlertLevel) || invite.suggested_alert_level || 'informational');
    if (!ALERT_LEVELS.includes(finalAlertLevel)) {
      return bad('alert_level must be "critical" or "informational"');
    }

    // Resolve the member's access role. The invite's suggested_role (set by
    // the patient) is authoritative; a client-supplied role may only NARROW
    // it, never escalate — so a viewer invite can't be redeemed as an admin.
    const suggestedRole: CareRole = invite.suggested_role || 'caregiver';
    const requestedRole = (body.care_role || body.role || '').trim() as CareRole;
    const RANK: Record<CareRole, number> = { viewer: 0, caregiver: 1, admin: 2 };
    let finalRole: CareRole = suggestedRole;
    if (CARE_ROLES.includes(requestedRole) && RANK[requestedRole] < RANK[suggestedRole]) {
      finalRole = requestedRole;
    }

    // Atomically claim the invite BEFORE creating any account. inviteUsable()
    // above is only an early, friendly-error check; this conditional UPDATE
    // is the authority on single-use. If we lose the race (or the code was
    // already redeemed), stop here — no user is created.
    const claimedAt = new Date().toISOString();
    const claim = await claimInvite(invite.id, claimedAt);
    if (claim === 'error') {
      return bad('lookup failed', 502);
    }
    if (claim === 'already') {
      return bad('invite has already been redeemed', 410);
    }

    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: member_name, role: 'care_circle_member' },
      }),
    });

    if (!createRes.ok) {
      const txt = await createRes.text();
      // The redemption did not consume the invite — release our claim so the
      // code can be retried (e.g. with a different email).
      await releaseInvite(invite.id);
      if (
        createRes.status === 422 ||
        txt.includes('already been registered') ||
        txt.includes('already exists') ||
        txt.includes('User already registered')
      ) {
        return bad('an account with this email already exists', 409);
      }
      console.error('[redeem POST] auth create', createRes.status, txt.slice(0, 240));
      return bad('auth create failed', 500, {
        supabase_status: createRes.status,
        supabase_body: txt.slice(0, 240),
      });
    }
    const newUser = (await createRes.json()) as { id: string; email: string };

    // Insert care_circle row. patient_name is denormalized so /login can
    // restore it without re-querying care_circle_invites or auth.users.
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/care_circle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify([
        {
          patient_id: invite.patient_id,
          patient_name: patientName,
          member_user_id: newUser.id,
          member_email: email,
          member_name,
          member_phone,
          relationship: finalRelationship,
          alert_level: finalAlertLevel,
          care_role: finalRole,
          invite_id: invite.id,
        },
      ]),
    });

    if (!insertRes.ok) {
      const txt = await insertRes.text();
      await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${newUser.id}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      });
      // Roll back the claim too so the invite is reusable after this failure.
      await releaseInvite(invite.id);
      console.error('[redeem POST] circle insert', insertRes.status, txt.slice(0, 240));
      return bad('circle insert failed', 500, {
        supabase_status: insertRes.status,
        supabase_body: txt.slice(0, 240),
      });
    }
    const circleRow = ((await insertRes.json()) as Array<Record<string, unknown>>)[0];

    // If we backfilled the name (i.e., the invite row had null), patch the
    // invite row so any later GET on the same code also surfaces the name.
    // Best-effort: a failure here does not break the redeem flow.
    if (!invite.patient_name && patientName) {
      await fetch(
        `${SUPABASE_URL}/rest/v1/care_circle_invites?id=eq.${invite.id}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: SERVICE_ROLE,
            Authorization: `Bearer ${SERVICE_ROLE}`,
          },
          body: JSON.stringify({ patient_name: patientName }),
        },
      ).catch(() => {});
    }

    // used_at was already set atomically at claim time; just record who
    // redeemed it. Best-effort — the invite is already consumed either way.
    await fetch(
      `${SUPABASE_URL}/rest/v1/care_circle_invites?id=eq.${invite.id}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
        body: JSON.stringify({ used_by: newUser.id }),
      },
    ).catch(() => {});

    const tokenRes = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
        body: JSON.stringify({ email, password }),
      },
    );
    const session = tokenRes.ok ? await tokenRes.json() : null;

    return NextResponse.json(
      {
        ok: true,
        user: { id: newUser.id, email: newUser.email },
        circle: circleRow,
        patient: { id: invite.patient_id, name: patientName },
        session,
      },
      { headers: CORS_HEADERS },
    );
  } catch (e) {
    const msg = (e as Error)?.message || 'unknown';
    console.error('[redeem POST] threw', msg);
    return bad('Internal error', 500, { exception: msg });
  }
}
