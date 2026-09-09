'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { loadSession, ensureValidSession, type CCSession } from '@/lib/cc-data';
import { T, O, PAGE_PAD, SECTION_LABEL, CARD_BG, CARD_BORDER } from './ui';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface Medication {
  id: string;
  patient_id: string;
  name: string;
  dose: string | null;
  frequency: string | null;
  time_of_day: string | null;
  prescribing_doctor: string | null;
  start_date: string | null;
  active: boolean;
  created_at: string;
}

interface MedicationLog {
  id: string;
  medication_id: string;
  taken_on: string;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

async function sb(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });
}

export default function MedsPage() {
  const router = useRouter();
  const [session, setSession] = useState<CCSession | null>(loadSession);
  const [meds, setMeds] = useState<Medication[]>([]);
  const [logs, setLogs] = useState<MedicationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [freq, setFreq] = useState('');
  const [timeOfDay, setTimeOfDay] = useState('');
  const [doctor, setDoctor] = useState('');
  const [startDate, setStartDate] = useState('');

  const refresh = useCallback(async () => {
    const s = loadSession();
    if (!s) { router.push('/login'); return; }
    const valid = await ensureValidSession(s);
    if (!valid) { router.push('/login'); return; }
    setSession(valid);
    setError(null);
    try {
      const today = todayIso();
      const [medsRes, logsRes] = await Promise.all([
        sb(valid.access_token,
          `medications?patient_id=eq.${valid.patient_id}&active=eq.true&order=created_at.desc&select=*`),
        sb(valid.access_token,
          `medication_logs?patient_id=eq.${valid.patient_id}&taken_on=eq.${today}&select=id,medication_id,taken_on`),
      ]);
      if (!medsRes.ok) throw new Error(`meds ${medsRes.status}`);
      if (!logsRes.ok) throw new Error(`logs ${logsRes.status}`);
      setMeds((await medsRes.json()) as Medication[]);
      setLogs((await logsRes.json()) as MedicationLog[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { refresh(); }, [refresh]);

  const submitAdd = async () => {
    if (submitting || !session) return;
    if (!name.trim()) { setError('Medication name is required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const valid = await ensureValidSession(session);
      if (!valid) { router.push('/login'); return; }
      const res = await sb(valid.access_token, 'medications', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          patient_id: valid.patient_id,
          name: name.trim(),
          dose: dose.trim() || null,
          frequency: freq.trim() || null,
          time_of_day: timeOfDay.trim() || null,
          prescribing_doctor: doctor.trim() || null,
          start_date: startDate || null,
          created_by: valid.user_id,
        }),
      });
      if (!res.ok) throw new Error(`insert ${res.status}: ${(await res.text()).slice(0, 200)}`);
      setName(''); setDose(''); setFreq(''); setTimeOfDay(''); setDoctor(''); setStartDate('');
      setShowAdd(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleTaken = async (med: Medication) => {
    if (!session) return;
    const valid = await ensureValidSession(session);
    if (!valid) { router.push('/login'); return; }
    const today = todayIso();
    const existing = logs.find(l => l.medication_id === med.id);
    if (existing) {
      const res = await sb(valid.access_token, `medication_logs?id=eq.${existing.id}`, { method: 'DELETE' });
      if (!res.ok) { setError(`untoggle ${res.status}`); return; }
      setLogs(p => p.filter(l => l.id !== existing.id));
    } else {
      const res = await sb(valid.access_token, 'medication_logs', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          medication_id: med.id,
          patient_id: med.patient_id,
          taken_on: today,
          taken_by: valid.user_id,
        }),
      });
      if (!res.ok) { setError(`toggle ${res.status}`); return; }
      const inserted = ((await res.json()) as MedicationLog[])[0];
      setLogs(p => [...p, inserted]);
    }
  };

  const archive = async (medId: string) => {
    if (!session) return;
    if (!confirm('Archive this medication? It will be hidden from the active list.')) return;
    const valid = await ensureValidSession(session);
    if (!valid) return;
    const res = await sb(valid.access_token, `medications?id=eq.${medId}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: false }),
    });
    if (!res.ok) { setError(`archive ${res.status}`); return; }
    setMeds(p => p.filter(m => m.id !== medId));
  };

  if (loading) {
    return (
      <div style={PAGE_PAD}>
        <div style={{ fontSize: 12, color: '#7a9bbf', textAlign: 'center', padding: 32 }}>
          Loading medications...
        </div>
      </div>
    );
  }

  return (
    <div style={PAGE_PAD}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ ...SECTION_LABEL, marginBottom: 0 }}>Medications</div>
        <button
          onClick={() => setShowAdd(s => !s)}
          aria-label={showAdd ? 'Close add medication' : 'Add medication'}
          style={{
            width: 30, height: 30, borderRadius: '50%',
            border: '1px solid rgba(0,212,184,.4)',
            background: showAdd ? 'rgba(0,212,184,.18)' : 'rgba(0,212,184,.08)',
            color: '#00d4b8', fontSize: 18, lineHeight: '24px',
            cursor: 'pointer', fontFamily: O,
          }}
        >{showAdd ? '×' : '+'}</button>
      </div>

      {error && (
        <div style={{
          background: 'rgba(232,82,110,.1)', border: '1px solid rgba(232,82,110,.3)',
          borderRadius: 12, padding: 12, fontSize: 11, color: '#e8526e', marginBottom: 12,
        }}>{error}</div>
      )}

      {showAdd && (
        <div style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <FormInput label="Medication name *" value={name} onChange={setName} placeholder="Lisinopril" />
          <FormInput label="Dose" value={dose} onChange={setDose} placeholder="10 mg" />
          <FormInput label="Frequency" value={freq} onChange={setFreq} placeholder="Once daily" />
          <FormInput label="Time of day" value={timeOfDay} onChange={setTimeOfDay} placeholder="Morning" />
          <FormInput label="Prescribing doctor" value={doctor} onChange={setDoctor} placeholder="Dr. Patel" />
          <FormInput label="Start date" value={startDate} onChange={setStartDate} type="date" />
          <button
            onClick={submitAdd}
            disabled={submitting}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg,#00d4b8,#00b89e)', color: '#07101f',
              fontSize: 12, fontWeight: 700, fontFamily: O,
              cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1, marginTop: 6,
            }}
          >{submitting ? 'Adding...' : 'Add medication'}</button>
        </div>
      )}

      {meds.length === 0 ? (
        <div style={{
          background: CARD_BG, border: CARD_BORDER, borderRadius: 12,
          padding: 16, fontSize: 11, color: '#7a9bbf', textAlign: 'center',
        }}>No medications on file. Tap + to add one.</div>
      ) : (
        meds.map(m => {
          const taken = logs.some(l => l.medication_id === m.id);
          return (
            <div key={m.id} style={{
              background: CARD_BG, border: CARD_BORDER, borderRadius: 12,
              padding: 12, marginBottom: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <button
                  onClick={() => toggleTaken(m)}
                  aria-label={taken ? 'Mark as not taken' : 'Mark as taken today'}
                  style={{
                    width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                    border: `1px solid ${taken ? '#00d4b8' : 'rgba(0,212,184,.3)'}`,
                    background: taken ? '#00d4b8' : 'transparent',
                    color: '#07101f', fontSize: 14, lineHeight: '22px',
                    cursor: 'pointer', marginTop: 2,
                  }}
                >{taken ? '✓' : ''}</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#eef2f8', marginBottom: 2 }}>{m.name}</div>
                  {(m.dose || m.frequency) && (
                    <div style={{ fontSize: 11, color: '#a3b5cc' }}>
                      {m.dose ? m.dose : ''}{m.dose && m.frequency ? ' · ' : ''}{m.frequency || ''}
                    </div>
                  )}
                  {m.time_of_day && <div style={{ fontSize: 10, color: '#7a9bbf', marginTop: 2 }}>Time: {m.time_of_day}</div>}
                  {m.prescribing_doctor && <div style={{ fontSize: 10, color: '#7a9bbf', marginTop: 1 }}>Rx: {m.prescribing_doctor}</div>}
                  {m.start_date && <div style={{ fontFamily: T, fontSize: 9, color: '#7a9bbf', marginTop: 3 }}>Started {m.start_date}</div>}
                  {taken && <div style={{ fontFamily: T, fontSize: 9, color: '#4ade80', marginTop: 3 }}>Taken today</div>}
                </div>
                <button
                  onClick={() => archive(m.id)}
                  aria-label="Archive medication"
                  title="Archive"
                  style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: '#7a9bbf', fontSize: 18, padding: 4, alignSelf: 'flex-start',
                  }}
                >×</button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function FormInput({ label, value, onChange, placeholder, type = 'text' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        display: 'block', fontSize: 9, color: '#7a9bbf',
        textTransform: 'uppercase', letterSpacing: '.14em',
        marginBottom: 4, fontFamily: T,
      }}>{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '9px 11px', fontSize: 12,
          background: 'rgba(255,255,255,.05)',
          border: '1px solid rgba(0,212,184,.14)', borderRadius: 8,
          color: '#eef2f8', outline: 'none', fontFamily: O, boxSizing: 'border-box',
        }}
      />
    </div>
  );
}
