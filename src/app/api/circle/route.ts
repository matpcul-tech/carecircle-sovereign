import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getUserId, isPatientOrMember } from '@/lib/api-auth';
import { checkRateLimit, clientIp } from '@/lib/rate-limit';
import { sendEmail } from '@/lib/providers/email';

export const runtime = 'edge';

const RATE_LIMIT = { name: 'circle', max: 60, windowSeconds: 60 };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Resolve the caller and confirm they may operate on `patientId`. Returns an
 * error NextResponse to short-circuit with, or null when authorized.
 */
async function authorizeForPatient(
  req: NextRequest,
  patientId: string,
): Promise<NextResponse | null> {
  const userId = await getUserId(bearerToken(req));
  if (!userId) return bad('authentication required', 401);
  if (!(await isPatientOrMember(userId, patientId))) {
    return bad('forbidden', 403);
  }
  return null;
}
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://care-os.vercel.app';

const ALERT_LEVELS = ['critical', 'informational'] as const;
type AlertLevel = (typeof ALERT_LEVELS)[number];

const CARE_ROLES = ['admin', 'caregiver', 'viewer'] as const;
type CareRole = (typeof CARE_ROLES)[number];

interface AddMemberBody {
  patient_id?: string;
  patientId?: string;
  member_email?: string;
  member_name?: string;
  relationship?: string;
  alert_level?: string;
  care_role?: string;
  role?: string;
  patient_name?: string;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

async function sb(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  prefer?: string,
) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
}

async function sendInviteEmail(args: {
  to: string;
  memberName: string;
  patientName: string;
  relationship: string;
  alertLevel: AlertLevel;
}) {
  const subject = `You've been invited to ${args.patientName}'s Care Circle`;
  const cadence =
    args.alertLevel === 'critical'
      ? 'critical health alerts only'
      : 'all informational and critical health alerts';

  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <h2 style="color:#3D8B5E;margin:0 0 12px">Welcome to the Care Circle</h2>
  <p>Hi ${args.memberName},</p>
  <p>You've been added to <strong>${args.patientName}</strong>'s CareCircle as their <strong>${args.relationship}</strong>.</p>
  <p>You'll receive <strong>${cadence}</strong>.</p>
  <p>
    <a href="${APP_URL}" style="display:inline-block;padding:10px 18px;background:#3D8B5E;color:#fff;text-decoration:none;border-radius:6px">
      Open CareCircle
    </a>
  </p>
  <p style="font-size:12px;color:#666;margin-top:24px">
    Sent by CareCircle. Health alerts name the metric and guidance only — never raw lab values.
  </p>
</div>`.trim();

  return sendEmail({ to: args.to, subject, html });
}

export async function GET(req: NextRequest) {
  try {
    if (!(await checkRateLimit(RATE_LIMIT, clientIp(req)))) {
      return bad('rate limit exceeded, please slow down', 429);
    }

    const url = new URL(req.url);
    const patientId = url.searchParams.get('patient_id') || url.searchParams.get('patientId');
    if (!patientId) return bad('patient_id required');

    const denied = await authorizeForPatient(req, patientId);
    if (denied) return denied;

    const r = await sb(
      'GET',
      `care_circle?patient_id=eq.${encodeURIComponent(patientId)}&order=created_at.desc`,
    );
    if (!r.ok) return bad(`Supabase ${r.status}: ${await r.text()}`, 500);

    const members = await r.json();
    return NextResponse.json({ members });
  } catch {
    return bad('Internal error', 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await checkRateLimit(RATE_LIMIT, clientIp(req)))) {
      return bad('rate limit exceeded, please slow down', 429);
    }

    const body = (await req.json()) as AddMemberBody;
    const patientId = body.patient_id || body.patientId;
    const member_email = (body.member_email || '').trim().toLowerCase();
    const member_name = (body.member_name || '').trim();
    const relationship = (body.relationship || '').trim();
    const alert_level = ((body.alert_level || 'informational').trim() as AlertLevel);
    const care_role = ((body.care_role || body.role || 'caregiver').trim() as CareRole);

    if (!patientId) return bad('patient_id required');
    if (!isEmail(member_email)) return bad('valid member_email required');
    if (!member_name) return bad('member_name required');
    if (!relationship) return bad('relationship required');
    if (!ALERT_LEVELS.includes(alert_level)) {
      return bad('alert_level must be "critical" or "informational"');
    }
    if (!CARE_ROLES.includes(care_role)) {
      return bad('care_role must be "admin", "caregiver", or "viewer"');
    }

    const denied = await authorizeForPatient(req, patientId);
    if (denied) return denied;

    const insertRes = await sb(
      'POST',
      'care_circle',
      [{ patient_id: patientId, member_email, member_name, relationship, alert_level, care_role }],
      'return=representation',
    );

    if (!insertRes.ok) {
      const txt = await insertRes.text();
      if (insertRes.status === 409 || txt.includes('duplicate')) {
        return bad(`${member_email} is already in this Care Circle`, 409);
      }
      return bad(`Supabase ${insertRes.status}: ${txt}`, 500);
    }

    const rows = (await insertRes.json()) as Array<Record<string, unknown>>;
    const inserted = rows[0];

    const invite = await sendInviteEmail({
      to: member_email,
      memberName: member_name,
      patientName: body.patient_name || 'a CareCircle patient',
      relationship,
      alertLevel: alert_level,
    });

    return NextResponse.json({ member: inserted, invite });
  } catch {
    return bad('Internal error', 500);
  }
}
