'use client';
import { useEffect, useState } from 'react';
import {
  sbAuthed,
  fmtTime,
  type CCSession,
  type AlertRow,
} from '@/lib/cc-data';
import { T, PAGE_PAD, SECTION_LABEL, CARD_BG, CARD_BORDER } from './ui';

const HEALTH_OS_URL =
  process.env.NEXT_PUBLIC_HEALTH_OS_URL || 'https://sovereignhealthcareos.com';

// ---------------------------------------------------------------------------
// Shield decrypt response shape (longevity biomarker panel + legacy fields).
// ---------------------------------------------------------------------------
type Source = 'lab' | 'wearable' | 'self_reported';
type BiomarkerStatus = 'ok' | 'suboptimal' | 'outside_normal' | 'unknown';
type BiomarkerTrend = 'improving' | 'stable' | 'declining' | null;
type Sex = 'male' | 'female' | 'unknown';

interface BiomarkerResponse {
  value: number | null;
  unit: string;
  precision: number;
  date_collected: string | null;
  source: Source | null;
  normal_low: number | null;
  normal_high: number | null;
  optimal_low: number | null;
  optimal_high: number | null;
  bar_min: number;
  bar_max: number;
  status: BiomarkerStatus;
  trend: BiomarkerTrend;
}

type CategoryKey =
  | 'metabolic'
  | 'cardiovascular'
  | 'organ'
  | 'blood'
  | 'hormonal'
  | 'longevity'
  | 'cognitive';

type CategoryGroup = Record<string, BiomarkerResponse>;
type BiomarkerPanel = Record<CategoryKey, CategoryGroup>;

interface ShieldPayload {
  patient_id: string;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  hr: number | null;
  steps: number | null;
  spo2: number | null;
  sleep_hours: number | null;
  hrv: number | null;
  active_calories: number | null;
  calories: number | null;
  risk_score: number;
  risk_label: string;
  panel_grade: string;
  panel_flagged: number;
  panel_in_range: number;
  updated_at: string | null;
  decrypted_at: string;
  shield_version: string;
  biomarkers: BiomarkerPanel;
  sex: Sex;
}

const OK = '#7BC8A0';
const WARN = '#C07941';
const ALERT = '#E05C3A';
const PURPLE = '#8060cc';
const GREEN = '#4ade80';
const MUTED = '#A8B8C8';

function statusColor(s: BiomarkerStatus): string {
  if (s === 'ok') return OK;
  if (s === 'suboptimal') return WARN;
  if (s === 'outside_normal') return ALERT;
  return MUTED;
}

function statusLabel(s: BiomarkerStatus): string {
  if (s === 'ok') return 'Optimal';
  if (s === 'suboptimal') return 'Suboptimal';
  if (s === 'outside_normal') return 'Outside normal';
  return 'Not yet entered';
}

function trendColor(t: BiomarkerTrend): string {
  if (t === 'improving') return GREEN;
  if (t === 'stable') return MUTED;
  if (t === 'declining') return ALERT;
  return MUTED;
}

function trendArrow(t: BiomarkerTrend): string {
  if (t === 'improving') return '↑';
  if (t === 'stable') return '→';
  if (t === 'declining') return '↓';
  return '';
}

function trendLabel(t: BiomarkerTrend): string {
  if (t === 'improving') return 'Improving';
  if (t === 'stable') return 'Stable';
  if (t === 'declining') return 'Declining';
  return '';
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

function gradeColor(grade: string): string {
  if (grade === 'A') return OK;
  if (grade === 'B') return GREEN;
  if (grade === 'C') return WARN;
  if (grade === 'D' || grade === 'F') return ALERT;
  return MUTED;
}

function riskColor(score: number): string {
  if (score >= 75) return GREEN;
  if (score >= 55) return WARN;
  return ALERT;
}

const CATEGORY_TITLES: Record<CategoryKey, string> = {
  metabolic: 'Metabolic',
  cardiovascular: 'Cardiovascular',
  organ: 'Organ Function',
  blood: 'Blood',
  hormonal: 'Hormonal',
  longevity: 'Longevity',
  cognitive: 'Cognitive',
};

const CATEGORY_ORDER: CategoryKey[] = [
  'metabolic',
  'cardiovascular',
  'organ',
  'blood',
  'hormonal',
  'longevity',
  'cognitive',
];

const KEY_ORDER: Record<CategoryKey, string[]> = {
  metabolic: ['fasting_glucose', 'fasting_insulin', 'homa_ir', 'a1c', 'uric_acid'],
  cardiovascular: [
    'ldl', 'hdl', 'total_cholesterol', 'triglycerides',
    'apob', 'lpa', 'hs_crp', 'homocysteine', 'vldl',
  ],
  organ: ['egfr', 'creatinine', 'bun', 'alt', 'ast', 'albumin', 'bilirubin'],
  blood: ['wbc', 'rbc', 'hemoglobin', 'hematocrit', 'platelets', 'ferritin', 'vitamin_b12'],
  hormonal: [
    'testosterone_total', 'testosterone_free', 'dhea_s', 'cortisol_am',
    'igf1', 'tsh', 'vitamin_d', 'omega3_index',
  ],
  longevity: [
    'biological_age_estimate', 'grip_strength', 'vo2_max',
    'resting_hr', 'hrv', 'sleep_score', 'stress_score',
  ],
  cognitive: ['memory_score', 'processing_speed', 'executive_function'],
};

const LABELS: Record<string, string> = {
  fasting_glucose: 'Fasting Glucose',
  fasting_insulin: 'Fasting Insulin',
  homa_ir: 'HOMA-IR',
  a1c: 'A1C',
  uric_acid: 'Uric Acid',
  ldl: 'LDL Cholesterol',
  hdl: 'HDL Cholesterol',
  total_cholesterol: 'Total Cholesterol',
  triglycerides: 'Triglycerides',
  apob: 'ApoB',
  lpa: 'Lp(a)',
  hs_crp: 'hs-CRP',
  homocysteine: 'Homocysteine',
  vldl: 'VLDL',
  egfr: 'eGFR',
  creatinine: 'Creatinine',
  bun: 'BUN',
  alt: 'ALT',
  ast: 'AST',
  albumin: 'Albumin',
  bilirubin: 'Bilirubin',
  wbc: 'WBC',
  rbc: 'RBC',
  hemoglobin: 'Hemoglobin',
  hematocrit: 'Hematocrit',
  platelets: 'Platelets',
  ferritin: 'Ferritin',
  vitamin_b12: 'Vitamin B12',
  testosterone_total: 'Testosterone (Total)',
  testosterone_free: 'Testosterone (Free)',
  dhea_s: 'DHEA-S',
  cortisol_am: 'Cortisol (AM)',
  igf1: 'IGF-1',
  tsh: 'TSH',
  vitamin_d: 'Vitamin D',
  omega3_index: 'Omega-3 Index',
  biological_age_estimate: 'Biological Age',
  grip_strength: 'Grip Strength',
  vo2_max: 'VO2 Max',
  resting_hr: 'Resting HR',
  hrv: 'HRV',
  sleep_score: 'Sleep Score',
  stress_score: 'Stress Score',
  memory_score: 'Memory',
  processing_speed: 'Processing Speed',
  executive_function: 'Executive Function',
};

function formatValue(v: number | null, precision: number): string {
  if (v === null) return 'Not yet entered';
  if (precision === 0) return String(Math.round(v));
  return v.toFixed(precision);
}

function zoneColorAt(
  mid: number,
  th: { normal_low: number | null; normal_high: number | null; optimal_low: number | null; optimal_high: number | null },
): 'red' | 'yellow' | 'green' | 'gray' {
  if (
    th.normal_low === null && th.normal_high === null &&
    th.optimal_low === null && th.optimal_high === null
  ) {
    return 'gray';
  }
  const outNormal =
    (th.normal_low !== null && mid < th.normal_low) ||
    (th.normal_high !== null && mid > th.normal_high);
  if (outNormal) return 'red';

  const hasOpt = th.optimal_low !== null || th.optimal_high !== null;
  if (!hasOpt) return 'green';

  const lowOk = th.optimal_low === null || mid >= th.optimal_low;
  const highOk = th.optimal_high === null || mid <= th.optimal_high;
  if (lowOk && highOk) return 'green';
  return 'yellow';
}

function zoneCss(c: 'red' | 'yellow' | 'green' | 'gray'): string {
  if (c === 'red') return 'rgba(232,82,110,.32)';
  if (c === 'yellow') return 'rgba(192,121,65,.32)';
  if (c === 'green') return 'rgba(123,200,160,.32)';
  return 'rgba(255,255,255,.06)';
}

interface BarSegment {
  fromPct: number;
  toPct: number;
  color: 'red' | 'yellow' | 'green' | 'gray';
}

function computeBarSegments(b: BiomarkerResponse): BarSegment[] {
  const min = b.bar_min;
  const max = b.bar_max;
  if (max <= min) return [];
  const raw = new Set<number>([min, max]);
  for (const v of [b.normal_low, b.normal_high, b.optimal_low, b.optimal_high]) {
    if (v !== null && v > min && v < max) raw.add(v);
  }
  const sorted = Array.from(raw).sort((x, y) => x - y);
  const pct = (n: number) => ((n - min) / (max - min)) * 100;
  const segments: BarSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const from = sorted[i];
    const to = sorted[i + 1];
    const mid = (from + to) / 2;
    const color = zoneColorAt(mid, b);
    segments.push({ fromPct: pct(from), toPct: pct(to), color });
  }
  const merged: BarSegment[] = [];
  for (const seg of segments) {
    const last = merged[merged.length - 1];
    if (last && last.color === seg.color && Math.abs(last.toPct - seg.fromPct) < 0.01) {
      last.toPct = seg.toPct;
    } else {
      merged.push({ ...seg });
    }
  }
  return merged;
}

function markerPct(b: BiomarkerResponse): number | null {
  if (b.value === null) return null;
  const min = b.bar_min;
  const max = b.bar_max;
  if (max <= min) return null;
  const clamped = Math.max(min, Math.min(max, b.value));
  return ((clamped - min) / (max - min)) * 100;
}

function rangeSummary(b: BiomarkerResponse): string {
  const ol = b.optimal_low;
  const oh = b.optimal_high;
  const nl = b.normal_low;
  const nh = b.normal_high;
  const fmt = (n: number | null) => (n === null ? null : (b.precision === 0 ? String(Math.round(n)) : n.toFixed(b.precision)));
  const optParts: string[] = [];
  if (ol !== null && oh !== null) optParts.push(`${fmt(ol)} to ${fmt(oh)}`);
  else if (ol !== null) optParts.push(`above ${fmt(ol)}`);
  else if (oh !== null) optParts.push(`below ${fmt(oh)}`);
  const normParts: string[] = [];
  if (nl !== null && nh !== null) normParts.push(`${fmt(nl)} to ${fmt(nh)}`);
  else if (nl !== null) normParts.push(`above ${fmt(nl)}`);
  else if (nh !== null) normParts.push(`below ${fmt(nh)}`);
  const optStr = optParts.length > 0 ? `Optimal: ${optParts[0]} ${b.unit}` : '';
  const normStr = normParts.length > 0 ? `Normal: ${normParts[0]} ${b.unit}` : '';
  return [optStr, normStr].filter(Boolean).join(' · ');
}

function ShieldBadge({ decryptedAt }: { decryptedAt: string }) {
  const hhmm = shieldTime(decryptedAt);
  return (
    <div
      title={`Decrypted ${new Date(decryptedAt).toLocaleString()}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: T,
        fontSize: 7.5,
        padding: '2px 5px',
        borderRadius: 5,
        background: 'rgba(123,200,160,.12)',
        color: OK,
        border: '1px solid rgba(123,200,160,.28)',
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      Shield {hhmm}
    </div>
  );
}

function TrendPill({ trend }: { trend: BiomarkerTrend }) {
  if (trend === null) return null;
  const c = trendColor(trend);
  return (
    <span
      title={`Trend vs previous reading: ${trendLabel(trend).toLowerCase()}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontFamily: T,
        fontSize: 8,
        padding: '2px 7px',
        borderRadius: 6,
        background: `${c}1f`,
        color: c,
        border: `1px solid ${c}55`,
        textTransform: 'uppercase',
        letterSpacing: '.1em',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden style={{ fontSize: 10, lineHeight: 1 }}>
        {trendArrow(trend)}
      </span>
      {trendLabel(trend)}
    </span>
  );
}

function RangeBar({ b }: { b: BiomarkerResponse }) {
  const segments = computeBarSegments(b);
  const m = markerPct(b);
  return (
    <div
      style={{
        position: 'relative',
        height: 6,
        borderRadius: 3,
        overflow: 'visible',
        background: 'rgba(255,255,255,.04)',
      }}
      aria-hidden
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 3,
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        {segments.map((s, i) => (
          <div
            key={i}
            style={{
              width: `${s.toPct - s.fromPct}%`,
              background: zoneCss(s.color),
            }}
          />
        ))}
      </div>
      {m !== null && (
        <div
          style={{
            position: 'absolute',
            left: `${m}%`,
            top: -3,
            bottom: -3,
            width: 2,
            background: '#F4EDE1',
            borderRadius: 1,
            transform: 'translateX(-1px)',
            boxShadow: '0 0 6px rgba(238,242,248,.6)',
          }}
        />
      )}
    </div>
  );
}

function StatusPill({ status }: { status: BiomarkerStatus }) {
  const c = statusColor(status);
  const label = statusLabel(status);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: T,
        fontSize: 8,
        padding: '2px 7px',
        borderRadius: 6,
        background: `${c}1f`,
        color: c,
        border: `1px solid ${c}55`,
        textTransform: 'uppercase',
        letterSpacing: '.1em',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function BiomarkerRow({
  bkey,
  b,
  decryptedAt,
}: {
  bkey: string;
  b: BiomarkerResponse;
  decryptedAt: string;
}) {
  const label = LABELS[bkey] || bkey;
  const valStr = formatValue(b.value, b.precision);
  const valColor = b.value === null ? MUTED : statusColor(b.status);
  const summary = rangeSummary(b);
  return (
    <div
      style={{
        background: CARD_BG,
        border: CARD_BORDER,
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            fontFamily: T,
            fontSize: 9,
            color: MUTED,
            textTransform: 'uppercase',
            letterSpacing: '.14em',
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: T,
            fontSize: 16,
            fontWeight: 600,
            color: valColor,
            whiteSpace: 'nowrap',
          }}
        >
          {b.value === null ? (
            <span style={{ fontSize: 11, fontWeight: 400, color: MUTED }}>Not yet entered</span>
          ) : (
            <>
              {valStr}
              {b.unit && (
                <span style={{ fontSize: 10, fontWeight: 400, color: MUTED, marginLeft: 4 }}>
                  {b.unit}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <RangeBar b={b} />
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          marginTop: 8,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontFamily: T,
            fontSize: 9,
            color: MUTED,
            lineHeight: 1.4,
            flex: 1,
            minWidth: 0,
          }}
        >
          {summary || ' '}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          <TrendPill trend={b.trend} />
          <StatusPill status={b.status} />
          <ShieldBadge decryptedAt={decryptedAt} />
        </div>
      </div>
    </div>
  );
}

function CategorySection({
  category,
  group,
  decryptedAt,
}: {
  category: CategoryKey;
  group: CategoryGroup;
  decryptedAt: string;
}) {
  const order = KEY_ORDER[category];
  const rendered = new Set<string>();
  const rows: { key: string; b: BiomarkerResponse }[] = [];
  for (const k of order) {
    if (group[k]) {
      rows.push({ key: k, b: group[k] });
      rendered.add(k);
    }
  }
  for (const k of Object.keys(group).sort()) {
    if (!rendered.has(k)) rows.push({ key: k, b: group[k] });
  }
  if (rows.length === 0) return null;
  return (
    <>
      <div style={{ ...SECTION_LABEL, margin: '20px 0 10px' }}>
        {CATEGORY_TITLES[category]}
      </div>
      {rows.map(({ key, b }) => (
        <BiomarkerRow key={key} bkey={key} b={b} decryptedAt={decryptedAt} />
      ))}
    </>
  );
}

const RING_R = 37;
const RING_C = 2 * Math.PI * RING_R;

function RiskRing({ score, loaded }: { score: number; loaded: boolean }) {
  const offset = RING_C * (1 - score / 100);
  const stroke = riskColor(score);
  return (
    <div style={{ position: 'relative', width: 92, height: 92, flexShrink: 0 }}>
      <svg width="92" height="92" viewBox="0 0 92 92" style={{ transform: 'rotate(-90deg)' }}>
        <defs>
          <linearGradient id="cc-rg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={OK} />
            <stop offset="100%" stopColor={PURPLE} />
          </linearGradient>
        </defs>
        <circle cx="46" cy="46" r={RING_R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
        <circle
          cx="46"
          cy="46"
          r={RING_R}
          fill="none"
          stroke="url(#cc-rg)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${RING_C}`}
          strokeDashoffset={loaded ? offset : RING_C}
          style={{ transition: 'stroke-dashoffset 1.6s cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontFamily: T,
            fontSize: 24,
            fontWeight: 600,
            color: stroke,
            lineHeight: 1,
          }}
        >
          {loaded ? score : ''}
        </div>
        <div
          style={{
            fontSize: 7,
            color: MUTED,
            textTransform: 'uppercase',
            letterSpacing: '.18em',
            marginTop: 3,
          }}
        >
          Score
        </div>
      </div>
    </div>
  );
}

export default function CareIQPage({ session }: { session: CCSession }) {
  const [payload, setPayload] = useState<ShieldPayload | null>(null);
  const [vitalsErr, setVitalsErr] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null);
  const [alertsErr, setAlertsErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/healthos/decrypt', {
          headers: { Authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        });
        const data = (await r.json().catch(() => ({}))) as Partial<ShieldPayload> & {
          error?: string;
        };
        if (!r.ok) {
          if (!cancelled) setVitalsErr(data.error || `vitals ${r.status}`);
          return;
        }
        if (!cancelled) setPayload(data as ShieldPayload);
      } catch (e) {
        if (!cancelled) setVitalsErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.access_token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await sbAuthed(
          session.access_token,
          `care_circle_alerts?patient_id=eq.${session.patient_id}&order=fired_at.desc&limit=100&select=*`,
        );
        if (!r.ok) throw new Error(`alerts ${r.status}`);
        const data = (await r.json()) as AlertRow[];
        if (!cancelled) setAlerts(data);
      } catch (e) {
        if (!cancelled) setAlertsErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.access_token, session.patient_id]);

  const loaded = payload !== null;
  const score = payload?.risk_score ?? 0;
  const decryptedAt = payload?.decrypted_at ?? new Date().toISOString();
  const sex = payload?.sex ?? 'unknown';
  const showBpChip = payload && (payload.bp_systolic !== null || payload.bp_diastolic !== null);

  return (
    <div style={PAGE_PAD}>
      <div
        style={{
          background:
            'linear-gradient(135deg, rgba(123,200,160,.10), rgba(128,96,204,.06))',
          border: '1px solid rgba(123,200,160,.2)',
          borderRadius: 16,
          padding: 16,
          marginBottom: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <RiskRing score={score} loaded={loaded} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: "'Playfair Display',serif",
              fontSize: 18,
              color: '#F4EDE1',
              marginBottom: 4,
            }}
          >
            {loaded ? payload!.risk_label : 'Loading vitals...'}
          </div>
          <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.5, marginBottom: 6 }}>
            {vitalsErr
              ? `Vitals not available: ${vitalsErr}`
              : payload?.updated_at
              ? `Last updated ${fmtTime(payload.updated_at)}`
              : 'No labs entered yet'}
          </div>
          {loaded && <ShieldBadge decryptedAt={decryptedAt} />}
        </div>
      </div>

      {loaded && (payload!.panel_in_range > 0 || payload!.panel_flagged > 0) && (
        <div
          style={{
            background: CARD_BG,
            border: CARD_BORDER,
            borderRadius: 14,
            padding: 14,
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              flexShrink: 0,
              width: 56,
              height: 56,
              borderRadius: 14,
              background: `${gradeColor(payload!.panel_grade)}20`,
              border: `1px solid ${gradeColor(payload!.panel_grade)}55`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: T,
              fontSize: 26,
              fontWeight: 700,
              color: gradeColor(payload!.panel_grade),
            }}
          >
            {payload!.panel_grade}
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontFamily: T,
                fontSize: 9,
                color: MUTED,
                textTransform: 'uppercase',
                letterSpacing: '.14em',
                marginBottom: 4,
              }}
            >
              Longevity panel grade
            </div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <div>
                <span style={{ fontFamily: T, fontSize: 17, fontWeight: 600, color: ALERT }}>
                  {payload!.panel_flagged}
                </span>{' '}
                <span style={{ fontSize: 10, color: MUTED }}>flagged</span>
              </div>
              <div>
                <span style={{ fontFamily: T, fontSize: 17, fontWeight: 600, color: OK }}>
                  {payload!.panel_in_range}
                </span>{' '}
                <span style={{ fontSize: 10, color: MUTED }}>in optimal</span>
              </div>
              {sex !== 'unknown' && (
                <div>
                  <span style={{ fontFamily: T, fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: '.1em' }}>
                    Sex: {sex}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showBpChip && (
        <>
          <div style={SECTION_LABEL}>Blood Pressure</div>
          <div
            style={{
              flexShrink: 0,
              background: CARD_BG,
              border: `1px solid ${OK}30`,
              borderRadius: 12,
              padding: '11px 13px',
              marginBottom: 16,
              maxWidth: 200,
            }}
          >
            <div
              style={{
                fontFamily: T,
                fontSize: 9,
                color: MUTED,
                textTransform: 'uppercase',
                letterSpacing: '.12em',
                marginBottom: 4,
              }}
            >
              BP
            </div>
            <div style={{ fontFamily: T, fontSize: 17, fontWeight: 600, color: '#F4EDE1' }}>
              {payload!.bp_systolic !== null && payload!.bp_diastolic !== null
                ? `${payload!.bp_systolic}/${payload!.bp_diastolic}`
                : 'Not yet entered'}
            </div>
            <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>mmHg</div>
            <div style={{ marginTop: 6 }}>
              <ShieldBadge decryptedAt={decryptedAt} />
            </div>
          </div>
        </>
      )}

      {loaded &&
        CATEGORY_ORDER.map((cat) => (
          <CategorySection
            key={cat}
            category={cat}
            group={payload!.biomarkers[cat] || {}}
            decryptedAt={decryptedAt}
          />
        ))}

      {!loaded && !vitalsErr && (
        <div
          style={{
            background: CARD_BG,
            border: CARD_BORDER,
            borderRadius: 14,
            padding: 18,
            marginTop: 8,
            marginBottom: 16,
            fontSize: 11,
            color: MUTED,
            textAlign: 'center',
            lineHeight: 1.6,
          }}
        >
          Loading biomarker panel from the Chikasha Health OS Shield...
        </div>
      )}

      <div style={{ ...SECTION_LABEL, margin: '20px 0 10px' }}>Clinical alerts</div>
      {alertsErr && (
        <div
          style={{
            background: 'rgba(232,82,110,.08)',
            border: '1px solid rgba(232,82,110,.25)',
            borderRadius: 12,
            padding: '10px 14px',
            fontSize: 11,
            color: ALERT,
            marginBottom: 12,
          }}
        >
          Could not load alerts: {alertsErr}
        </div>
      )}
      {alerts === null && !alertsErr && (
        <div style={{ fontSize: 11, color: MUTED, textAlign: 'center', padding: 18 }}>
          Loading alerts...
        </div>
      )}
      {alerts !== null && alerts.length === 0 && (
        <div
          style={{
            background: CARD_BG,
            border: CARD_BORDER,
            borderRadius: 12,
            padding: 18,
            textAlign: 'center',
            fontSize: 12,
            color: GREEN,
          }}
        >
          No clinical alerts on file. All monitored thresholds are within range.
        </div>
      )}
      {alerts &&
        alerts.map((a) => (
          <div
            key={a.id}
            style={{
              background:
                a.severity === 'critical'
                  ? 'rgba(232,82,110,.06)'
                  : 'rgba(192,121,65,.06)',
              borderLeft: `3px solid ${a.severity === 'critical' ? ALERT : WARN}`,
              border: CARD_BORDER,
              borderRadius: 12,
              padding: 12,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: '#F4EDE1' }}>{a.metric}</span>
              <span
                style={{
                  fontFamily: T,
                  fontSize: 8,
                  padding: '2px 8px',
                  borderRadius: 8,
                  background:
                    a.severity === 'critical' ? 'rgba(232,82,110,.15)' : 'rgba(192,121,65,.15)',
                  color: a.severity === 'critical' ? ALERT : WARN,
                  border: `1px solid ${
                    a.severity === 'critical' ? 'rgba(232,82,110,.3)' : 'rgba(192,121,65,.3)'
                  }`,
                  textTransform: 'uppercase',
                  letterSpacing: '.1em',
                }}
              >
                {a.severity}
              </span>
            </div>
            <div style={{ fontFamily: T, fontSize: 9, color: MUTED, marginBottom: 4 }}>
              {fmtTime(a.fired_at)} · sent to {a.delivery_count} member{a.delivery_count === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: 11, color: '#F4EDE1', lineHeight: 1.6 }}>{a.recommendation}</div>
          </div>
        ))}
    </div>
  );
}
