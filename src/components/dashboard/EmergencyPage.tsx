'use client';
import { useEffect, useState } from 'react';
import { sbAuthed, type CCSession, type CircleRow } from '@/lib/cc-data';
import { T, PAGE_PAD, SECTION_LABEL, CARD_BG, CARD_BORDER } from './ui';

export default function EmergencyPage({ session }: { session: CCSession }) {
  const [me, setMe] = useState<CircleRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await sbAuthed(
          session.access_token,
          `care_circle?member_user_id=eq.${session.user_id}&limit=1&select=*`,
        );
        if (!r.ok) throw new Error(`circle ${r.status}`);
        const rows = (await r.json()) as CircleRow[];
        if (cancelled) return;
        setMe(rows[0] || null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.access_token, session.user_id]);

  return (
    <div style={PAGE_PAD}>
      <div
        style={{
          background:
            'linear-gradient(135deg,rgba(232,82,110,.15),rgba(232,82,110,.05))',
          border: '1px solid rgba(232,82,110,.3)',
          borderRadius: 16,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span
            style={{
              fontFamily: T,
              fontSize: 10,
              color: '#e8526e',
              textTransform: 'uppercase',
              letterSpacing: 2,
              fontWeight: 700,
            }}
          >
            Emergency Profile
          </span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#eef2f8', marginTop: 4 }}>
          {session.patient_name || 'Your loved one'}
        </div>
      </div>

      <div style={SECTION_LABEL}>You on this Care Circle</div>
      {error && (
        <div
          style={{
            background: 'rgba(232,82,110,.08)',
            border: '1px solid rgba(232,82,110,.25)',
            borderRadius: 12,
            padding: '10px 14px',
            fontSize: 11,
            color: '#e8526e',
            marginBottom: 12,
          }}
        >
          Could not load Care Circle row: {error}
        </div>
      )}
      {me ? (
        <div
          style={{
            background: CARD_BG,
            border: CARD_BORDER,
            borderRadius: 14,
            padding: 14,
            marginBottom: 16,
            fontSize: 12,
            color: '#eef2f8',
            lineHeight: 1.7,
          }}
        >
          <div>
            <strong>{me.member_name}</strong> ({me.relationship})
          </div>
          <div style={{ color: '#7a9bbf', fontSize: 11 }}>{me.member_email}</div>
          {me.member_phone && (
            <div style={{ color: '#7a9bbf', fontSize: 11 }}>{me.member_phone}</div>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: '#7a9bbf' }}>
            Alert preference:{' '}
            <span style={{ color: me.alert_level === 'critical' ? '#e8526e' : '#00d4b8' }}>
              {me.alert_level === 'critical' ? 'critical only' : 'all alerts'}
            </span>
          </div>
        </div>
      ) : null}

      <div style={SECTION_LABEL}>Patient medical detail</div>
      <div
        style={{
          background: CARD_BG,
          border: CARD_BORDER,
          borderRadius: 14,
          padding: 18,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: '#eef2f8', marginBottom: 8 }}>
          Coming soon
        </div>
        <div style={{ fontSize: 11, color: '#7a9bbf', lineHeight: 1.6 }}>
          Conditions, medications, allergies, and blood type live in the patient&apos;s encrypted
          CareIQ vault. A non-PHI emergency profile mirror is needed before this section can fill.
        </div>
      </div>
    </div>
  );
}
