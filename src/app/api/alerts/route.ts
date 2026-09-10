import { NextRequest, NextResponse } from 'next/server';
import { logPhiAccess, requestContext } from '@/lib/audit';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendEmail } from '@/lib/providers/email';
import { sendSms } from '@/lib/providers/sms';

export const runtime = 'edge';

const RATE_LIMIT = { name: 'alerts', max: 120, windowSeconds: 60 };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const HEALTH_OS_ALERT_SIGNING_KEY = process.env.HEALTH_OS_ALERT_SIGNING_KEY;
const SIGNATURE_MAX_AGE_SEC = 300;

type Severity = 'critical' | 'informational';

interface Vitals {
  a1c?: number | null;
  ldl?: number | null;
  bp_systolic?: number | null;
  bp_diastolic?: number | null;
  // Wearable readings. Unlike the labs above these arrive continuously, so
  // they are the ones that can catch a problem the same day it happens.
  hr?: number | null;
  spo2?: number | null;
}

interface PanelGradeChange {
  prev_grade: string;
  new_grade: string;
  flagged?: number;
  in_range?: number;
}

interface AlertsBody {
  patient_id?: string;
  patientId?: string;
  vitals?: Vitals;
  panel_grade_change?: PanelGradeChange;
}

interface Flag {
  metric: string;
  severity: Severity;
  recommendation: string;
}

interface CircleMember {
  id: string;
  member_email: string;
  member_name: string;
  member_phone: string | null;
  alert_level: Severity;
}

interface DeliveryResult {
  member_id: string;
  email: string;
  sent: boolean;
  id?: string | null;
  reason?: string;
  severity_sent: Severity;
}

interface SmsResult {
  member_id: string;
  phone: string;
  sent: boolean;
  sid?: string | null;
  reason?: string;
}

interface PersistedAlert {
  id: string;
  metric: string;
  severity: Severity;
  fired_at: string;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function evaluate(v: Vitals): Flag[] {
  const flags: Flag[] = [];

  if (typeof v.a1c === 'number' && v.a1c > 6.4) {
    flags.push({
      metric: 'A1C',
      severity: 'informational',
      recommendation:
        'Hemoglobin A1C is above target. Schedule a primary-care follow-up within 14 days and review medication adherence.',
    });
  }

  if (typeof v.ldl === 'number' && v.ldl > 200) {
    flags.push({
      metric: 'LDL Cholesterol',
      severity: 'critical',
      recommendation:
        'LDL is significantly elevated. Contact the primary-care provider this week to discuss statin therapy and dietary changes.',
    });
  }

  // ---- Wearable metrics ---------------------------------------------------
  // A wrist sensor is not a medical device: a cold hand or a loose band can
  // fake a bad reading, so every flag below says to confirm before acting.
  // The critical bands are the ones worth waking a caregiver for; the
  // informational ones are "look at this today", so the thresholds stay
  // conservative rather than firing on every stray sample.
  const spo2 = typeof v.spo2 === 'number' ? v.spo2 : null;
  if (spo2 !== null && spo2 < 88) {
    flags.push({
      metric: 'Blood Oxygen',
      severity: 'critical',
      recommendation:
        'Blood oxygen is critically low. Check on them now. Call 911 if they are short of breath, confused, or their lips or face look blue. Re-check with a fingertip pulse oximeter - a cold hand or loose watch band can produce a false low reading.',
    });
  } else if (spo2 !== null && spo2 < 93) {
    flags.push({
      metric: 'Blood Oxygen',
      severity: 'informational',
      recommendation:
        'Blood oxygen is below the normal range. Have them sit up, rest, and re-check with a fingertip pulse oximeter. Contact the care team today if it stays below 93% or if they feel breathless.',
    });
  }

  const hr = typeof v.hr === 'number' ? v.hr : null;
  if (hr !== null && (hr > 130 || hr < 40)) {
    flags.push({
      metric: 'Heart Rate',
      severity: 'critical',
      recommendation:
        hr > 130
          ? 'Heart rate is very high. Check on them now and confirm they are at rest - exercise explains most high readings. Call 911 if they have chest pain, trouble breathing, fainting, or confusion.'
          : 'Heart rate is very low. Check that they are awake and responsive. Call 911 if they are faint, dizzy, confused, or hard to rouse. Some heart medications lower the pulse by design, so mention this to the care team.',
    });
  } else if (hr !== null && (hr > 100 || hr < 50)) {
    flags.push({
      metric: 'Heart Rate',
      severity: 'informational',
      recommendation:
        'Heart rate is outside the usual resting range. Re-check after they have rested quietly for five minutes, and mention it to the care team if it stays there or comes with dizziness, breathlessness, or swelling.',
    });
  }

  const sys = typeof v.bp_systolic === 'number' ? v.bp_systolic : null;
  const dia = typeof v.bp_diastolic === 'number' ? v.bp_diastolic : null;
  if ((sys !== null && sys > 140) || (dia !== null && dia > 90)) {
    flags.push({
      metric: 'Blood Pressure',
      severity: 'critical',
      recommendation:
        'Blood pressure is above the safe range. Re-check within 24 hours and contact the care team if it remains elevated. Confirm BP medications were taken as prescribed.',
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Longevity panel-grade alerts (phase 4). Triggered by Chikasha Health OS when the
// patient's saved labs cause panel_grade to drop one or more letters.
// Signature is mandatory on any request that carries a panel_grade_change.
// ---------------------------------------------------------------------------

const GRADE_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };

function stepsDropped(prev: string, next: string): number {
  if (!(prev in GRADE_ORDER) || !(next in GRADE_ORDER)) return 0;
  return Math.max(0, GRADE_ORDER[next] - GRADE_ORDER[prev]);
}

function flagFromGradeChange(c: PanelGradeChange): Flag | null {
  const drop = stepsDropped(c.prev_grade, c.new_grade);
  if (drop <= 0) return null;
  const severity: Severity = drop >= 2 ? 'critical' : 'informational';
  const flaggedDesc =
    typeof c.flagged === 'number' ? `${c.flagged} biomarkers` : 'Multiple biomarkers';
  const recommendation =
    drop >= 2
      ? `Longevity panel grade dropped sharply from ${c.prev_grade} to ${c.new_grade}. ${flaggedDesc} are now outside the optimal range. Recommend a care-team review within 24 hours.`
      : `Longevity panel grade dropped from ${c.prev_grade} to ${c.new_grade}. ${flaggedDesc} are now outside the optimal range. Schedule a follow-up to review labs and lifestyle factors within 14 days.`;
  return {
    metric: 'Longevity Panel Grade',
    severity,
    recommendation,
  };
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyHmac(
  secret: string,
  ts: string,
  rawBody: string,
  expectedHex: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(ts + ':' + rawBody));
  const actual = toHex(new Uint8Array(sig));
  return constantTimeEqual(actual, expectedHex.toLowerCase());
}

// ---------------------------------------------------------------------------

async function sb(
  method: 'GET' | 'POST',
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

async function sendAlertEmail(args: {
  to: string;
  memberName: string;
  patientId: string;
  flags: Flag[];
}) {
  const hasCritical = args.flags.some((f) => f.severity === 'critical');
  const patientRef = args.patientId.slice(0, 8);
  const subject = hasCritical
    ? `[Critical] CareCircle health alert · Patient ${patientRef}`
    : `CareCircle health alert · Patient ${patientRef}`;

  const items = args.flags
    .map((f) => {
      const color = f.severity === 'critical' ? '#c0392b' : '#b07c00';
      return `
    <li style="margin:0 0 14px">
      <div style="font-weight:600;color:${color}">
        ${f.metric} · ${f.severity.toUpperCase()}
      </div>
      <div style="color:#333">${f.recommendation}</div>
    </li>`;
    })
    .join('');

  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <h2 style="color:#3D8B5E;margin:0 0 12px">CareCircle Health Alert</h2>
  <p>Hi ${args.memberName},</p>
  <p>The following metric(s) crossed a threshold and may need attention:</p>
  <ul style="padding-left:18px;margin:12px 0">${items}</ul>
  <p style="font-size:12px;color:#666;margin-top:24px;padding-top:12px;border-top:1px solid #eee">
    Patient reference: <code>${args.patientId}</code><br>
    This alert names the metric and guidance only — no raw lab values. Sign in to CareCircle for full context.
  </p>
</div>`.trim();

  return sendEmail({ to: args.to, subject, html });
}

function buildSmsBody(patientRef: string, criticalFlags: Flag[]): string {
  const lines: string[] = [
    `[CRITICAL] CareCircle alert (Patient ${patientRef}...)`,
  ];
  for (const f of criticalFlags) {
    lines.push(`* ${f.metric}: ${f.recommendation}`);
  }
  lines.push('Sign in to CareCircle for details. No lab values in this message.');
  const body = lines.join('\n');
  return body.length > 1500 ? `${body.slice(0, 1497)}...` : body;
}

async function persistAlerts(args: {
  patientId: string;
  flags: Flag[];
  members: CircleMember[];
  delivery: DeliveryResult[];
  smsDelivery: SmsResult[];
  firedAt: string;
}): Promise<{ alerts: PersistedAlert[]; persistError: string | null }> {
  const deliveryByMember = new Map<string, DeliveryResult>();
  for (const d of args.delivery) deliveryByMember.set(d.member_id, d);
  const smsByMember = new Map<string, SmsResult>();
  for (const s of args.smsDelivery) smsByMember.set(s.member_id, s);

  const visibleFor = (flag: Flag) =>
    args.members.filter(
      (m) => m.alert_level === 'informational' || flag.severity === 'critical',
    );

  const rows = args.flags.map((flag) => {
    const visible = visibleFor(flag);
    const sent: Array<{ member_id: string; email: string }> = [];
    const failed: Array<{ member_id: string; email: string; reason: string }> = [];
    const sms_sent: Array<{ member_id: string; phone: string }> = [];
    const sms_failed: Array<{ member_id: string; phone: string; reason: string }> = [];

    for (const m of visible) {
      const d = deliveryByMember.get(m.id);
      if (d?.sent) sent.push({ member_id: m.id, email: m.member_email });
      else if (d) failed.push({ member_id: m.id, email: m.member_email, reason: d.reason || 'failed' });

      if (flag.severity === 'critical') {
        const s = smsByMember.get(m.id);
        if (s?.sent) sms_sent.push({ member_id: m.id, phone: s.phone });
        else if (s) sms_failed.push({ member_id: m.id, phone: s.phone, reason: s.reason || 'failed' });
      }
    }

    return {
      patient_id: args.patientId,
      metric: flag.metric,
      severity: flag.severity,
      recommendation: flag.recommendation,
      fired_at: args.firedAt,
      delivery_count: sent.length,
      delivery_summary: { sent, failed, sms_sent, sms_failed },
    };
  });

  if (rows.length === 0) return { alerts: [], persistError: null };

  const r = await sb('POST', 'care_circle_alerts', rows, 'return=representation');
  if (!r.ok) {
    return {
      alerts: [],
      persistError: `care_circle_alerts insert ${r.status}: ${await r.text()}`,
    };
  }
  const inserted = (await r.json()) as Array<{
    id: string;
    metric: string;
    severity: Severity;
    fired_at: string;
  }>;
  return {
    alerts: inserted.map((a) => ({
      id: a.id,
      metric: a.metric,
      severity: a.severity,
      fired_at: a.fired_at,
    })),
    persistError: null,
  };
}

export async function POST(req: NextRequest) {
  try {
    // Read raw body once: HMAC verification needs the byte-exact body, then
    // we parse JSON.
    const rawBody = await req.text();

    let body: AlertsBody;
    try {
      body = JSON.parse(rawBody) as AlertsBody;
    } catch {
      return bad('invalid JSON');
    }

    const patientId = body.patient_id || body.patientId;
    if (!patientId) return bad('patient_id required');

    // Throttle per patient to bound alert-dispatch floods.
    if (!(await checkRateLimit(RATE_LIMIT, patientId))) {
      return bad('rate limit exceeded, please slow down', 429);
    }

    // ----- Authenticate EVERY alert request via the Chikasha Health OS HMAC signature.
    // Alerts fan out real emails and SMS to a patient's care circle, so every
    // path (vitals thresholds and panel-grade changes alike) must be signed —
    // not just grade changes. The signature covers the exact raw body, so it
    // also authenticates patient_id and vitals against tampering/replay.
    if (!HEALTH_OS_ALERT_SIGNING_KEY) {
      return bad('signing key not configured on carecircle-sovereign', 500);
    }
    const sigHeader = req.headers.get('x-alert-signature') || '';
    const tsHeader = req.headers.get('x-alert-timestamp') || '';
    if (!sigHeader || !tsHeader) {
      return bad('signature and timestamp headers required', 401);
    }
    const ts = Number(tsHeader);
    if (!Number.isFinite(ts)) {
      return bad('invalid timestamp', 401);
    }
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > SIGNATURE_MAX_AGE_SEC) {
      return bad('signature stale', 401);
    }
    const ok = await verifyHmac(
      HEALTH_OS_ALERT_SIGNING_KEY,
      tsHeader,
      rawBody,
      sigHeader,
    );
    if (!ok) {
      return bad('signature mismatch', 401);
    }

    // ----- Build flags from vitals threshold + grade change -----
    const vitalFlags: Flag[] = body.vitals && typeof body.vitals === 'object'
      ? evaluate(body.vitals)
      : [];
    const gradeFlag = body.panel_grade_change
      ? flagFromGradeChange(body.panel_grade_change)
      : null;
    const flags: Flag[] = [...vitalFlags];
    if (gradeFlag) flags.push(gradeFlag);

    if (flags.length === 0) {
      return NextResponse.json({
        flagged: false,
        flags: [],
        delivery: [],
        sms_delivery: [],
        alerts: [],
        sent_at: new Date().toISOString(),
      });
    }

    const r = await sb(
      'GET',
      `care_circle?patient_id=eq.${encodeURIComponent(patientId)}&select=id,member_email,member_name,member_phone,alert_level`,
    );
    if (!r.ok) return bad(`Supabase ${r.status}: ${await r.text()}`, 500);
    const allMembers = (await r.json()) as CircleMember[];

    const sentAt = new Date().toISOString();
    const criticalFlags = flags.filter((f) => f.severity === 'critical');
    const patientRef = patientId.slice(0, 8);

    const delivery: DeliveryResult[] = (
      await Promise.all(
        allMembers.map(async (m) => {
          const visible = m.alert_level === 'critical' ? criticalFlags : flags;
          if (visible.length === 0) return null;

          const result = await sendAlertEmail({
            to: m.member_email,
            memberName: m.member_name,
            patientId,
            flags: visible,
          });

          return {
            member_id: m.id,
            email: m.member_email,
            severity_sent: m.alert_level,
            ...result,
          } as DeliveryResult;
        }),
      )
    ).filter((d): d is DeliveryResult => d !== null);

    let smsDelivery: SmsResult[] = [];
    if (criticalFlags.length > 0) {
      const smsBody = buildSmsBody(patientRef, criticalFlags);
      const phoneMembers = allMembers.filter(
        (m): m is CircleMember & { member_phone: string } =>
          typeof m.member_phone === 'string' && m.member_phone.length > 0,
      );
      smsDelivery = await Promise.all(
        phoneMembers.map(async (m) => {
          const result = await sendSms({ to: m.member_phone, body: smsBody });
          return {
            member_id: m.id,
            phone: m.member_phone,
            sent: result.sent,
            sid: result.sid ?? null,
            ...(result.reason ? { reason: result.reason } : {}),
          };
        }),
      );
    }

    const { alerts, persistError } = await persistAlerts({
      patientId,
      flags,
      members: allMembers,
      delivery,
      smsDelivery,
      firedAt: sentAt,
    });

    // Audit the outbound dispatch (system-originated; no end-user actor).
    const emailsSent = delivery.filter((d) => d.sent).length;
    const smsSent = smsDelivery.filter((s) => s.sent).length;
    const ctx = requestContext(req.headers);
    await logPhiAccess({
      patientId,
      actorUserId: null,
      actorRole: 'system',
      action: 'alert_sent',
      resourceType: 'alert',
      detail: {
        metrics: flags.map((f) => f.metric),
        severities: flags.map((f) => f.severity),
        emails_sent: emailsSent,
        sms_sent: smsSent,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });

    return NextResponse.json({
      flagged: true,
      flags,
      delivery,
      sms_delivery: smsDelivery,
      alerts,
      sent_at: sentAt,
      ...(persistError ? { persist_warning: persistError } : {}),
    });
  } catch {
    return bad('Internal error', 500);
  }
}
