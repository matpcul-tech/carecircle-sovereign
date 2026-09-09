'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { T, O, PAGE_PAD, SECTION_LABEL, CARD_BG, CARD_BORDER } from './ui';
import MfaCard from './MfaCard';
import ChangePasswordCard from './ChangePasswordCard';
import AccessRequestsCard from './AccessRequestsCard';
import { type CCSession } from '@/lib/cc-data';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const HEALTH_OS_URL =
  process.env.NEXT_PUBLIC_HEALTH_OS_URL || 'https://sovereignhealthcareos.com';

type Severity = 'critical' | 'informational';

interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
  patient_id: string;
  patient_name: string | null;
}

interface CareCircleRow {
  id: string;
  patient_id: string;
  member_user_id: string;
  member_email: string;
  member_name: string;
  member_phone: string | null;
  relationship: string;
  alert_level: Severity;
  care_role: 'admin' | 'caregiver' | 'viewer' | null;
  patient_nickname: string | null;
  created_at: string;
}

// What each role can do, shown to the member so access limits are legible.
const ROLE_LABEL: Record<'admin' | 'caregiver' | 'viewer', string> = {
  admin: 'Admin · full access',
  caregiver: 'Caregiver · edit, no delete',
  viewer: 'Viewer · read-only',
};

interface AlertRow {
  id: string;
  patient_id: string;
  metric: string;
  severity: Severity;
  recommendation: string;
  fired_at: string;
  delivery_count: number;
}

interface ShieldVitals {
  patient_id: string;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  a1c: number | null;
  ldl: number | null;
  hr: number | null;
  spo2: number | null;
  risk_score: number;
  updated_at: string | null;
  decrypted_at: string;
  shield_version: string;
}

function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function shieldTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function loadSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('cc-session');
    if (!raw) return null;
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

async function refreshSession(s: Session): Promise<Session | null> {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
      {
        method: 'POST',
        headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      },
    );
    if (!r.ok) return null;
    const data = (await r.json()) as {
      access_token: string;
      refresh_token: string;
      expires_at: number;
    };
    const updated: Session = {
      ...s,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
    };
    window.localStorage.setItem('cc-session', JSON.stringify(updated));
    return updated;
  } catch {
    return null;
  }
}

// Lenient: never returns null when there is an existing session in
// localStorage. A failed token refresh keeps the user signed in for this
// page load; data calls that 401 are surfaced inline rather than nuking
// the session and redirecting to /login.
async function ensureValidSession(s: Session): Promise<Session> {
  if (s.expires_at - 60 > Math.floor(Date.now() / 1000)) return s;
  const refreshed = await refreshSession(s);
  return refreshed ?? s;
}

async function sbAuthed(token: string, path: string): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
}

function bpStatus(sys: number | null, dia: number | null): 'ok' | 'warn' | 'alert' {
  if (sys === null && dia === null) return 'ok';
  if ((sys ?? 0) >= 140 || (dia ?? 0) >= 90) return 'alert';
  if ((sys ?? 0) >= 130 || (dia ?? 0) >= 80) return 'warn';
  return 'ok';
}
function a1cStatus(v: number | null): 'ok' | 'warn' | 'alert' {
  if (v === null) return 'ok';
  if (v >= 6.5) return 'alert';
  if (v >= 5.7) return 'warn';
  return 'ok';
}
function ldlStatus(v: number | null): 'ok' | 'warn' | 'alert' {
  if (v === null) return 'ok';
  if (v >= 190) return 'alert';
  if (v >= 130) return 'warn';
  return 'ok';
}
function hrStatus(v: number | null): 'ok' | 'warn' | 'alert' {
  if (v === null) return 'ok';
  if (v < 50 || v > 100) return 'alert';
  if (v < 55 || v > 95) return 'warn';
  return 'ok';
}
function spo2Status(v: number | null): 'ok' | 'warn' | 'alert' {
  if (v === null) return 'ok';
  if (v < 90) return 'alert';
  if (v < 95) return 'warn';
  return 'ok';
}
const statusColor = (s: 'ok' | 'warn' | 'alert') =>
  s === 'alert' ? '#E05C3A' : s === 'warn' ? '#C07941' : '#7BC8A0';

export default function FamilyPage() {
  const router = useRouter();
  // Hydrate the session synchronously from localStorage on first render so a
  // page refresh never momentarily looks signed-out.
  const [session, setSession] = useState<Session | null>(loadSession);
  const [myRow, setMyRow] = useState<CareCircleRow | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [vitals, setVitals] = useState<ShieldVitals | null>(null);
  const [vitalsErr, setVitalsErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline nickname editor state.
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [savingNickname, setSavingNickname] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);

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
      setSession(valid);

      try {
        const myRowRes = await sbAuthed(
          valid.access_token,
          `care_circle?member_user_id=eq.${valid.user_id}&limit=1&select=*`,
        );
        if (!myRowRes.ok) {
          throw new Error(`circle row ${myRowRes.status}: ${await myRowRes.text()}`);
        }
        const rows = (await myRowRes.json()) as CareCircleRow[];
        let me = rows[0];
        if (!me) {
          // The signed-in account is the PATIENT looking at their own
          // circle (Sovereign Edition runs on the Health OS project, so the
          // elder can sign in to approve family access requests). There is
          // no member row for the patient; synthesize one so the page
          // renders with admin rights instead of failing.
          if (valid.user_id === valid.patient_id) {
            me = {
              id: 'self',
              patient_id: valid.patient_id,
              member_user_id: valid.user_id,
              member_email: '',
              member_name: valid.patient_name || 'You',
              member_phone: null,
              relationship: 'Patient',
              alert_level: 'critical',
              care_role: 'admin',
              patient_nickname: null,
              created_at: new Date().toISOString(),
            };
          } else {
            throw new Error('Could not find your Care Circle row.');
          }
        }
        if (cancelled) return;
        setMyRow(me);

        const alertsRes = await sbAuthed(
          valid.access_token,
          `care_circle_alerts?patient_id=eq.${me.patient_id}&order=fired_at.desc&limit=50&select=*`,
        );
        if (!alertsRes.ok) {
          throw new Error(`alerts ${alertsRes.status}: ${await alertsRes.text()}`);
        }
        const alertRows = (await alertsRes.json()) as AlertRow[];
        if (cancelled) return;
        setAlerts(alertRows);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }

      try {
        const r = await fetch(`${HEALTH_OS_URL}/api/shield/decrypt`, {
          headers: { Authorization: `Bearer ${valid.access_token}` },
          cache: 'no-store',
        });
        const data = (await r.json().catch(() => ({}))) as Partial<ShieldVitals> & { error?: string };
        if (cancelled) return;
        if (!r.ok) {
          setVitalsErr(data.error || `vitals ${r.status}`);
        } else {
          setVitals(data as ShieldVitals);
        }
      } catch (e) {
        if (!cancelled) setVitalsErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const signOut = () => {
    window.localStorage.removeItem('cc-session');
    router.push('/login');
  };

  // Save the inline nickname draft to care_circle.patient_nickname via
  // /api/circle/update-nickname. Empty draft clears the column (nickname
  // becomes null), so the row re-falls-through to session.patient_name.
  async function saveNickname() {
    if (savingNickname || !session) return;
    setSavingNickname(true);
    setNicknameError(null);
    try {
      const valid = await ensureValidSession(session);
      const r = await fetch('/api/circle/update-nickname', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${valid.access_token}`,
        },
        body: JSON.stringify({ nickname: nicknameDraft.trim() || null }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        nickname?: string | null;
        error?: string;
      };
      if (!r.ok || !d.ok) {
        throw new Error(d.error || `save failed (${r.status})`);
      }
      const saved = d.nickname ?? null;
      setMyRow((prev) => (prev ? { ...prev, patient_nickname: saved } : prev));
      setEditingNickname(false);
    } catch (e) {
      setNicknameError((e as Error).message);
    } finally {
      setSavingNickname(false);
    }
  }

  if (loading) {
    return (
      <div style={PAGE_PAD}>
        <div style={{ fontSize: 12, color: '#A8B8C8', textAlign: 'center', padding: 32 }}>
          Loading your Care Circle...
        </div>
      </div>
    );
  }

  if (error || !session || !myRow) {
    return (
      <div style={PAGE_PAD}>
        <div style={{ ...SECTION_LABEL, marginBottom: 8 }}>Care Circle</div>
        <div
          style={{
            background: 'rgba(232,82,110,.1)',
            border: '1px solid rgba(232,82,110,.3)',
            borderRadius: 12,
            padding: 14,
            fontSize: 11,
            color: '#E05C3A',
            marginBottom: 12,
          }}
        >
          {error || 'Session error.'}
        </div>
        <button
          onClick={signOut}
          style={{
            width: '100%',
            padding: '10px 0',
            borderRadius: 10,
            border: '1px solid rgba(123,200,160,.14)',
            cursor: 'pointer',
            background: 'rgba(255,255,255,.06)',
            color: '#F4EDE1',
            fontSize: 12,
            fontWeight: 700,
            fontFamily: O,
          }}
        >
          Sign in again
        </button>
      </div>
    );
  }

  // Display priority: per-member nickname first, then the patient_name
  // we wrote into cc-session at signup/login, then a generic fallback.
  const displayName =
    myRow.patient_nickname ||
    session.patient_name ||
    'Your loved one';
  const lastAlert = alerts[0];

  const vitalCells = vitals
    ? [
        {
          label: 'BP',
          val:
            vitals.bp_systolic != null && vitals.bp_diastolic != null
              ? `${vitals.bp_systolic}/${vitals.bp_diastolic}`
              : '—',
          unit: 'mmHg',
          status: bpStatus(vitals.bp_systolic, vitals.bp_diastolic),
        },
        {
          label: 'A1C',
          val: vitals.a1c != null ? vitals.a1c.toFixed(1) : '—',
          unit: '%',
          status: a1cStatus(vitals.a1c),
        },
        {
          label: 'LDL',
          val: vitals.ldl != null ? String(Math.round(vitals.ldl)) : '—',
          unit: 'mg/dL',
          status: ldlStatus(vitals.ldl),
        },
        {
          label: 'HR',
          val: vitals.hr != null ? String(vitals.hr) : '—',
          unit: 'bpm',
          status: hrStatus(vitals.hr),
        },
        {
          label: 'SpO2',
          val: vitals.spo2 != null ? String(vitals.spo2) : '—',
          unit: '%',
          status: spo2Status(vitals.spo2),
        },
      ]
    : [];

  const anyVitalEntered =
    vitals &&
    (vitals.bp_systolic != null ||
      vitals.bp_diastolic != null ||
      vitals.a1c != null ||
      vitals.ldl != null ||
      vitals.hr != null ||
      vitals.spo2 != null);

  const decryptedHHMM = vitals ? shieldTime(vitals.decrypted_at) : '';

  return (
    <div style={PAGE_PAD}>
      {/* Patient header. The Sign out button is provided by the surrounding
          wrapper (CareCircleApp on /dashboard, AppPage on /app) so there is
          a single Sign out per route. */}
      <div style={SECTION_LABEL}>You are monitoring</div>
      <div
        style={{
          background: CARD_BG,
          border: CARD_BORDER,
          borderRadius: 14,
          padding: 16,
          marginBottom: 12,
        }}
      >
        {editingNickname ? (
          <div style={{ marginBottom: 4 }}>
            <input
              autoFocus
              value={nicknameDraft}
              onChange={(e) => setNicknameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveNickname();
                } else if (e.key === 'Escape') {
                  setEditingNickname(false);
                  setNicknameError(null);
                }
              }}
              maxLength={60}
              placeholder="Mom, Grandma Mary, Dad..."
              aria-label="Patient nickname"
              disabled={savingNickname}
              style={{
                width: '100%',
                background: '#11243d',
                border: '1px solid #1e3a5f',
                borderRadius: 8,
                padding: '10px 12px',
                color: '#F4EDE1',
                fontSize: 18,
                fontFamily: "'Playfair Display',serif",
                outline: 'none',
                marginBottom: 8,
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={saveNickname}
                disabled={savingNickname}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 8,
                  border: 'none',
                  background: 'linear-gradient(135deg,#7BC8A0,#3D8B5E)',
                  color: '#0B1829',
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: O,
                  cursor: savingNickname ? 'not-allowed' : 'pointer',
                  opacity: savingNickname ? 0.6 : 1,
                }}
              >
                {savingNickname ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setEditingNickname(false);
                  setNicknameError(null);
                }}
                disabled={savingNickname}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  borderRadius: 8,
                  border: '1px solid rgba(123,200,160,.2)',
                  background: 'transparent',
                  color: '#A8B8C8',
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: O,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
            {nicknameError && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: '#E05C3A',
                }}
              >
                {nicknameError}
              </div>
            )}
            <div
              style={{
                marginTop: 8,
                fontFamily: T,
                fontSize: 9,
                color: '#A8B8C8',
                lineHeight: 1.5,
              }}
            >
              Leave blank to use the patient&apos;s real name.
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 4,
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: "'Playfair Display',serif",
                fontSize: 22,
                color: '#F4EDE1',
              }}
            >
              {displayName}
            </span>
            <button
              onClick={() => {
                setNicknameDraft(myRow.patient_nickname ?? '');
                setNicknameError(null);
                setEditingNickname(true);
              }}
              aria-label="Edit nickname"
              title="Set a nickname for the patient"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: '#A8B8C8',
                padding: 4,
                display: 'inline-flex',
                alignItems: 'center',
                lineHeight: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path
                  d="M11.3 2.7l2 2L5 13l-3 .5L2.5 11l8.8-8.3z"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {myRow.patient_nickname && session.patient_name &&
              myRow.patient_nickname.trim() !== session.patient_name.trim() && (
                <span
                  style={{
                    fontFamily: T,
                    fontSize: 9,
                    color: '#A8B8C8',
                    letterSpacing: '.04em',
                  }}
                >
                  ({session.patient_name})
                </span>
              )}
          </div>
        )}
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: CARD_BORDER,
            display: 'flex',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: T,
                fontSize: 9,
                color: '#A8B8C8',
                textTransform: 'uppercase',
                letterSpacing: '.1em',
              }}
            >
              You are
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, marginTop: 3 }}>
              {myRow.member_name}
            </div>
            <div style={{ fontSize: 11, color: '#A8B8C8' }}>{myRow.relationship}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                alignSelf: 'flex-start',
                gap: 4,
                fontFamily: T,
                fontSize: 9,
                padding: '4px 10px',
                borderRadius: 8,
                background:
                  myRow.alert_level === 'critical'
                    ? 'rgba(232,82,110,.12)'
                    : 'rgba(123,200,160,.1)',
                color: myRow.alert_level === 'critical' ? '#E05C3A' : '#7BC8A0',
                border: `1px solid ${myRow.alert_level === 'critical' ? 'rgba(232,82,110,.3)' : 'rgba(123,200,160,.2)'}`,
                textTransform: 'uppercase',
                letterSpacing: '.1em',
              }}
            >
              {myRow.alert_level === 'critical' ? 'Critical only' : 'All alerts'}
            </div>
            <div
              style={{
                fontFamily: T,
                fontSize: 9,
                padding: '4px 10px',
                borderRadius: 8,
                background: 'rgba(128,96,204,.12)',
                color: '#b6a4e8',
                border: '1px solid rgba(128,96,204,.3)',
                textTransform: 'uppercase',
                letterSpacing: '.1em',
                whiteSpace: 'nowrap',
              }}
            >
              {ROLE_LABEL[myRow.care_role ?? 'caregiver']}
            </div>
          </div>
        </div>
      </div>

      {/* Account security: two-factor authentication + password */}
      <div style={{ ...SECTION_LABEL, margin: '20px 0 10px' }}>Account security</div>
      <MfaCard session={session} />
      <ChangePasswordCard session={session} />

      {/* Family-initiated access requests: only the patient or a circle
          admin can approve, so only they see the card. */}
      {myRow.care_role === 'admin' && (
        <>
          <div style={{ ...SECTION_LABEL, margin: '20px 0 10px' }}>Access requests</div>
          <AccessRequestsCard session={session as CCSession} />
        </>
      )}

      {/* Vitals row from the Chikasha Health OS Shield */}
      <div style={{ ...SECTION_LABEL, margin: '20px 0 10px' }}>Latest vitals</div>
      {anyVitalEntered ? (
        <>
          <div
            style={{
              display: 'flex',
              gap: 8,
              overflowX: 'auto',
              scrollbarWidth: 'none',
              marginBottom: 8,
              paddingBottom: 4,
            }}
          >
            {vitalCells.map((v) => (
              <div
                key={v.label}
                style={{
                  flexShrink: 0,
                  background: CARD_BG,
                  border: `1px solid ${statusColor(v.status)}30`,
                  borderRadius: 12,
                  padding: '11px 13px',
                  minWidth: 92,
                }}
              >
                <div
                  style={{
                    fontFamily: T,
                    fontSize: 9,
                    color: '#A8B8C8',
                    textTransform: 'uppercase',
                    letterSpacing: '.12em',
                    marginBottom: 4,
                  }}
                >
                  {v.label}
                </div>
                <div style={{ fontFamily: T, fontSize: 17, fontWeight: 600, color: statusColor(v.status) }}>
                  {v.val}
                </div>
                <div style={{ fontSize: 9, color: '#A8B8C8', marginTop: 2 }}>{v.unit}</div>
                <div
                  style={{
                    marginTop: 6,
                    display: 'inline-flex',
                    alignItems: 'center',
                    fontFamily: T,
                    fontSize: 7.5,
                    padding: '2px 5px',
                    borderRadius: 5,
                    background: 'rgba(123,200,160,.12)',
                    color: '#7BC8A0',
                    border: '1px solid rgba(123,200,160,.28)',
                    letterSpacing: '.08em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                  }}
                  title={`Decrypted ${vitals ? new Date(vitals.decrypted_at).toLocaleString() : ''}`}
                >
                  Shield {decryptedHHMM}
                </div>
              </div>
            ))}
          </div>
          {vitals?.updated_at && (
            <div style={{ fontFamily: T, fontSize: 9, color: '#A8B8C8', marginBottom: 12 }}>
              Updated {fmtTime(vitals.updated_at)} · risk score {vitals.risk_score}
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            background: CARD_BG,
            border: CARD_BORDER,
            borderRadius: 12,
            padding: 14,
            fontSize: 11,
            color: '#A8B8C8',
            textAlign: 'center',
            marginBottom: 12,
            lineHeight: 1.55,
          }}
        >
          {vitalsErr
            ? `Vitals not available: ${vitalsErr}`
            : vitals === null
            ? 'Loading vitals from Chikasha Health OS...'
            : 'No lab values on file. Vitals appear here after the patient enters them in Chikasha Health OS.'}
        </div>
      )}

      <div style={{ ...SECTION_LABEL, margin: '20px 0 10px' }}>Last alert</div>
      {lastAlert ? (
        <div
          style={{
            background:
              lastAlert.severity === 'critical'
                ? 'rgba(232,82,110,.08)'
                : 'rgba(192,121,65,.08)',
            border: `1px solid ${lastAlert.severity === 'critical' ? 'rgba(232,82,110,.3)' : 'rgba(192,121,65,.25)'}`,
            borderRadius: 12,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <div
            style={{ fontFamily: T, fontSize: 9, color: '#A8B8C8', marginBottom: 4 }}
          >
            {fmtTime(lastAlert.fired_at)}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              marginBottom: 4,
              color: lastAlert.severity === 'critical' ? '#E05C3A' : '#C07941',
            }}
          >
            {lastAlert.metric} · {lastAlert.severity.toUpperCase()}
          </div>
          <div style={{ fontSize: 11, color: '#F4EDE1', lineHeight: 1.55 }}>
            {lastAlert.recommendation}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: CARD_BG,
            border: CARD_BORDER,
            borderRadius: 12,
            padding: 14,
            fontSize: 11,
            color: '#4ade80',
            textAlign: 'center',
            marginBottom: 12,
          }}
        >
          No alerts on file. All monitored thresholds are within range.
        </div>
      )}

      {alerts.length > 1 && (
        <>
          <div style={{ ...SECTION_LABEL, margin: '20px 0 10px' }}>Alert history</div>
          {alerts.slice(1).map((a) => (
            <div
              key={a.id}
              style={{
                background: CARD_BG,
                border: CARD_BORDER,
                borderRadius: 12,
                padding: '12px 14px',
                marginBottom: 8,
              }}
            >
              <div
                style={{ fontFamily: T, fontSize: 9, color: '#A8B8C8', marginBottom: 3 }}
              >
                {fmtTime(a.fired_at)}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  marginBottom: 2,
                  color: a.severity === 'critical' ? '#E05C3A' : '#C07941',
                }}
              >
                {a.metric} · {a.severity.toUpperCase()}
              </div>
              <div style={{ fontSize: 11, color: '#A8B8C8', lineHeight: 1.55 }}>
                {a.recommendation}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
