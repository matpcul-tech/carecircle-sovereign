'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { loadSession, ensureValidSession, type CCSession } from '@/lib/cc-data';

/**
 * CareCircle Sovereign Edition.
 *
 * Family-facing remote monitoring surface. The patient lives on Chikasha
 * Health OS (cookie-authed). Family members log into CareCircle with a Supabase
 * account; their cc-session in localStorage holds the access_token plus
 * patient_id (resolved server-side at invite redemption from the
 * care_circle row).
 *
 * Data plane:
 *   - Live vitals + biomarker panel: poll {HEALTH_OS_URL}/api/shield/decrypt
 *     on an interval with the Supabase Bearer token. The endpoint resolves
 *     family-member auth via care_circle membership and returns the same
 *     shape the patient sees, so the family LIVE strip is real data, not
 *     a snapshot.
 *   - Medications + medication_logs: Supabase REST direct with the
 *     family member's JWT; RLS via is_patient_or_member.
 *   - Appointments + care_circle: same.
 *   - AI chat: posts to {HEALTH_OS_URL}/api/shield with the JWT.
 *
 * Single-file by design (per shipping constraint). All inline.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const HEALTH_OS_URL =
  process.env.NEXT_PUBLIC_HEALTH_OS_URL || 'https://sovereignhealthcareos.com';

const T = "'DM Mono',monospace";
const P = "'Playfair Display',serif";
const O = "'Outfit',sans-serif";

// Primary accent: CareCircle teal (matches the marketing site CTA).
const TEAL = '#3D8B5E';
const TEAL2 = '#7BC8A0';
const OK = '#4ade80';
const WARN = '#C07941';
const ALERT = '#E05C3A';
const MUTED = '#A8B8C8';
const SUB = '#a3b5cc';
const INK = '#F4EDE1';
const BG = '#0a1628';
const CARD = 'rgba(255,255,255,0.04)';
const BORDER = '1px solid rgba(255,255,255,0.06)';

// =========================================================================
// Types: subset of /api/shield/decrypt response we consume
// =========================================================================

type BiomarkerStatus = 'ok' | 'suboptimal' | 'outside_normal' | 'unknown';
interface BiomarkerEntry {
  value: number | null;
  unit: string;
  status: BiomarkerStatus;
}
type CategoryKey =
  | 'metabolic'
  | 'cardiovascular'
  | 'organ'
  | 'blood'
  | 'hormonal'
  | 'longevity'
  | 'cognitive';
type BiomarkerPanel = Record<CategoryKey, Record<string, BiomarkerEntry>>;

interface ShieldPayload {
  patient_id: string;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  a1c: number | null;
  ldl: number | null;
  hdl: number | null;
  fasting_glucose: number | null;
  triglycerides: number | null;
  hr: number | null;
  spo2: number | null;
  hrv: number | null;
  steps: number | null;
  sleep_hours: number | null;
  active_calories: number | null;
  calories: number | null;
  risk_score: number;
  risk_label: string;
  panel_grade: string;
  panel_flagged: number;
  panel_in_range: number;
  decrypted_at: string;
  device: string | null;
  wearable_updated_at: string | null;
  biomarkers: BiomarkerPanel;
}

interface Medication {
  id: string;
  name: string;
  dose: string | null;
  frequency: string | null;
  time_of_day: string | null;
  prescribing_doctor: string | null;
  active: boolean;
  patient_id: string;
}
interface MedLog { id: string; medication_id: string; taken_on: string }

interface Appointment {
  id: string;
  title: string;
  provider_name: string | null;
  location: string | null;
  appt_date: string;
  appt_time: string | null;
  notes: string | null;
}

interface CircleMember {
  id: string;
  member_user_id: string | null;
  member_name: string;
  member_email: string;
  relationship: string;
  alert_level: 'critical' | 'informational';
}

// =========================================================================
// Helpers
// =========================================================================

function chkIdFor(patientId: string): string {
  if (!patientId) return 'CHK-NOTLINKED';
  const year = new Date().getFullYear();
  const tail = patientId.replace(/-/g, '').slice(0, 5).toUpperCase();
  return `CHK-${year}-${tail}`;
}

function initialsFor(name: string): string {
  const t = (name || '').trim();
  if (!t) return '?';
  return t.split(/\s+/).map((s) => s[0] || '').join('').slice(0, 2).toUpperCase();
}

function flatBiomarker(panel: BiomarkerPanel | undefined, key: string): BiomarkerEntry | null {
  if (!panel) return null;
  for (const cat of Object.keys(panel) as CategoryKey[]) {
    const e = panel[cat]?.[key];
    if (e) return e;
  }
  return null;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

async function sbGet(token: string, path: string): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
}

async function sbWrite(token: string, path: string, init: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
    cache: 'no-store',
  });
}

// =========================================================================
// Tone helpers
// =========================================================================

function hrTone(v: number | null | undefined): string {
  if (v == null) return MUTED;
  if (v < 50 || v > 100) return ALERT;
  if (v < 55 || v > 95) return WARN;
  return OK;
}
function spo2Tone(v: number | null | undefined): string {
  if (v == null) return MUTED;
  if (v < 90) return ALERT;
  if (v < 95) return WARN;
  return OK;
}
function bpTone(s: number | null | undefined, d: number | null | undefined): string {
  if (s == null && d == null) return MUTED;
  if ((s ?? 0) >= 140 || (d ?? 0) >= 90) return ALERT;
  if ((s ?? 0) >= 130 || (d ?? 0) >= 80) return WARN;
  return OK;
}
function gluTone(v: number | null | undefined): string {
  if (v == null) return MUTED;
  if (v >= 126) return ALERT;
  if (v >= 100) return WARN;
  return OK;
}
function stepsTone(v: number | null | undefined): string {
  if (v == null) return MUTED;
  if (v < 100) return WARN;
  return OK;
}
function sleepTone(v: number | null | undefined): string {
  if (v == null) return MUTED;
  if (v < 6) return WARN;
  return OK;
}
function fmtSleep(h: number | null | undefined): string {
  if (h == null) return '–';
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h ${mm}m`;
}

// =========================================================================
// Alert engine. Same thresholds the LIVE wearable strip uses, but
// surfaced as a flat list with severity, label, current value, and the
// safe-range note. Recomputes every poll tick because the input
// shield payload comes from the same useShieldPolling hook.
// =========================================================================

type AlertSeverity = 'critical' | 'warn';

interface ActiveAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  vital: string;
  value: string;
  range: string;
  detail?: string;
}

function flatBiomarkerVal(panel: BiomarkerPanel | undefined, key: string): number | null {
  const e = flatBiomarker(panel, key);
  return e?.value ?? null;
}

function computeAlerts(s: ShieldPayload | null): ActiveAlert[] {
  if (!s) return [];
  const out: ActiveAlert[] = [];

  if (s.hr != null) {
    if (s.hr < 50) {
      out.push({ id: 'hr-low', severity: 'critical', title: 'Heart rate low', vital: 'HR', value: `${Math.round(s.hr)} bpm`, range: 'safe 50-100 bpm' });
    } else if (s.hr > 100) {
      out.push({ id: 'hr-high', severity: 'critical', title: 'Heart rate elevated', vital: 'HR', value: `${Math.round(s.hr)} bpm`, range: 'safe 50-100 bpm' });
    } else if (s.hr < 55 || s.hr > 95) {
      out.push({ id: 'hr-warn', severity: 'warn', title: 'Heart rate near edge', vital: 'HR', value: `${Math.round(s.hr)} bpm`, range: 'optimal 55-95 bpm' });
    }
  }

  if (s.spo2 != null) {
    if (s.spo2 < 90) {
      out.push({ id: 'spo2-low', severity: 'critical', title: 'Oxygen saturation low', vital: 'SpO2', value: `${s.spo2.toFixed(1)}%`, range: 'safe at or above 95%', detail: 'If sustained, contact a clinician.' });
    } else if (s.spo2 < 95) {
      out.push({ id: 'spo2-warn', severity: 'warn', title: 'Oxygen saturation borderline', vital: 'SpO2', value: `${s.spo2.toFixed(1)}%`, range: 'optimal at or above 95%' });
    }
  }

  if (s.bp_systolic != null && s.bp_diastolic != null) {
    const sys = s.bp_systolic, dia = s.bp_diastolic;
    if (sys >= 180 || dia >= 120) {
      out.push({ id: 'bp-crisis', severity: 'critical', title: 'Hypertensive crisis', vital: 'BP', value: `${sys}/${dia} mmHg`, range: 'urgent at 180/120 or higher', detail: 'Seek emergency care.' });
    } else if (sys >= 140 || dia >= 90) {
      out.push({ id: 'bp-high', severity: 'critical', title: 'Blood pressure high', vital: 'BP', value: `${sys}/${dia} mmHg`, range: 'safe under 140/90' });
    } else if (sys >= 130 || dia >= 80) {
      out.push({ id: 'bp-warn', severity: 'warn', title: 'Blood pressure elevated', vital: 'BP', value: `${sys}/${dia} mmHg`, range: 'optimal under 130/80' });
    }
  }

  if (s.fasting_glucose != null) {
    const g = s.fasting_glucose;
    if (g < 70) {
      out.push({ id: 'glu-low', severity: 'critical', title: 'Blood sugar low', vital: 'Glucose', value: `${Math.round(g)} mg/dL`, range: 'safe 70-99 mg/dL fasting' });
    } else if (g >= 200) {
      out.push({ id: 'glu-high', severity: 'critical', title: 'Blood sugar very high', vital: 'Glucose', value: `${Math.round(g)} mg/dL`, range: 'safe 70-99 mg/dL fasting' });
    } else if (g >= 126) {
      out.push({ id: 'glu-warn', severity: 'warn', title: 'Blood sugar elevated', vital: 'Glucose', value: `${Math.round(g)} mg/dL`, range: 'optimal under 100 mg/dL' });
    }
  }

  const t = flatBiomarkerVal(s.biomarkers, 'body_temperature');
  if (t != null) {
    if (t >= 102) {
      out.push({ id: 'temp-fever', severity: 'critical', title: 'High fever', vital: 'Temp', value: `${t.toFixed(1)} F`, range: 'safe 97-99 F' });
    } else if (t < 95) {
      out.push({ id: 'temp-low', severity: 'critical', title: 'Body temperature low', vital: 'Temp', value: `${t.toFixed(1)} F`, range: 'safe 97-99 F' });
    } else if (t >= 100.4 || t < 96) {
      out.push({ id: 'temp-warn', severity: 'warn', title: 'Temperature out of range', vital: 'Temp', value: `${t.toFixed(1)} F`, range: 'optimal 97-99 F' });
    }
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
}

// =========================================================================
// Cell (used by wearable + patient grids)
// =========================================================================

function Cell({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div
      style={{
        background: 'rgba(0,0,0,0.18)',
        border: BORDER,
        borderRadius: 10,
        padding: '10px 6px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: T, fontSize: 18, fontWeight: 600, color: tone, lineHeight: 1.1 }}>
        {value}
      </div>
      <div
        style={{
          fontFamily: T,
          fontSize: 8,
          color: MUTED,
          textTransform: 'uppercase',
          letterSpacing: '.14em',
          marginTop: 4,
        }}
      >
        {label}
      </div>
    </div>
  );
}

// =========================================================================
// Live shield poller (shared across screens)
// =========================================================================

// A 5s poll ran ~720 reads and one audit insert per hour per open tab -
// enough sustained database IO, on a screen the app tells people to leave
// open, to deplete the project's IO budget. Vitals do not change on that
// timescale; a minute is still "live" for a wearable feed.
const POLL_MS = 60_000;
const POLL_LABEL = `${Math.round(POLL_MS / 1000)}s`;

function useShieldPolling(session: CCSession | null): {
  shield: ShieldPayload | null;
  err: string | null;
  loading: boolean;
} {
  const [shield, setShield] = useState<ShieldPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sessRef = useRef(session);
  useEffect(() => {
    sessRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let timer: number | null = null;
    let inFlight = false;
    const fire = async () => {
      const s = sessRef.current;
      if (!s) return;
      // A backgrounded tab keeps its session open; polling it spends
      // database IO on a screen nobody is looking at. Wait for the
      // visibility listener below to refresh on return instead.
      if (typeof document !== 'undefined' && document.hidden) {
        if (!cancelled) timer = window.setTimeout(fire, POLL_MS);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      try {
        const valid = await ensureValidSession(s);
        if (!valid) {
          if (!cancelled) setErr('Session expired');
          return;
        }
        const r = await fetch('/api/healthos/decrypt', {
          headers: { Authorization: `Bearer ${valid.access_token}` },
          cache: 'no-store',
        });
        const d = await r.json().catch(() => ({}));
        if (!cancelled) {
          if (!r.ok) {
            setErr(d.error || `shield ${r.status}`);
          } else {
            setShield(d as ShieldPayload);
            setErr(null);
          }
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setErr((e as Error).message);
          setLoading(false);
        }
      } finally {
        inFlight = false;
        if (!cancelled) timer = window.setTimeout(fire, POLL_MS);
      }
    };
    const onVisibility = () => {
      if (cancelled || document.hidden) return;
      if (timer != null) window.clearTimeout(timer);
      fire();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibility);
    }
    fire();
    return () => {
      cancelled = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      if (timer != null) window.clearTimeout(timer);
    };
  }, [session]);

  return { shield, err, loading };
}

// =========================================================================
// LiveWearableStrip
// =========================================================================

// The Health OS parser normalises any vendor's CSV/JSON/XML export, so the
// device is only ever a label for what was uploaded - never a gate on which
// wearables are supported. Anything unrecognised still parses, and says so.
const DEVICE_LABELS: Record<string, string> = {
  fitbit: 'Fitbit',
  apple_watch: 'Apple Watch',
  garmin: 'Garmin',
  samsung: 'Samsung Health',
  google_fit: 'Google Fit',
  generic: 'Wearable export',
};

function deviceLabel(device: string | null | undefined): string {
  if (!device) return 'No device data yet';
  return DEVICE_LABELS[device] || 'Wearable export';
}

/** Days since an ISO date, or null if it is missing or unparseable. */
function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86_400_000);
}

function freshnessLabel(days: number | null): string {
  if (days === null) return 'No data';
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function LiveWearableStrip({ shield }: { shield: ShieldPayload | null }) {
  const tempEntry = flatBiomarker(shield?.biomarkers, 'body_temperature');
  const cells = [
    {
      label: 'HR',
      value: shield?.hr != null ? String(Math.round(shield.hr)) : '–',
      unit: 'bpm',
      tone: hrTone(shield?.hr),
    },
    {
      label: 'SpO2',
      value: shield?.spo2 != null ? String(shield.spo2) : '–',
      unit: '%',
      tone: spo2Tone(shield?.spo2),
    },
    {
      label: 'BP',
      value:
        shield?.bp_systolic != null && shield?.bp_diastolic != null
          ? `${shield.bp_systolic}/${shield.bp_diastolic}`
          : '–',
      unit: 'mmHg',
      tone: bpTone(shield?.bp_systolic, shield?.bp_diastolic),
    },
    {
      label: 'Glucose',
      value: shield?.fasting_glucose != null ? String(Math.round(shield.fasting_glucose)) : '–',
      unit: 'mg/dL',
      tone: gluTone(shield?.fasting_glucose),
    },
    {
      label: 'Temp',
      value: tempEntry?.value != null ? tempEntry.value.toFixed(1) : '–',
      unit: '°F',
      tone: INK,
    },
    {
      label: 'HRV',
      value: shield?.hrv != null ? String(Math.round(shield.hrv)) : '–',
      unit: 'ms',
      tone: shield?.hrv != null ? OK : MUTED,
    },
    {
      label: 'Steps',
      value: shield?.steps != null ? shield.steps.toLocaleString() : '–',
      unit: 'today',
      tone: stepsTone(shield?.steps),
    },
    {
      label: 'Sleep',
      value: fmtSleep(shield?.sleep_hours),
      unit: 'last',
      tone: sleepTone(shield?.sleep_hours),
    },
  ];
  return (
    <div
      style={{
        background: CARD,
        border: BORDER,
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: 'rgba(20,184,166,0.14)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M5.5 13.5a3 3 0 010-6h.55a4.5 4.5 0 018.9 0H15a3 3 0 010 6H5.5z"
                stroke={TEAL}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>Wearable</div>
            <div style={{ fontFamily: T, fontSize: 9, color: MUTED, marginTop: 1 }}>
              {deviceLabel(shield?.device)} · Checked every {POLL_LABEL}
            </div>
          </div>
        </div>
        {(() => {
          // A green "LIVE" dot regardless of the data was the dashboard's
          // worst lie: readings arrive when an export is uploaded, so show
          // how old the newest one actually is.
          const days = daysSince(shield?.wearable_updated_at);
          const stale = days === null || days > 2;
          const tone = stale ? MUTED : OK;
          return (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 10px',
                borderRadius: 12,
                background: stale ? 'rgba(168,184,200,0.12)' : 'rgba(74,222,128,0.14)',
                color: tone,
                border: `1px solid ${stale ? 'rgba(168,184,200,0.35)' : 'rgba(74,222,128,0.4)'}`,
                fontFamily: T,
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '.14em',
                flexShrink: 0,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone }} />
              {freshnessLabel(days)}
            </div>
          );
        })()}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {cells.map((c) => (
          <Cell key={c.label} value={c.value} label={c.label} tone={c.tone} />
        ))}
      </div>
    </div>
  );
}

// =========================================================================
// ZKShieldBanner
// =========================================================================

function ZKShieldBanner() {
  return (
    <div
      style={{
        background: 'rgba(74,222,128,0.06)',
        border: '1px solid rgba(74,222,128,0.2)',
        borderRadius: 12,
        padding: '10px 12px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        style={{ flexShrink: 0, marginTop: 1 }}
        aria-hidden
      >
        <path
          d="M10 2l6 2v5c0 4-2.5 7-6 8-3.5-1-6-4-6-8V4l6-2z"
          stroke={OK}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      <div style={{ fontSize: 11, lineHeight: 1.55, color: SUB }}>
        <span style={{ color: OK, fontWeight: 700 }}>Shield Active.</span>{' '}
        AES-256-GCM encryption at rest, role-scoped access, audit logging, and identifier redaction on AI prompts.
      </div>
    </div>
  );
}

// =========================================================================
// PatientCard
// =========================================================================

function PatientCard({
  session,
  shield,
  shieldLoading,
  patientNickname,
}: {
  session: CCSession;
  shield: ShieldPayload | null;
  shieldLoading: boolean;
  patientNickname: string | null;
}) {
  const score = shield ? Math.round(shield.risk_score) : 0;
  const scoreColor = score >= 75 ? OK : score >= 55 ? WARN : ALERT;
  const riskLabel = shieldLoading
    ? 'Loading...'
    : shield?.risk_label || 'Not yet computed';
  const alerts = shield?.panel_flagged ?? 0;
  const name = patientNickname || session.patient_name || 'Your loved one';
  const initials = initialsFor(name);
  const tempEntry = flatBiomarker(shield?.biomarkers, 'body_temperature');

  return (
    <div
      style={{
        background: CARD,
        border: BORDER,
        borderRadius: 14,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: '50%',
            background: `linear-gradient(135deg, ${TEAL}, ${TEAL2})`,
            color: '#0d2a1c',
            fontWeight: 800,
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
          aria-hidden
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: P, fontSize: 18, color: INK, lineHeight: 1.1 }}>
            {name}
          </div>
          <div style={{ fontFamily: T, fontSize: 9, color: MUTED, marginTop: 4 }}>
            {chkIdFor(session.patient_id)}
          </div>
        </div>
        <div
          style={{
            fontFamily: T,
            fontSize: 36,
            fontWeight: 700,
            color: scoreColor,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          {shieldLoading ? '...' : score || 0}
        </div>
      </div>
      <div
        style={{
          marginTop: 8,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 6,
          fontFamily: T,
          fontSize: 10,
        }}
      >
        <span
          style={{
            color: scoreColor,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '.1em',
          }}
        >
          {riskLabel}
        </span>
        <span style={{ color: MUTED }}>·</span>
        <span style={{ color: alerts > 0 ? ALERT : MUTED }}>
          △ {alerts} {alerts === 1 ? 'alert' : 'alerts'}
        </span>
        <span style={{ color: MUTED }}>·</span>
        <span style={{ color: MUTED }}>Next scan not yet scheduled</span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
          marginTop: 14,
        }}
      >
        <Cell
          value={
            shield?.bp_systolic != null && shield?.bp_diastolic != null
              ? `${shield.bp_systolic}/${shield.bp_diastolic}`
              : '–'
          }
          label="BP mmHg"
          tone={INK}
        />
        <Cell
          value={shield?.a1c != null ? `${shield.a1c.toFixed(1)}%` : '–'}
          label="A1C"
          tone={INK}
        />
        <Cell
          value={shield?.hr != null ? String(Math.round(shield.hr)) : '–'}
          label="HR bpm"
          tone={hrTone(shield?.hr)}
        />
        <Cell
          value={shield?.spo2 != null ? `${shield.spo2}%` : '–'}
          label="SpO2"
          tone={INK}
        />
        <Cell
          value={tempEntry?.value != null ? tempEntry.value.toFixed(1) : '–'}
          label="Temp °F"
          tone={INK}
        />
        <Cell
          value={shield?.hrv != null ? `${Math.round(shield.hrv)} ms` : '–'}
          label="HRV"
          tone={INK}
        />
      </div>
    </div>
  );
}

// =========================================================================
// ActiveProtocols
// =========================================================================

const PROTOCOLS = [
  {
    name: 'Metabolic Reversal',
    keys: ['fasting_glucose', 'fasting_insulin', 'homa_ir', 'a1c', 'uric_acid'],
  },
  {
    name: 'Cardiovascular Defense',
    keys: ['ldl', 'hdl', 'total_cholesterol', 'triglycerides', 'apob', 'lpa', 'hs_crp', 'homocysteine', 'vldl'],
  },
  {
    name: 'Longevity Optimization',
    keys: ['biological_age_estimate', 'grip_strength', 'vo2_max', 'resting_hr', 'hrv', 'sleep_score'],
  },
  {
    name: 'Cognitive Protection',
    keys: ['memory_score', 'processing_speed', 'executive_function'],
  },
];

function computeProtocol(panel: BiomarkerPanel | undefined, keys: string[]) {
  if (!panel) return { optimal: 0, total: 0, pct: 0 };
  let optimal = 0;
  let total = 0;
  for (const k of keys) {
    const e = flatBiomarker(panel, k);
    if (!e || e.value == null) continue;
    total += 1;
    if (e.status === 'ok') optimal += 1;
  }
  const pct = total > 0 ? Math.round((optimal / total) * 100) : 0;
  return { optimal, total, pct };
}

function protocolSubtitle(name: string, panel: BiomarkerPanel | undefined): string {
  if (name === 'Metabolic Reversal') {
    const a1c = flatBiomarker(panel, 'a1c');
    if (a1c?.value != null) return `Latest A1C ${a1c.value.toFixed(1)}% · target 5.7%`;
    return 'A1C target 5.7%';
  }
  if (name === 'Cardiovascular Defense') {
    const ldl = flatBiomarker(panel, 'ldl');
    if (ldl?.value != null) return `LDL ${Math.round(ldl.value)} mg/dL · target <130`;
    return 'LDL target <130 mg/dL';
  }
  if (name === 'Longevity Optimization') return 'Supplement, sleep, and exercise stack';
  return 'Brain health markers tracked weekly';
}

function ActiveProtocols({ shield }: { shield: ShieldPayload | null }) {
  return (
    <>
      <div style={{ fontFamily: P, fontSize: 18, color: INK, margin: '8px 0 10px' }}>
        Active Protocols
      </div>
      <div style={{ marginBottom: 16 }}>
        {PROTOCOLS.map((p) => {
          const stats = computeProtocol(shield?.biomarkers, p.keys);
          const pctColor = stats.pct >= 70 ? OK : stats.pct >= 40 ? TEAL : ALERT;
          return (
            <div
              key={p.name}
              style={{
                background: CARD,
                border: BORDER,
                borderRadius: 12,
                padding: 12,
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 4,
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: INK }}>{p.name}</span>
                <span style={{ fontFamily: T, fontSize: 14, fontWeight: 700, color: pctColor }}>
                  {stats.total > 0 ? `${stats.pct}%` : '–'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: SUB, marginBottom: 8 }}>
                {protocolSubtitle(p.name, shield?.biomarkers)}
              </div>
              <div
                style={{
                  height: 4,
                  background: 'rgba(255,255,255,0.06)',
                  borderRadius: 2,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${stats.pct}%`,
                    background: `linear-gradient(90deg, ${pctColor}, ${pctColor}cc)`,
                    borderRadius: 2,
                    transition: 'width 1s ease',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// =========================================================================
// RiskDomains
// =========================================================================

const DOMAINS: Array<{ name: string; cat: CategoryKey | null; iconPath: string }> = [
  { name: 'Metabolic', cat: 'metabolic', iconPath: 'M5 8c0-1.5 1.5-3 3-3s3 1.5 3 3 1.5 3 3 3 3-1.5 3-3M5 14c0-1.5 1.5-3 3-3s3 1.5 3 3' },
  { name: 'Cardiovascular', cat: 'cardiovascular', iconPath: 'M10 16s-5-3.5-5-8a3 3 0 015-2.2A3 3 0 0115 8c0 4.5-5 8-5 8z' },
  { name: 'Cognitive', cat: 'cognitive', iconPath: 'M7 5a3 3 0 016 0v1a3 3 0 010 6v1a3 3 0 01-6 0v-1a3 3 0 010-6V5z' },
  { name: 'Oncology', cat: null, iconPath: 'M10 4l1.5 4.5L16 10l-4.5 1.5L10 16l-1.5-4.5L4 10l4.5-1.5L10 4z' },
  { name: 'Renal', cat: 'organ', iconPath: 'M10 3c3 0 5 2 5 5 0 4-3 8-5 9-2-1-5-5-5-9 0-3 2-5 5-5z' },
  { name: 'Mental Health', cat: null, iconPath: 'M5 7c0-1 1-2 2.5-2C9 5 10 6 10 7c0-1 1-2 2.5-2C14 5 15 6 15 7c0 3-5 7-5 7s-5-4-5-7z' },
];

function computeDomain(panel: BiomarkerPanel | undefined, key: CategoryKey) {
  if (!panel) return null;
  const group = panel[key];
  if (!group) return null;
  let optimal = 0;
  let total = 0;
  for (const k of Object.keys(group)) {
    const e = group[k];
    if (e.value == null) continue;
    total += 1;
    if (e.status === 'ok') optimal += 1;
  }
  if (total === 0) return null;
  return { optimal, total, score: Math.round((optimal / total) * 100) };
}

function RiskDomains({ shield }: { shield: ShieldPayload | null }) {
  return (
    <>
      <div style={{ fontFamily: P, fontSize: 18, color: INK, margin: '8px 0 10px' }}>
        Risk Domains
      </div>
      <div
        style={{
          background: CARD,
          border: BORDER,
          borderRadius: 14,
          padding: 12,
        }}
      >
        {DOMAINS.map((d, i) => {
          const stats = d.cat ? computeDomain(shield?.biomarkers, d.cat) : null;
          const score = stats?.score ?? null;
          const tone = score == null ? MUTED : score >= 80 ? OK : score >= 60 ? TEAL : ALERT;
          return (
            <div
              key={d.name}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 30px',
                gap: 10,
                alignItems: 'center',
                padding: '10px 0',
                borderBottom: i < DOMAINS.length - 1 ? BORDER : 'none',
              }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.04)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-hidden
              >
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                  <path d={d.iconPath} stroke={tone} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: INK, marginBottom: 4 }}>{d.name}</div>
                <div
                  style={{
                    height: 4,
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${score ?? 0}%`,
                      background: `linear-gradient(90deg, ${tone}, ${tone}cc)`,
                      borderRadius: 2,
                      transition: 'width 1s ease',
                    }}
                  />
                </div>
              </div>
              <div style={{ fontFamily: T, fontSize: 14, fontWeight: 600, color: tone, textAlign: 'right' }}>
                {score == null ? '–' : score}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// =========================================================================
// MedsView (read-only: track when patient has taken meds today)
// =========================================================================

const MED_PROTOCOL_HINTS: Array<{ pattern: RegExp; protocol: string }> = [
  { pattern: /metformin|jardiance|ozempic|mounjaro|wegovy|glp|insulin|semaglutide|tirzepatide/i, protocol: 'Metabolic Reversal' },
  { pattern: /lisinopril|amlodipine|losartan|metoprolol|atorvastatin|crestor|rosuvastatin|pravastatin|simvastatin|ezetimibe|repatha|aspirin|clopidogrel|warfarin|eliquis|hydrochlorothiazide|hctz/i, protocol: 'Cardiovascular Defense' },
  { pattern: /vitamin d|vit d|nmn|nad|rapamycin|spermidine|coq10|omega|fish oil|magnesium|zinc/i, protocol: 'Longevity Optimization' },
  { pattern: /donepezil|aricept|memantine|namenda|piracetam|lion'?s mane/i, protocol: 'Cognitive Protection' },
];
function inferProtocol(name: string): string {
  for (const r of MED_PROTOCOL_HINTS) if (r.pattern.test(name)) return r.protocol;
  return 'General care';
}

function MedsView({ session, router }: { session: CCSession; router: ReturnType<typeof useRouter> }) {
  const [meds, setMeds] = useState<Medication[]>([]);
  const [logs, setLogs] = useState<MedLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const valid = await ensureValidSession(session);
      if (!valid) { router.push('/login'); return; }
      const today = todayIso();
      const [mr, lr] = await Promise.all([
        sbGet(valid.access_token, `medications?patient_id=eq.${valid.patient_id}&active=eq.true&order=created_at.desc&select=*`),
        sbGet(valid.access_token, `medication_logs?patient_id=eq.${valid.patient_id}&taken_on=eq.${today}&select=id,medication_id,taken_on`),
      ]);
      if (!mr.ok) throw new Error(`meds ${mr.status}`);
      if (!lr.ok) throw new Error(`logs ${lr.status}`);
      setMeds((await mr.json()) as Medication[]);
      setLogs((await lr.json()) as MedLog[]);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session, router]);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleTaken = async (m: Medication) => {
    const valid = await ensureValidSession(session);
    if (!valid) { router.push('/login'); return; }
    const today = todayIso();
    const existing = logs.find((l) => l.medication_id === m.id);
    if (existing) {
      const r = await sbWrite(valid.access_token, `medication_logs?id=eq.${existing.id}`, { method: 'DELETE' });
      if (!r.ok) { setErr(`untoggle ${r.status}`); return; }
      setLogs((p) => p.filter((l) => l.id !== existing.id));
    } else {
      const r = await sbWrite(valid.access_token, 'medication_logs', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          medication_id: m.id,
          patient_id: m.patient_id,
          taken_on: today,
          taken_by: valid.user_id,
        }),
      });
      if (!r.ok) { setErr(`toggle ${r.status}`); return; }
      const inserted = ((await r.json()) as MedLog[])[0];
      setLogs((p) => [...p, inserted]);
    }
  };

  const total = meds.length;
  const taken = logs.length;
  const pct = total > 0 ? Math.round((taken / total) * 100) : 0;

  if (loading) return <div style={{ padding: 18, color: MUTED, fontSize: 12 }}>Loading meds...</div>;

  return (
    <>
      {total > 0 && (
        <div
          style={{
            background: CARD,
            border: BORDER,
            borderRadius: 14,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{taken}/{total} Doses Taken</div>
              <div style={{ fontSize: 11, color: SUB, marginTop: 2 }}>
                Wearable confirms absorption patterns
              </div>
            </div>
            <div style={{ fontFamily: P, fontSize: 32, fontWeight: 700, color: TEAL }}>{pct}%</div>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', marginTop: 10 }}>
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: `linear-gradient(90deg, ${TEAL}, ${TEAL2})`,
                borderRadius: 2,
                transition: 'width 1s ease',
              }}
            />
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
        <div style={{ fontFamily: P, fontSize: 18, color: INK }}>Medication Schedule</div>
        <button
          onClick={refresh}
          style={{
            fontFamily: T,
            fontSize: 9,
            color: TEAL,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            letterSpacing: '.1em',
            textTransform: 'uppercase',
          }}
        >
          Refresh
        </button>
      </div>

      {err && (
        <div
          style={{
            background: 'rgba(232,82,110,0.08)',
            border: '1px solid rgba(232,82,110,0.25)',
            borderRadius: 10,
            padding: 10,
            fontSize: 11,
            color: ALERT,
            marginBottom: 10,
          }}
        >
          {err}
        </div>
      )}

      <div style={{ background: CARD, border: BORDER, borderRadius: 14, overflow: 'hidden' }}>
        {meds.length === 0 ? (
          <div style={{ padding: 16, fontSize: 11, color: MUTED, textAlign: 'center' }}>
            No medications on file. The patient or another circle member can add one from the Meds tab.
          </div>
        ) : (
          meds.map((m, i) => {
            const isTaken = logs.some((l) => l.medication_id === m.id);
            const protocol = inferProtocol(m.name);
            return (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: 12,
                  borderBottom: i < meds.length - 1 ? BORDER : 'none',
                  opacity: isTaken ? 0.78 : 1,
                }}
              >
                <button
                  onClick={() => toggleTaken(m)}
                  aria-label={isTaken ? 'Mark not taken' : 'Mark taken'}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    flexShrink: 0,
                    border: `1px solid ${isTaken ? OK : 'rgba(255,255,255,0.18)'}`,
                    background: isTaken ? OK : 'transparent',
                    color: '#0a1d10',
                    fontSize: 13,
                    fontWeight: 700,
                    lineHeight: '20px',
                    textAlign: 'center',
                    marginTop: 2,
                    cursor: 'pointer',
                  }}
                >
                  {isTaken ? '✓' : ''}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 4 }}>
                    {m.name}{m.dose ? ` ${m.dose}` : ''}
                  </div>
                  {(m.frequency || m.time_of_day) && (
                    <div style={{ fontSize: 11, color: SUB, marginBottom: 4 }}>
                      {[m.frequency, m.time_of_day].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'inline-block',
                      fontFamily: T,
                      fontSize: 8,
                      padding: '2px 7px',
                      borderRadius: 5,
                      background: 'rgba(20,184,166,0.12)',
                      color: TEAL,
                      border: '1px solid rgba(20,184,166,0.3)',
                      letterSpacing: '.1em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {protocol}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

// =========================================================================
// CalendarView (upcoming appointments)
// =========================================================================

function fmtApptDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch { return iso; }
}
function fmtApptTime(t: string | null): string {
  if (!t) return '';
  const [hh, mm] = t.split(':');
  const h = Number(hh);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${ampm}`;
}

function CalendarView({ session, router }: { session: CCSession; router: ReturnType<typeof useRouter> }) {
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const valid = await ensureValidSession(session);
        if (!valid) { router.push('/login'); return; }
        const today = todayIso();
        const r = await sbGet(
          valid.access_token,
          `appointments?patient_id=eq.${valid.patient_id}&appt_date=gte.${today}&order=appt_date.asc,appt_time.asc&select=*`,
        );
        if (!r.ok) throw new Error(`appointments ${r.status}`);
        if (!cancelled) setAppts((await r.json()) as Appointment[]);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session, router]);

  if (loading) return <div style={{ padding: 18, color: MUTED, fontSize: 12 }}>Loading appointments...</div>;

  return (
    <>
      <div style={{ fontFamily: P, fontSize: 18, color: INK, margin: '4px 0 10px' }}>
        Upcoming Appointments
      </div>
      {err && (
        <div
          style={{
            background: 'rgba(232,82,110,0.08)',
            border: '1px solid rgba(232,82,110,0.25)',
            borderRadius: 10,
            padding: 10,
            fontSize: 11,
            color: ALERT,
            marginBottom: 10,
          }}
        >
          {err}
        </div>
      )}
      {appts.length === 0 ? (
        <div
          style={{
            background: CARD,
            border: BORDER,
            borderRadius: 14,
            padding: 16,
            fontSize: 11,
            color: MUTED,
            textAlign: 'center',
          }}
        >
          No upcoming appointments.
        </div>
      ) : (
        appts.map((a) => (
          <div
            key={a.id}
            style={{
              background: CARD,
              border: BORDER,
              borderRadius: 12,
              padding: 12,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                fontFamily: T,
                fontSize: 9,
                color: TEAL,
                textTransform: 'uppercase',
                letterSpacing: '.12em',
                marginBottom: 4,
              }}
            >
              {fmtApptDate(a.appt_date)}{a.appt_time ? ` · ${fmtApptTime(a.appt_time)}` : ''}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 3 }}>{a.title}</div>
            {a.provider_name && (
              <div style={{ fontSize: 11, color: SUB }}>{a.provider_name}</div>
            )}
            {a.location && (
              <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{a.location}</div>
            )}
            {a.notes && (
              <div
                style={{
                  fontSize: 11,
                  color: SUB,
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: BORDER,
                }}
              >
                {a.notes}
              </div>
            )}
          </div>
        ))
      )}
    </>
  );
}

// =========================================================================
// FamilyView (care_circle members)
// =========================================================================

function FamilyView({ session, router }: { session: CCSession; router: ReturnType<typeof useRouter> }) {
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const valid = await ensureValidSession(session);
        if (!valid) { router.push('/login'); return; }
        const r = await sbGet(
          valid.access_token,
          `care_circle?patient_id=eq.${valid.patient_id}&select=id,member_user_id,member_name,member_email,relationship,alert_level&order=created_at.asc`,
        );
        if (!r.ok) throw new Error(`circle ${r.status}`);
        if (!cancelled) setMembers((await r.json()) as CircleMember[]);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session, router]);

  if (loading) return <div style={{ padding: 18, color: MUTED, fontSize: 12 }}>Loading family hub...</div>;

  const palette = [TEAL, TEAL2, '#06b6d4', '#8b5cf6', '#0ea5e9', '#4ade80'];

  return (
    <>
      <div style={{ fontFamily: P, fontSize: 18, color: INK, margin: '4px 0 12px' }}>
        Family Hub
      </div>
      {err && (
        <div
          style={{
            background: 'rgba(232,82,110,0.08)',
            border: '1px solid rgba(232,82,110,0.25)',
            borderRadius: 10,
            padding: 10,
            fontSize: 11,
            color: ALERT,
            marginBottom: 10,
          }}
        >
          {err}
        </div>
      )}
      {members.length === 0 ? (
        <div
          style={{
            background: CARD,
            border: BORDER,
            borderRadius: 12,
            padding: 16,
            fontSize: 11,
            color: MUTED,
            textAlign: 'center',
          }}
        >
          No care circle members yet.
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginBottom: 16,
              overflowX: 'auto',
              scrollbarWidth: 'none',
              paddingBottom: 4,
            }}
          >
            {members.slice(0, 6).map((m, idx) => {
              const c = palette[idx % palette.length];
              return (
                <div key={m.id} style={{ textAlign: 'center', minWidth: 56, flexShrink: 0 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: `linear-gradient(135deg, ${c}, ${c}aa)`,
                      color: '#0d2a1c',
                      fontWeight: 800,
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto 4px',
                    }}
                  >
                    {initialsFor(m.member_name || m.member_email)}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: INK, lineHeight: 1.2 }}>
                    {(m.member_name || m.member_email).split(/\s+/)[0]}
                  </div>
                  <div style={{ fontFamily: T, fontSize: 8, color: MUTED, marginTop: 2 }}>
                    {(m.relationship || '').slice(0, 12)}
                  </div>
                </div>
              );
            })}
          </div>
          {members.map((m) => {
            const linked = !!m.member_user_id;
            return (
              <div
                key={m.id}
                style={{
                  background: CARD,
                  border: BORDER,
                  borderRadius: 12,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 2 }}>
                      {m.member_name || m.member_email}
                    </div>
                    <div style={{ fontSize: 10, color: SUB }}>{m.relationship}</div>
                    <div style={{ fontFamily: T, fontSize: 9, color: MUTED, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.member_email}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
                    <span
                      style={{
                        fontFamily: T,
                        fontSize: 8,
                        padding: '2px 7px',
                        borderRadius: 5,
                        background: m.alert_level === 'critical' ? 'rgba(232,82,110,.12)' : 'rgba(74,222,128,.1)',
                        color: m.alert_level === 'critical' ? ALERT : OK,
                        border: `1px solid ${m.alert_level === 'critical' ? 'rgba(232,82,110,.3)' : 'rgba(74,222,128,.3)'}`,
                        textTransform: 'uppercase',
                        letterSpacing: '.1em',
                      }}
                    >
                      {m.alert_level === 'critical' ? 'Critical' : 'All alerts'}
                    </span>
                    <span style={{ fontFamily: T, fontSize: 8, color: linked ? OK : MUTED }}>
                      {linked ? 'Active' : 'Pending'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

// =========================================================================
// AIView (Tribal Health OS)
// =========================================================================

interface ChatTurn { role: 'user' | 'ai'; text: string }

const SUGGESTED = [
  'What do her live vitals mean?',
  'Is her heart rate normal right now?',
  'Explain her HRV reading',
  'How is her SpO2 trend?',
  'What should the family watch for?',
  'How close is she to her A1C target?',
];

function AIView({ session, router }: { session: CCSession; router: ReturnType<typeof useRouter> }) {
  const [msgs, setMsgs] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs.length]);

  const ask = async (text: string) => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setInput('');
    setMsgs((p) => [...p, { role: 'user', text: t }]);
    try {
      const valid = await ensureValidSession(session);
      if (!valid) { router.push('/login'); return; }
      const r = await fetch(`${HEALTH_OS_URL}/api/shield`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${valid.access_token}`,
        },
        body: JSON.stringify({ prompt: t }),
      });
      const d = await r.json().catch(() => ({}));
      const blocked = Boolean(d?.meta?.blocked);
      let aiText: string;
      if (blocked) {
        aiText = 'Blocked: PII detected. Re-send your question without personally identifying information.';
      } else if (typeof d.insight === 'string' && d.insight.length > 0) {
        aiText = d.insight;
      } else {
        aiText = 'Tribal Health OS is unavailable right now. Try again in a moment.';
      }
      setMsgs((p) => [...p, { role: 'ai', text: aiText }]);
    } catch {
      setMsgs((p) => [...p, { role: 'ai', text: 'Network error. Your prompt was not sent. Try again.' }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div
        style={{
          background: CARD,
          border: BORDER,
          borderRadius: 14,
          padding: 14,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 9,
              background: `linear-gradient(135deg, ${TEAL}, ${TEAL2})`,
              color: '#0d2a1c',
              fontSize: 13,
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              letterSpacing: '.05em',
            }}
            aria-hidden
          >
            CC
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: P, fontSize: 16, color: INK, marginBottom: 2 }}>
              Tribal Health OS
            </div>
            <div style={{ fontSize: 11, color: SUB, lineHeight: 1.5 }}>
              AI grounded in your loved one's live wearable data and clinical
              panel. Every answer cites her real numbers.
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 9px',
                borderRadius: 12,
                background: 'rgba(74,222,128,0.12)',
                border: '1px solid rgba(74,222,128,0.3)',
                fontFamily: T,
                fontSize: 9,
                color: OK,
                marginTop: 8,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '.12em',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: OK,
                  animation: 'pulse 1.5s infinite',
                }}
              />
              Live Wearable Connected
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollRef} style={{ maxHeight: 280, overflowY: 'auto', marginBottom: 10 }}>
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 8,
            }}
          >
            <div
              style={{
                maxWidth: '80%',
                padding: '9px 12px',
                borderRadius: 12,
                background: m.role === 'user' ? `linear-gradient(135deg, ${TEAL}, ${TEAL2})` : '#111827',
                color: m.role === 'user' ? '#0d2a1c' : '#e2e8f0',
                fontSize: 12,
                lineHeight: 1.55,
                wordBreak: 'break-word',
              }}
            >
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div style={{ padding: '9px 12px', fontSize: 11, color: MUTED, fontStyle: 'italic' }}>
            Tribal Health OS thinking...
          </div>
        )}
      </div>

      {msgs.length === 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {SUGGESTED.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => ask(q)}
              disabled={sending}
              style={{
                padding: '7px 12px',
                borderRadius: 16,
                border: '1px solid rgba(20,184,166,0.3)',
                background: 'rgba(20,184,166,0.08)',
                color: TEAL,
                fontSize: 11,
                fontFamily: O,
                cursor: sending ? 'not-allowed' : 'pointer',
                opacity: sending ? 0.6 : 1,
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
          placeholder="Ask Tribal Health OS..."
          disabled={sending}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 22,
            border: BORDER,
            background: 'rgba(255,255,255,0.04)',
            color: INK,
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          onClick={() => ask(input)}
          disabled={sending || !input.trim()}
          aria-label="Ask"
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: 'none',
            background: `linear-gradient(135deg, ${TEAL}, ${TEAL2})`,
            color: '#0d2a1c',
            fontSize: 16,
            fontWeight: 700,
            cursor: sending || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: sending || !input.trim() ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          ▶
        </button>
      </div>
    </>
  );
}

// =========================================================================
// AlertsView (24hr health watch over live wearable readings)
// =========================================================================

function AlertsView({ shield, shieldLoading }: { shield: ShieldPayload | null; shieldLoading: boolean }) {
  const alerts = computeAlerts(shield);
  const critical = alerts.filter((a) => a.severity === 'critical');
  const warn = alerts.filter((a) => a.severity === 'warn');

  return (
    <>
      <div
        style={{
          background: `linear-gradient(135deg, rgba(20,184,166,0.12), rgba(20,184,166,0.04))`,
          border: `1px solid rgba(20,184,166,0.3)`,
          borderRadius: 12,
          padding: 12,
          marginBottom: 14,
          fontSize: 11,
          color: SUB,
          lineHeight: 1.6,
        }}
      >
        <div style={{ fontFamily: P, fontSize: 14, color: INK, marginBottom: 4 }}>
          24-hour health watch
        </div>
        Alerts trigger automatically when wearable readings cross safe
        thresholds. Phone notifications are coming soon; for now keep
        this tab open to see them in real time.
      </div>

      {shieldLoading && alerts.length === 0 && (
        <div style={{ padding: '14px 0', fontSize: 12, color: MUTED }}>
          Reading live vitals...
        </div>
      )}

      {!shieldLoading && alerts.length === 0 && (
        <div
          style={{
            background: 'rgba(74,222,128,0.06)',
            border: '1px solid rgba(74,222,128,0.3)',
            borderRadius: 12,
            padding: 16,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'rgba(74,222,128,0.18)',
              color: OK,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              flexShrink: 0,
            }}
            aria-hidden
          >
            ✓
          </div>
          <div>
            <div style={{ fontSize: 13, color: OK, fontWeight: 700, marginBottom: 2 }}>
              All vitals in safe range
            </div>
            <div style={{ fontSize: 11, color: SUB, lineHeight: 1.55 }}>
              Last check moments ago. We'll surface anything that crosses a
              clinical threshold here.
            </div>
          </div>
        </div>
      )}

      {critical.length > 0 && (
        <>
          <div
            style={{
              fontFamily: T,
              fontSize: 9,
              color: ALERT,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              fontWeight: 700,
              margin: '4px 0 8px',
            }}
          >
            Critical · {critical.length}
          </div>
          {critical.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </>
      )}

      {warn.length > 0 && (
        <>
          <div
            style={{
              fontFamily: T,
              fontSize: 9,
              color: WARN,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              fontWeight: 700,
              margin: '14px 0 8px',
            }}
          >
            Watch · {warn.length}
          </div>
          {warn.map((a) => (
            <AlertRow key={a.id} alert={a} />
          ))}
        </>
      )}
    </>
  );
}

function AlertRow({ alert }: { alert: ActiveAlert }) {
  const tone = alert.severity === 'critical' ? ALERT : WARN;
  const bg =
    alert.severity === 'critical'
      ? 'rgba(232,82,110,0.06)'
      : 'rgba(192,121,65,0.06)';
  const border =
    alert.severity === 'critical'
      ? '1px solid rgba(232,82,110,0.3)'
      : '1px solid rgba(192,121,65,0.3)';
  return (
    <div
      style={{
        background: bg,
        border,
        borderLeft: `3px solid ${tone}`,
        borderRadius: 11,
        padding: 12,
        marginBottom: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>{alert.title}</span>
        <span style={{ fontFamily: T, fontSize: 14, fontWeight: 700, color: tone }}>{alert.value}</span>
      </div>
      <div style={{ fontFamily: T, fontSize: 9, color: MUTED, letterSpacing: '.04em', marginBottom: alert.detail ? 6 : 0 }}>
        {alert.vital} · {alert.range}
      </div>
      {alert.detail && (
        <div style={{ fontSize: 11, color: SUB, lineHeight: 1.5 }}>{alert.detail}</div>
      )}
    </div>
  );
}

// =========================================================================
// Top-level CareCircleApp
// =========================================================================

type TabId = 'home' | 'alerts' | 'meds' | 'cal' | 'family' | 'ai';
const NAV: Array<{ id: TabId; icon: string; label: string }> = [
  { id: 'home', icon: '⌂', label: 'Home' },
  { id: 'alerts', icon: '⚠', label: 'Alerts' },
  { id: 'meds', icon: '☥', label: 'Meds' },
  { id: 'cal', icon: '⦾', label: 'Cal' },
  { id: 'family', icon: '♤', label: 'Family' },
  { id: 'ai', icon: '☸', label: 'Health OS' },
];

export default function CareCircleApp() {
  const router = useRouter();
  const [session, setSession] = useState<CCSession | null>(loadSession);
  const [loading, setLoading] = useState<boolean>(() => loadSession() === null);
  const [tab, setTab] = useState<TabId>('home');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = loadSession();
      if (!s) {
        router.push('/login');
        return;
      }
      const valid = await ensureValidSession(s);
      if (cancelled) return;
      if (valid) setSession(valid);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [router]);

  const { shield, err: shieldErr, loading: shieldLoading } = useShieldPolling(session);

  // Pull patient_nickname for the authenticated member from care_circle.
  // Each family member sets their own nickname via the FamilyPage editor;
  // we read it on every CareCircleApp mount and on session change so a
  // nickname saved on the dashboard surface shows up in the PatientCard
  // here without requiring a fresh login.
  const [patientNickname, setPatientNickname] = useState<string | null>(null);
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const valid = await ensureValidSession(session);
        if (!valid || cancelled) return;
        const r = await fetch(
          `${SUPABASE_URL}/rest/v1/care_circle?member_user_id=eq.${valid.user_id}&select=patient_nickname&limit=1`,
          {
            headers: { apikey: ANON_KEY, Authorization: `Bearer ${valid.access_token}` },
            cache: 'no-store',
          },
        );
        if (!r.ok || cancelled) return;
        const rows = (await r.json()) as Array<{ patient_nickname: string | null }>;
        if (!cancelled) {
          setPatientNickname(rows[0]?.patient_nickname ?? null);
        }
      } catch {
        // Best-effort: if the column does not exist yet (migration not
        // applied) or the request fails, fall back to session.patient_name
        // in PatientCard.
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const signOut = useCallback(() => {
    window.localStorage.removeItem('cc-session');
    router.push('/login');
  }, [router]);

  if (loading || !session) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: BG,
          color: MUTED,
          fontFamily: O,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        Loading dashboard...
      </div>
    );
  }

  const renderTab = () => {
    switch (tab) {
      case 'alerts':
        return <AlertsView shield={shield} shieldLoading={shieldLoading} />;
      case 'meds':
        return <MedsView session={session} router={router} />;
      case 'cal':
        return <CalendarView session={session} router={router} />;
      case 'family':
        return <FamilyView session={session} router={router} />;
      case 'ai':
        return <AIView session={session} router={router} />;
      case 'home':
      default:
        return (
          <>
            <PatientCard session={session} shield={shield} shieldLoading={shieldLoading} patientNickname={patientNickname} />
            <ActiveProtocols shield={shield} />
            <RiskDomains shield={shield} />
          </>
        );
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .sov{display:flex;flex-direction:column;height:100vh;height:100dvh;font-family:'Outfit',sans-serif;color:#F4EDE1;background:${BG};position:relative;overflow:hidden;max-width:480px;margin:0 auto}
        .sov::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 80% 40% at 80% 0%,rgba(20,184,166,0.08) 0%,transparent 60%),radial-gradient(ellipse 60% 60% at 0% 100%,rgba(45,212,191,0.06) 0%,transparent 60%)}
        .sov-hdr{position:relative;z-index:10;flex-shrink:0;padding:14px 18px 12px;background:rgba(10,22,40,0.92);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,0.06)}
        .sov-scroll{flex:1;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;position:relative;z-index:1}
        .sov-pad{padding:14px 18px calc(96px + env(safe-area-inset-bottom,0px))}
        .sov-bnav{position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:480px;background:rgba(10,22,40,0.97);backdrop-filter:blur(20px);border-top:1px solid rgba(255,255,255,0.06);display:grid;grid-template-columns:repeat(6,1fr);padding:8px 4px calc(10px + env(safe-area-inset-bottom,0px));z-index:20}
        .sov-bnav-btn{background:transparent;border:none;color:#A8B8C8;font-family:'Outfit',sans-serif;font-size:10px;font-weight:600;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px 4px;border-radius:9px;transition:color .2s;min-height:50px;justify-content:center;position:relative}
        .sov-bnav-btn.on{color:${TEAL}}
        .sov-bnav-btn.on::before{content:'';position:absolute;top:0;left:50%;transform:translateX(-50%);width:32px;height:2px;background:linear-gradient(90deg,${TEAL},${TEAL2});border-radius:0 0 2px 2px}
      `}</style>
      <div className="sov">
        <div className="sov-hdr">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <div
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 9,
                  background: `linear-gradient(135deg, ${TEAL}, ${TEAL2})`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 800,
                  color: '#0d2a1c',
                  flexShrink: 0,
                  letterSpacing: '.05em',
                }}
              >
                CC
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: P, fontSize: 17, color: INK, lineHeight: 1 }}>CareCircle</div>
                <div
                  style={{
                    fontFamily: T,
                    fontSize: 8,
                    color: TEAL,
                    letterSpacing: '.22em',
                    textTransform: 'uppercase',
                    marginTop: 3,
                  }}
                >
                  Sovereign Edition
                </div>
              </div>
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 12px',
                borderRadius: 14,
                background: 'rgba(74,222,128,0.1)',
                border: '1px solid rgba(74,222,128,0.35)',
                fontFamily: T,
                fontSize: 9,
                color: OK,
                fontWeight: 700,
                letterSpacing: '.14em',
                textTransform: 'uppercase',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: OK,
                  animation: 'pulse 1.5s infinite',
                }}
              />
              Shield On
            </div>
          </div>
        </div>

        {shieldErr && tab === 'home' && (
          <div
            style={{
              margin: '14px 18px 0',
              padding: 12,
              background: 'rgba(232,82,110,0.06)',
              border: '1px solid rgba(232,82,110,0.25)',
              borderRadius: 11,
              color: ALERT,
              fontSize: 11,
              lineHeight: 1.5,
            }}
          >
            Vitals not available: {shieldErr}
          </div>
        )}

        <div className="sov-scroll">
          <div className="sov-pad">
            <LiveWearableStrip shield={shield} />
            <ZKShieldBanner />
            {renderTab()}
            <div style={{ padding: '12px 0 0' }}>
              <button
                onClick={signOut}
                style={{
                  width: '100%',
                  padding: '10px 0',
                  borderRadius: 10,
                  border: BORDER,
                  cursor: 'pointer',
                  background: 'rgba(255,255,255,.04)',
                  color: MUTED,
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: O,
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>

        <div className="sov-bnav">
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setTab(n.id)}
              className={`sov-bnav-btn ${tab === n.id ? 'on' : ''}`}
              aria-current={tab === n.id ? 'page' : undefined}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>{n.icon}</span>
              <span style={{ fontSize: 9, letterSpacing: '.04em' }}>{n.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
