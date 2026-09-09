'use client';
import { useEffect, useState } from 'react';
import {
  sbAuthed,
  fmtTime,
  type CCSession,
  type AlertRow,
  type CircleRow,
} from '@/lib/cc-data';
import { T, O, PAGE_PAD, SECTION_LABEL, CARD_BG, CARD_BORDER } from './ui';

export default function HomePage({
  session,
  setPage,
}: {
  session: CCSession;
  setPage: (p: string) => void;
}) {
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [me, setMe] = useState<CircleRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [alertsRes, meRes] = await Promise.all([
          sbAuthed(
            session.access_token,
            `care_circle_alerts?patient_id=eq.${session.patient_id}&order=fired_at.desc&limit=10&select=*`,
          ),
          sbAuthed(
            session.access_token,
            `care_circle?member_user_id=eq.${session.user_id}&limit=1&select=*`,
          ),
        ]);
        if (!alertsRes.ok) throw new Error(`alerts ${alertsRes.status}`);
        if (!meRes.ok) throw new Error(`circle ${meRes.status}`);
        const a = (await alertsRes.json()) as AlertRow[];
        const m = ((await meRes.json()) as CircleRow[])[0] || null;
        if (cancelled) return;
        setAlerts(a);
        setMe(m);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.access_token, session.patient_id, session.user_id]);

  const patientName = session.patient_name || 'Your loved one';
  const criticalCount = (alerts || []).filter((a) => a.severity === 'critical').length;
  const lastAlert = (alerts || [])[0];

  return (
    <div style={PAGE_PAD}>
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
        <div
          style={{
            fontFamily: "'Playfair Display',serif",
            fontSize: 22,
            color: '#eef2f8',
            marginBottom: 4,
          }}
        >
          {patientName}
        </div>
        {me && (
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: CARD_BORDER,
              fontSize: 11,
              color: '#7a9bbf',
              lineHeight: 1.5,
            }}
          >
            Signed in as <strong style={{ color: '#eef2f8' }}>{me.member_name}</strong>,{' '}
            {me.relationship}. Alert preference:{' '}
            <strong style={{ color: me.alert_level === 'critical' ? '#e8526e' : '#00d4b8' }}>
              {me.alert_level === 'critical' ? 'critical only' : 'all alerts'}
            </strong>
            .
          </div>
        )}
      </div>

      <div style={{ ...SECTION_LABEL, margin: '20px 0 10px' }}>Alert summary</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        <div style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontFamily: T, fontSize: 9, color: '#7a9bbf', textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Critical
          </div>
          <div
            style={{
              fontFamily: T,
              fontSize: 22,
              fontWeight: 700,
              color: criticalCount > 0 ? '#e8526e' : '#4ade80',
              marginTop: 4,
            }}
          >
            {alerts === null ? '...' : criticalCount}
          </div>
        </div>
        <div style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: 12, padding: '12px 14px' }}>
          <div style={{ fontFamily: T, fontSize: 9, color: '#7a9bbf', textTransform: 'uppercase', letterSpacing: '.1em' }}>
            Total recent
          </div>
          <div style={{ fontFamily: T, fontSize: 22, fontWeight: 700, color: '#eef2f8', marginTop: 4 }}>
            {alerts === null ? '...' : alerts.length}
          </div>
        </div>
      </div>

      {error && (
        <div
          style={{
            background: 'rgba(232,82,110,.08)',
            border: '1px solid rgba(232,82,110,.25)',
            borderRadius: 12,
            padding: '10px 14px',
            marginBottom: 12,
            fontSize: 11,
            color: '#e8526e',
            lineHeight: 1.55,
          }}
        >
          Could not load alerts: {error}
        </div>
      )}

      {lastAlert ? (
        <div
          style={{
            background:
              lastAlert.severity === 'critical'
                ? 'rgba(232,82,110,.08)'
                : 'rgba(212,168,67,.08)',
            border: `1px solid ${lastAlert.severity === 'critical' ? 'rgba(232,82,110,.3)' : 'rgba(212,168,67,.25)'}`,
            borderRadius: 12,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <div style={{ fontFamily: T, fontSize: 9, color: '#7a9bbf', marginBottom: 4 }}>
            Last alert: {fmtTime(lastAlert.fired_at)}
          </div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              marginBottom: 4,
              color: lastAlert.severity === 'critical' ? '#e8526e' : '#d4a843',
            }}
          >
            {lastAlert.metric} · {lastAlert.severity.toUpperCase()}
          </div>
          <div style={{ fontSize: 11, color: '#eef2f8', lineHeight: 1.55 }}>
            {lastAlert.recommendation}
          </div>
        </div>
      ) : alerts !== null ? (
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
          No alerts on file. All monitored vitals are within safe range.
        </div>
      ) : null}

      <button
        onClick={() => setPage('careiq')}
        style={{
          width: '100%',
          padding: '11px 0',
          borderRadius: 12,
          border: 'none',
          cursor: 'pointer',
          background: 'linear-gradient(135deg,#00d4b8,#00b89e)',
          color: '#07101f',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: O,
          marginBottom: 18,
        }}
      >
        See full alert history
      </button>
    </div>
  );
}
