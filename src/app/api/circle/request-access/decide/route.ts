import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getUserId } from '@/lib/api-auth';
import { logPhiAccess, requestContext } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendEmail } from '@/lib/providers/email';

export const runtime = 'edge';

/**
 * The elder (or an existing circle admin) approves or denies a
 * family-initiated access request. Approval creates the care_circle row
 * with the role and alert level the elder chose; denial only records the
 * decision. Both outcomes are written to the PHI access log.
 */

const RATE_LIMIT = { name: 'request-access-decide', max: 30, windowSeconds: 60 };

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://carecircle-sovereign.vercel.app').replace(/\/$/, '');

const CARE_ROLES = ['admin', 'caregiver', 'viewer'] as const;
type CareRole = (typeof CARE_ROLES)[number];
const ALERT_LEVELS = ['critical', 'informational'] as const;
type AlertLevel = (typeof ALERT_LEVELS)[number];

interface DecideBody {
  request_id?: string;
  decision?: string;
  care_role?: string;
  alert_level?: string;
}

interface RequestRow {
  id: string;
  patient_id: string;
  patient_name: string | null;
  requester_user_id: string;
  requester_email: string;
  requester_name: string;
  requester_phone: string | null;
  relationship: string;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  expires_at: string;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
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

async function patientNameFromAuth(patientId: string): Promise<string | null> {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(patientId)}`, {
      headers: SERVICE_HEADERS,
      cache: 'no-store',
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { email?: string; user_metadata?: Record<string, unknown> };
    const meta = data.user_metadata || {};
    const full = typeof meta.full_name === 'string' ? meta.full_name.trim() : '';
    if (full) return full;
    const name = typeof meta.name === 'string' ? meta.name.trim() : '';
    if (name) return name;
    if (typeof data.email === 'string' && data.email.includes('@')) {
      const local = data.email.split('@')[0].trim();
      if (local) return local;
    }
    return null;
  } catch {
    return null;
  }
}

async function notifyRequester(args: {
  to: string;
  requesterName: string;
  patientName: string | null;
  approved: boolean;
  role?: CareRole;
  alert?: AlertLevel;
}) {
  const who = args.patientName || 'your elder';
  const subject = args.approved
    ? `You are in ${who}'s Care Circle`
    : `Your request to join ${who}'s Care Circle was not approved`;
  const body = args.approved
    ? `<p>${who} approved your request. You can see their circle as a <strong>${args.role}</strong> and you will receive <strong>${args.alert === 'critical' ? 'critical alerts only' : 'all alerts'}</strong>.</p>
  <p><a href="${APP_URL}/login" style="display:inline-block;padding:10px 18px;background:#3D8B5E;color:#fff;text-decoration:none;border-radius:6px">Sign in to CareCircle</a></p>`
    : `<p>${who} did not approve this request. If you think this was a mistake, talk with them directly; you can ask again later.</p>`;
  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <h2 style="color:#3D8B5E;margin:0 0 12px">${args.approved ? 'Welcome to the Care Circle' : 'About your access request'}</h2>
  <p>Hi ${args.requesterName},</p>
  ${body}
  <p style="font-size:12px;color:#666;margin-top:24px">Sent by CareCircle Sovereign Edition.</p>
</div>`.trim();
  return sendEmail({ to: args.to, subject, html });
}

export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE) return bad('server misconfigured', 500);

    const userId = await getUserId(bearerToken(req));
    if (!userId) return bad('authentication required', 401);
    if (!(await checkRateLimit(RATE_LIMIT, userId))) return bad('rate limit exceeded, please slow down', 429);

    let body: DecideBody;
    try {
      body = (await req.json()) as DecideBody;
    } catch {
      return bad('invalid json body');
    }
    const requestId = (body.request_id || '').trim();
    const decision = (body.decision || '').trim();
    if (!requestId) return bad('request_id required');
    if (decision !== 'approve' && decision !== 'deny') return bad('decision must be "approve" or "deny"');

    const careRole = ((body.care_role || 'viewer').trim() as CareRole);
    if (!CARE_ROLES.includes(careRole)) return bad('care_role must be admin, caregiver, or viewer');
    const alertLevel = ((body.alert_level || 'critical').trim() as AlertLevel);
    if (!ALERT_LEVELS.includes(alertLevel)) return bad('alert_level must be "critical" or "informational"');

    const lookup = await sb('GET', `care_circle_access_requests?id=eq.${encodeURIComponent(requestId)}&select=*&limit=1`);
    if (!lookup.ok) return bad(`Supabase ${lookup.status}`, 502);
    const rows = (await lookup.json()) as RequestRow[];
    const request = rows[0];
    if (!request) return bad('request not found', 404);

    if (!(await isAdminFor(request.patient_id, userId))) return bad('forbidden', 403);
    if (request.status !== 'pending') return bad(`request is already ${request.status}`, 409);
    if (new Date(request.expires_at).getTime() < Date.now()) return bad('request has expired', 410);

    const decidedAt = new Date().toISOString();
    const ctx = requestContext(req.headers);

    if (decision === 'deny') {
      const patch = await sb(
        'PATCH',
        `care_circle_access_requests?id=eq.${encodeURIComponent(request.id)}&status=eq.pending`,
        { status: 'denied', decided_by: userId, decided_at: decidedAt },
        'return=representation',
      );
      if (!patch.ok) return bad('could not record the decision', 500);
      const updated = (await patch.json().catch(() => [])) as unknown[];
      if (!Array.isArray(updated) || updated.length === 0) return bad('request is no longer pending', 409);

      await logPhiAccess({
        patientId: request.patient_id,
        actorUserId: userId,
        action: 'access_request_denied',
        resourceType: 'care_circle_access_request',
        resourceId: request.id,
        detail: { relationship: request.relationship },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });

      const mail = await notifyRequester({
        to: request.requester_email,
        requesterName: request.requester_name,
        patientName: request.patient_name,
        approved: false,
      });
      if (!mail.sent) console.error('[decide] deny email', mail.reason || 'not sent');

      return NextResponse.json({ ok: true, status: 'denied' });
    }

    // ----- Approve: create the membership, then close the request ---------
    const patientName = request.patient_name || (await patientNameFromAuth(request.patient_id));
    const insert = await sb(
      'POST',
      'care_circle',
      [
        {
          patient_id: request.patient_id,
          patient_name: patientName,
          member_user_id: request.requester_user_id,
          member_email: request.requester_email,
          member_name: request.requester_name,
          member_phone: request.requester_phone,
          relationship: request.relationship,
          alert_level: alertLevel,
          care_role: careRole,
        },
      ],
      'return=representation',
    );
    if (!insert.ok) {
      const txt = await insert.text();
      console.error('[decide] circle insert', insert.status, txt.slice(0, 240));
      return bad('could not add the member to the circle', 500);
    }
    const circleRow = ((await insert.json().catch(() => [])) as Array<Record<string, unknown>>)[0] ?? null;

    const patch = await sb(
      'PATCH',
      `care_circle_access_requests?id=eq.${encodeURIComponent(request.id)}&status=eq.pending`,
      {
        status: 'approved',
        granted_role: careRole,
        granted_alert: alertLevel,
        decided_by: userId,
        decided_at: decidedAt,
        patient_name: patientName,
      },
      'return=representation',
    );
    if (!patch.ok) {
      console.error('[decide] request patch', patch.status, (await patch.text()).slice(0, 240));
    }

    await logPhiAccess({
      patientId: request.patient_id,
      actorUserId: userId,
      action: 'access_request_approved',
      resourceType: 'care_circle_access_request',
      resourceId: request.id,
      detail: { relationship: request.relationship, care_role: careRole, alert_level: alertLevel },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    const mail = await notifyRequester({
      to: request.requester_email,
      requesterName: request.requester_name,
      patientName,
      approved: true,
      role: careRole,
      alert: alertLevel,
    });
    if (!mail.sent) console.error('[decide] approve email', mail.reason || 'not sent');

    return NextResponse.json({ ok: true, status: 'approved', circle: circleRow });
  } catch (e) {
    console.error('[decide] threw', (e as Error)?.message || 'unknown');
    return bad('Internal error', 500);
  }
}
