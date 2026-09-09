'use client';
import { type ShieldLog } from '@/lib/data';
import { fmtTime } from '@/lib/cc-data';
import { T, PAGE_PAD, SECTION_LABEL, CARD_BG, CARD_BORDER } from './ui';

export default function ShieldPage({ logs }: { logs: ShieldLog[] }) {
  return (
    <div style={PAGE_PAD}>
      <div style={SECTION_LABEL}>Shield Status</div>
      <div
        style={{
          background: CARD_BG,
          border: '1px solid rgba(74,222,128,.25)',
          borderRadius: 14,
          padding: 16,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Sovereign Prompt Shield</span>
          <span
            style={{
              fontFamily: T,
              fontSize: 8,
              padding: '3px 8px',
              borderRadius: 8,
              background: 'rgba(74,222,128,.14)',
              color: '#4ade80',
              border: '1px solid rgba(74,222,128,.2)',
              letterSpacing: '.1em',
              textTransform: 'uppercase',
            }}
          >
            Active
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#7a9bbf', lineHeight: 1.65 }}>
          Before an AI query reaches the external model, the server redacts common identifier
          patterns — Social Security numbers, phone numbers, dates of birth, medical record numbers,
          and dates. This reduces exposure but is not full de-identification: names and clinical
          details may remain. A risk score and action are returned alongside each response.
        </div>
      </div>

      <div style={{ ...SECTION_LABEL, margin: '20px 0 10px' }}>This Session&apos;s Activity</div>
      {logs.length === 0 ? (
        <div
          style={{
            background: CARD_BG,
            border: CARD_BORDER,
            borderRadius: 14,
            padding: 24,
            textAlign: 'center',
            fontSize: 12,
            color: '#7a9bbf',
          }}
        >
          No queries yet. Use the AI tab to see identifier redaction in real time.
        </div>
      ) : (
        logs.map((log, i) => (
          <div
            key={i}
            style={{
              background: CARD_BG,
              border: CARD_BORDER,
              borderRadius: 12,
              padding: 12,
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontFamily: T, fontSize: 9, color: '#7a9bbf' }}>{fmtTime(log.ts)}</span>
              <span
                style={{
                  fontFamily: T,
                  fontSize: 8,
                  padding: '2px 7px',
                  borderRadius: 6,
                  background:
                    log.risk === 'CRITICAL' || log.risk === 'HIGH'
                      ? 'rgba(232,82,110,.12)'
                      : log.risk === 'MEDIUM'
                      ? 'rgba(212,168,67,.12)'
                      : 'rgba(74,222,128,.12)',
                  color:
                    log.risk === 'CRITICAL' || log.risk === 'HIGH'
                      ? '#e8526e'
                      : log.risk === 'MEDIUM'
                      ? '#d4a843'
                      : '#4ade80',
                  border: '1px solid rgba(255,255,255,.08)',
                }}
              >
                {log.risk}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#7a9bbf' }}>
              {log.action} on query (first 50 chars hashed): {log.q}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
