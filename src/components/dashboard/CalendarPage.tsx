'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { loadSession, ensureValidSession, type CCSession } from '@/lib/cc-data';
import { T, O, PAGE_PAD, SECTION_LABEL, CARD_BG, CARD_BORDER } from './ui';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface Appointment {
  id: string;
  patient_id: string;
  title: string;
  provider_name: string | null;
  location: string | null;
  appt_date: string;
  appt_time: string | null;
  notes: string | null;
  created_at: string;
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

function fmtDateLong(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch { return iso; }
}
function fmtTime(t: string | null): string {
  if (!t) return '';
  const [hh, mm] = t.split(':');
  const h = Number(hh);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm} ${ampm}`;
}

export default function CalendarPage() {
  const router = useRouter();
  const [session, setSession] = useState<CCSession | null>(loadSession);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [title, setTitle] = useState('');
  const [provider, setProvider] = useState('');
  const [location, setLocation] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [notes, setNotes] = useState('');

  const refresh = useCallback(async () => {
    const s = loadSession();
    if (!s) { router.push('/login'); return; }
    const valid = await ensureValidSession(s);
    if (!valid) { router.push('/login'); return; }
    setSession(valid);
    setError(null);
    try {
      const today = todayIso();
      const res = await sb(valid.access_token,
        `appointments?patient_id=eq.${valid.patient_id}&appt_date=gte.${today}&order=appt_date.asc,appt_time.asc&select=*`);
      if (!res.ok) throw new Error(`appointments ${res.status}`);
      setAppts((await res.json()) as Appointment[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { refresh(); }, [refresh]);

  const submitAdd = async () => {
    if (submitting || !session) return;
    if (!title.trim()) { setError('Appointment title is required.'); return; }
    if (!date) { setError('Appointment date is required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const valid = await ensureValidSession(session);
      if (!valid) { router.push('/login'); return; }
      const res = await sb(valid.access_token, 'appointments', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          patient_id: valid.patient_id,
          title: title.trim(),
          provider_name: provider.trim() || null,
          location: location.trim() || null,
          appt_date: date,
          appt_time: time || null,
          notes: notes.trim() || null,
          created_by: valid.user_id,
        }),
      });
      if (!res.ok) throw new Error(`insert ${res.status}: ${(await res.text()).slice(0, 200)}`);
      setTitle(''); setProvider(''); setLocation(''); setDate(''); setTime(''); setNotes('');
      setShowAdd(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (id: string) => {
    if (!session) return;
    if (!confirm('Delete this appointment?')) return;
    const valid = await ensureValidSession(session);
    if (!valid) return;
    const res = await sb(valid.access_token, `appointments?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) { setError(`delete ${res.status}`); return; }
    setAppts(p => p.filter(a => a.id !== id));
  };

  if (loading) {
    return (
      <div style={PAGE_PAD}>
        <div style={{ fontSize: 12, color: '#A8B8C8', textAlign: 'center', padding: 32 }}>
          Loading appointments...
        </div>
      </div>
    );
  }

  return (
    <div style={PAGE_PAD}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ ...SECTION_LABEL, marginBottom: 0 }}>Upcoming Appointments</div>
        <button
          onClick={() => setShowAdd(s => !s)}
          aria-label={showAdd ? 'Close add appointment' : 'Add appointment'}
          style={{
            width: 30, height: 30, borderRadius: '50%',
            border: '1px solid rgba(123,200,160,.4)',
            background: showAdd ? 'rgba(123,200,160,.18)' : 'rgba(123,200,160,.08)',
            color: '#7BC8A0', fontSize: 18, lineHeight: '24px',
            cursor: 'pointer', fontFamily: O,
          }}
        >{showAdd ? '×' : '+'}</button>
      </div>

      {error && (
        <div style={{
          background: 'rgba(232,82,110,.1)', border: '1px solid rgba(232,82,110,.3)',
          borderRadius: 12, padding: 12, fontSize: 11, color: '#E05C3A', marginBottom: 12,
        }}>{error}</div>
      )}

      {showAdd && (
        <div style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: 14, padding: 14, marginBottom: 14 }}>
          <FormInput label="Title *" value={title} onChange={setTitle} placeholder="Annual physical" />
          <FormInput label="Provider" value={provider} onChange={setProvider} placeholder="Dr. Mitchell" />
          <FormInput label="Location" value={location} onChange={setLocation} placeholder="Riverside Clinic" />
          <FormInput label="Date *" value={date} onChange={setDate} type="date" />
          <FormInput label="Time" value={time} onChange={setTime} type="time" />
          <FormTextarea label="Notes" value={notes} onChange={setNotes} placeholder="Bring BP log, fasting required" />
          <button
            onClick={submitAdd}
            disabled={submitting}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg,#7BC8A0,#3D8B5E)', color: '#0B1829',
              fontSize: 12, fontWeight: 700, fontFamily: O,
              cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1, marginTop: 6,
            }}
          >{submitting ? 'Adding...' : 'Add appointment'}</button>
        </div>
      )}

      {appts.length === 0 ? (
        <div style={{
          background: CARD_BG, border: CARD_BORDER, borderRadius: 12,
          padding: 16, fontSize: 11, color: '#A8B8C8', textAlign: 'center',
        }}>No upcoming appointments. Tap + to add one.</div>
      ) : (
        appts.map(a => (
          <div key={a.id} style={{
            background: CARD_BG, border: CARD_BORDER, borderRadius: 12,
            padding: 12, marginBottom: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: T, fontSize: 9, color: '#7BC8A0',
                  textTransform: 'uppercase', letterSpacing: '.12em', marginBottom: 4,
                }}>{fmtDateLong(a.appt_date)}{a.appt_time ? ` · ${fmtTime(a.appt_time)}` : ''}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#F4EDE1', marginBottom: 3 }}>{a.title}</div>
                {a.provider_name && (
                  <div style={{ fontSize: 11, color: '#a3b5cc' }}>{a.provider_name}</div>
                )}
                {a.location && (
                  <div style={{ fontSize: 10, color: '#A8B8C8', marginTop: 2 }}>{a.location}</div>
                )}
                {a.notes && (
                  <div style={{
                    fontSize: 11, color: '#a3b5cc', lineHeight: 1.5,
                    marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,.05)',
                  }}>{a.notes}</div>
                )}
              </div>
              <button
                onClick={() => remove(a.id)}
                aria-label="Delete appointment"
                title="Delete"
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: '#A8B8C8', fontSize: 18, padding: 4,
                }}
              >×</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function FormInput({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        display: 'block', fontSize: 9, color: '#A8B8C8',
        textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 4, fontFamily: T,
      }}>{label}</label>
      <input
        type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '9px 11px', fontSize: 12,
          background: 'rgba(255,255,255,.05)',
          border: '1px solid rgba(123,200,160,.14)', borderRadius: 8,
          color: '#F4EDE1', outline: 'none', fontFamily: O, boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function FormTextarea({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        display: 'block', fontSize: 9, color: '#A8B8C8',
        textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 4, fontFamily: T,
      }}>{label}</label>
      <textarea
        value={value} placeholder={placeholder} rows={3}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '9px 11px', fontSize: 12,
          background: 'rgba(255,255,255,.05)',
          border: '1px solid rgba(123,200,160,.14)', borderRadius: 8,
          color: '#F4EDE1', outline: 'none', fontFamily: O, boxSizing: 'border-box',
          resize: 'vertical',
        }}
      />
    </div>
  );
}
