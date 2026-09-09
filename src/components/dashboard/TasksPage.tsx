'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { loadSession, ensureValidSession, type CCSession } from '@/lib/cc-data';
import { T, O, PAGE_PAD, SECTION_LABEL, CARD_BG, CARD_BORDER, pc } from './ui';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface CareTask {
  id: string;
  patient_id: string;
  name: string;
  assigned_to: string | null;
  due_date: string | null;
  priority: 'high' | 'medium' | 'low';
  notes: string | null;
  completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
}

interface CircleMember {
  member_user_id: string;
  member_name: string;
  member_email: string;
}

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

export default function TasksPage() {
  const router = useRouter();
  const [session, setSession] = useState<CCSession | null>(loadSession);
  const [tasks, setTasks] = useState<CareTask[]>([]);
  const [members, setMembers] = useState<CircleMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [notes, setNotes] = useState('');

  const refresh = useCallback(async () => {
    const s = loadSession();
    if (!s) { router.push('/login'); return; }
    const valid = await ensureValidSession(s);
    if (!valid) { router.push('/login'); return; }
    setSession(valid);
    setError(null);
    try {
      const [tasksRes, membersRes] = await Promise.all([
        sb(valid.access_token,
          `care_tasks?patient_id=eq.${valid.patient_id}&order=completed.asc,due_date.asc.nullslast,created_at.desc&select=*`),
        sb(valid.access_token,
          `care_circle?patient_id=eq.${valid.patient_id}&select=member_user_id,member_name,member_email`),
      ]);
      if (!tasksRes.ok) throw new Error(`tasks ${tasksRes.status}`);
      if (!membersRes.ok) throw new Error(`members ${membersRes.status}`);
      setTasks((await tasksRes.json()) as CareTask[]);
      const m = ((await membersRes.json()) as Array<{ member_user_id: string | null; member_name: string; member_email: string }>)
        .filter(r => r.member_user_id)
        .map(r => ({ member_user_id: r.member_user_id as string, member_name: r.member_name, member_email: r.member_email }));
      setMembers(m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { refresh(); }, [refresh]);

  const submitAdd = async () => {
    if (submitting || !session) return;
    if (!name.trim()) { setError('Task name is required.'); return; }
    setSubmitting(true);
    setError(null);
    try {
      const valid = await ensureValidSession(session);
      if (!valid) { router.push('/login'); return; }
      const res = await sb(valid.access_token, 'care_tasks', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          patient_id: valid.patient_id,
          name: name.trim(),
          assigned_to: assignedTo || null,
          due_date: dueDate || null,
          priority,
          notes: notes.trim() || null,
          created_by: valid.user_id,
        }),
      });
      if (!res.ok) throw new Error(`insert ${res.status}: ${(await res.text()).slice(0, 200)}`);
      setName(''); setAssignedTo(''); setDueDate(''); setPriority('medium'); setNotes('');
      setShowAdd(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleComplete = async (task: CareTask) => {
    if (!session) return;
    const valid = await ensureValidSession(session);
    if (!valid) { router.push('/login'); return; }
    const next = !task.completed;
    const res = await sb(valid.access_token, `care_tasks?id=eq.${task.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        completed: next,
        completed_at: next ? new Date().toISOString() : null,
        completed_by: next ? valid.user_id : null,
      }),
    });
    if (!res.ok) { setError(`toggle ${res.status}`); return; }
    const updated = ((await res.json()) as CareTask[])[0];
    setTasks(p => p.map(t => t.id === task.id ? updated : t));
  };

  const remove = async (id: string) => {
    if (!session) return;
    if (!confirm('Delete this task?')) return;
    const valid = await ensureValidSession(session);
    if (!valid) return;
    const res = await sb(valid.access_token, `care_tasks?id=eq.${id}`, { method: 'DELETE' });
    if (!res.ok) { setError(`delete ${res.status}`); return; }
    setTasks(p => p.filter(t => t.id !== id));
  };

  const memberNameFor = (uid: string | null): string => {
    if (!uid) return '';
    const m = members.find(x => x.member_user_id === uid);
    return m ? m.member_name : '';
  };

  if (loading) {
    return (
      <div style={PAGE_PAD}>
        <div style={{ fontSize: 12, color: '#7a9bbf', textAlign: 'center', padding: 32 }}>
          Loading care tasks...
        </div>
      </div>
    );
  }

  return (
    <div style={PAGE_PAD}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ ...SECTION_LABEL, marginBottom: 0 }}>Care Tasks</div>
        <button
          onClick={() => setShowAdd(s => !s)}
          aria-label={showAdd ? 'Close add task' : 'Add task'}
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
          <FormInput label="Task name *" value={name} onChange={setName} placeholder="Refill metformin" />
          <FormSelect
            label="Assigned to"
            value={assignedTo}
            onChange={setAssignedTo}
            options={[{ value: '', label: 'Unassigned' }].concat(
              members.map(m => ({ value: m.member_user_id, label: m.member_name })),
            )}
          />
          <FormInput label="Due date" value={dueDate} onChange={setDueDate} type="date" />
          <FormSelect
            label="Priority"
            value={priority}
            onChange={(v) => setPriority(v as 'high' | 'medium' | 'low')}
            options={[
              { value: 'high', label: 'High' },
              { value: 'medium', label: 'Medium' },
              { value: 'low', label: 'Low' },
            ]}
          />
          <FormTextarea label="Notes" value={notes} onChange={setNotes} placeholder="Any extra context for the assignee" />
          <button
            onClick={submitAdd}
            disabled={submitting}
            style={{
              width: '100%', padding: '10px 0', borderRadius: 10, border: 'none',
              background: 'linear-gradient(135deg,#00d4b8,#00b89e)', color: '#07101f',
              fontSize: 12, fontWeight: 700, fontFamily: O,
              cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1, marginTop: 6,
            }}
          >{submitting ? 'Adding...' : 'Add task'}</button>
        </div>
      )}

      {tasks.length === 0 ? (
        <div style={{
          background: CARD_BG, border: CARD_BORDER, borderRadius: 12,
          padding: 16, fontSize: 11, color: '#7a9bbf', textAlign: 'center',
        }}>No care tasks yet. Tap + to add one.</div>
      ) : (
        tasks.map(t => {
          const pcolor = pc(t.priority);
          return (
            <div key={t.id} style={{
              background: CARD_BG, border: CARD_BORDER, borderRadius: 12,
              padding: 12, marginBottom: 8, opacity: t.completed ? 0.65 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <button
                  onClick={() => toggleComplete(t)}
                  aria-label={t.completed ? 'Mark incomplete' : 'Mark complete'}
                  style={{
                    width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                    border: `1px solid ${t.completed ? '#00d4b8' : 'rgba(0,212,184,.3)'}`,
                    background: t.completed ? '#00d4b8' : 'transparent',
                    color: '#07101f', fontSize: 14, lineHeight: '22px',
                    cursor: 'pointer', marginTop: 2,
                  }}
                >{t.completed ? '✓' : ''}</button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6,
                  }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: '#eef2f8',
                      textDecoration: t.completed ? 'line-through' : 'none',
                    }}>{t.name}</div>
                    <span style={{
                      flexShrink: 0,
                      fontFamily: T, fontSize: 8,
                      padding: '2px 6px', borderRadius: 5,
                      background: `${pcolor}1f`, color: pcolor,
                      border: `1px solid ${pcolor}55`,
                      textTransform: 'uppercase', letterSpacing: '.1em',
                    }}>{t.priority}</span>
                  </div>
                  {t.assigned_to && (
                    <div style={{ fontSize: 10, color: '#7a9bbf', marginTop: 3 }}>
                      For {memberNameFor(t.assigned_to) || 'circle member'}
                    </div>
                  )}
                  {t.due_date && (
                    <div style={{ fontFamily: T, fontSize: 9, color: '#7a9bbf', marginTop: 2 }}>
                      Due {t.due_date}
                    </div>
                  )}
                  {t.notes && (
                    <div style={{
                      fontSize: 11, color: '#a3b5cc', lineHeight: 1.5,
                      marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,.05)',
                    }}>{t.notes}</div>
                  )}
                </div>
                <button
                  onClick={() => remove(t.id)}
                  aria-label="Delete task"
                  title="Delete"
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
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        display: 'block', fontSize: 9, color: '#7a9bbf',
        textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 4, fontFamily: T,
      }}>{label}</label>
      <input
        type={type} value={value} placeholder={placeholder}
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

function FormTextarea({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        display: 'block', fontSize: 9, color: '#7a9bbf',
        textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 4, fontFamily: T,
      }}>{label}</label>
      <textarea
        value={value} placeholder={placeholder} rows={3}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '9px 11px', fontSize: 12,
          background: 'rgba(255,255,255,.05)',
          border: '1px solid rgba(0,212,184,.14)', borderRadius: 8,
          color: '#eef2f8', outline: 'none', fontFamily: O, boxSizing: 'border-box',
          resize: 'vertical',
        }}
      />
    </div>
  );
}

function FormSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        display: 'block', fontSize: 9, color: '#7a9bbf',
        textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 4, fontFamily: T,
      }}>{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '9px 11px', fontSize: 12,
          background: 'rgba(255,255,255,.05)',
          border: '1px solid rgba(0,212,184,.14)', borderRadius: 8,
          color: '#eef2f8', outline: 'none', fontFamily: O, boxSizing: 'border-box',
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value} style={{ background: '#07101f', color: '#eef2f8' }}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
