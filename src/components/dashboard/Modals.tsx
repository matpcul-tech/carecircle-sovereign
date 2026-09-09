'use client';
import { useState } from 'react';
import { FAMILY, type Medication, type Task } from '@/lib/data';
import { O, T } from './ui';

export type ModalType = 'addMed' | 'addTask' | 'upload' | 'notif' | null;

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(7,16,31,.85)',
  display: 'flex', alignItems: 'flex-end', justifyContent: 'center', backdropFilter: 'blur(8px)',
};
const sheet: React.CSSProperties = {
  background: '#0c1a2e', borderTop: '1px solid rgba(0,212,184,.25)', borderRadius: '20px 20px 0 0',
  padding: 24, maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto',
};
const handle: React.CSSProperties = {
  width: 40, height: 4, background: 'rgba(255,255,255,.15)', borderRadius: 2, margin: '0 auto 16px',
};
const title: React.CSSProperties = {
  fontFamily: "'Playfair Display',serif", fontSize: 18, color: '#eef2f8', marginBottom: 18,
};
const label: React.CSSProperties = {
  fontFamily: T, fontSize: 9, color: '#7a9bbf', textTransform: 'uppercase', letterSpacing: '.15em', marginBottom: 6, display: 'block',
};
const input: React.CSSProperties = {
  width: '100%', padding: '11px 14px', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(0,212,184,.2)',
  borderRadius: 10, fontSize: 13, color: '#eef2f8', fontFamily: O, outline: 'none', marginBottom: 14,
};
const primary: React.CSSProperties = {
  width: '100%', padding: 14, background: 'linear-gradient(135deg,#00d4b8,#00b89e)', color: '#07101f',
  fontFamily: O, fontSize: 13, fontWeight: 700, border: 'none', borderRadius: 12, cursor: 'pointer', marginTop: 6,
};
const secondary: React.CSSProperties = {
  width: '100%', padding: 12, background: 'transparent', border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 10, fontFamily: O, fontSize: 12, color: '#7a9bbf', cursor: 'pointer', marginTop: 8,
};

export default function Modals({
  type, onClose, onAddMed, onAddTask, onEnableNotif,
}: {
  type: ModalType;
  onClose: () => void;
  onAddMed: (m: Medication) => void;
  onAddTask: (t: Task) => void;
  onEnableNotif: () => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  if (!type) return null;
  const set = (k: string, v: string) => setForm(prev => ({ ...prev, [k]: v }));
  const close = () => { setForm({}); onClose(); };

  return (
    <div style={overlay} onClick={close}>
      <div style={sheet} onClick={e => e.stopPropagation()}>
        <div style={handle} />

        {type === 'addMed' && (
          <>
            <div style={title}>Add Medication</div>
            <label style={label}>Name</label>
            <input style={input} placeholder="e.g., Lisinopril 10mg" onChange={e => set('name', e.target.value)} />
            <label style={label}>Dose</label>
            <input style={input} placeholder="e.g., 1 tablet" onChange={e => set('dose', e.target.value)} />
            <label style={label}>Schedule</label>
            <input style={input} placeholder="e.g., 8:00 AM daily" onChange={e => set('schedule', e.target.value)} />
            <label style={label}>Time slot</label>
            <input style={input} placeholder="7:00 AM | 12:00 PM | 8:00 PM" onChange={e => set('time', e.target.value)} />
            <label style={label}>Pills remaining</label>
            <input style={input} type="number" placeholder="30" onChange={e => set('pillsLeft', e.target.value)} />
            <label style={label}>Notes (optional)</label>
            <input style={input} placeholder="e.g., Take with food" onChange={e => set('notes', e.target.value)} />
            <button style={primary} onClick={() => {
              if (!form.name) return;
              onAddMed({
                id: 'm' + Date.now(), name: form.name, dose: form.dose || '1 tablet',
                schedule: form.schedule || 'As directed', time: form.time || '7:00 AM',
                taken: false, critical: false, pillsLeft: parseInt(form.pillsLeft) || 30,
                refillDate: 'TBD', notes: form.notes,
              });
              close();
            }}>Add Medication</button>
          </>
        )}

        {type === 'addTask' && (
          <>
            <div style={title}>Add Care Task</div>
            <label style={label}>Title</label>
            <input style={input} placeholder="e.g., Refill Amlodipine" onChange={e => set('title', e.target.value)} />
            <label style={label}>Description</label>
            <input style={input} placeholder="Pickup at CVS on Main" onChange={e => set('desc', e.target.value)} />
            <label style={label}>Due</label>
            <input style={input} placeholder="e.g., This Week" onChange={e => set('due', e.target.value)} />
            <label style={label}>Assign to</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {FAMILY.map(m => (
                <button key={m.id} onClick={() => set('assignee', m.id)} style={{ padding: '7px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: O, background: form.assignee === m.id ? 'rgba(0,212,184,.15)' : 'rgba(255,255,255,.04)', color: form.assignee === m.id ? '#00d4b8' : '#7a9bbf', border: `1px solid ${form.assignee === m.id ? 'rgba(0,212,184,.3)' : 'rgba(0,212,184,.14)'}`, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 14, height: 14, borderRadius: '50%', background: m.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: '#fff', fontWeight: 700 }}>{m.avatar}</span>
                  {m.name.split(' ')[0]}
                </button>
              ))}
            </div>
            <label style={label}>Priority</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {(['high', 'medium', 'low'] as const).map(p => (
                <button key={p} onClick={() => set('priority', p)} style={{ flex: 1, padding: '8px 12px', borderRadius: 10, fontSize: 11, cursor: 'pointer', fontFamily: O, textTransform: 'capitalize', background: form.priority === p ? 'rgba(0,212,184,.15)' : 'rgba(255,255,255,.04)', color: form.priority === p ? '#00d4b8' : '#7a9bbf', border: `1px solid ${form.priority === p ? 'rgba(0,212,184,.3)' : 'rgba(0,212,184,.14)'}` }}>{p}</button>
              ))}
            </div>
            <button style={primary} onClick={() => {
              if (!form.title) return;
              onAddTask({
                id: 't' + Date.now(), title: form.title, desc: form.desc || '',
                due: form.due || 'TBD', done: false,
                priority: (form.priority as 'high' | 'medium' | 'low') || 'medium',
                assignee: form.assignee || 'sarah',
              });
              close();
            }}>Add Task</button>
          </>
        )}

        {type === 'upload' && (
          <>
            <div style={title}>Upload Document</div>
            <div style={{ border: '2px dashed rgba(0,212,184,.3)', borderRadius: 14, padding: 28, textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>↑</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#eef2f8' }}>Tap to upload or take a photo</div>
              <div style={{ fontSize: 11, color: '#7a9bbf', marginTop: 4 }}>PDF, JPG, PNG up to 25MB</div>
            </div>
            <label style={label}>Document Type</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {['Medical', 'Insurance', 'Legal', 'Care Plan'].map(t => (
                <button key={t} onClick={() => set('type', t)} style={{ padding: '7px 12px', borderRadius: 20, fontSize: 11, cursor: 'pointer', fontFamily: O, background: form.type === t ? 'rgba(0,212,184,.15)' : 'rgba(255,255,255,.04)', color: form.type === t ? '#00d4b8' : '#7a9bbf', border: `1px solid ${form.type === t ? 'rgba(0,212,184,.3)' : 'rgba(0,212,184,.14)'}` }}>{t}</button>
              ))}
            </div>
            <label style={label}>Label (optional)</label>
            <input style={input} placeholder="e.g., Lab Results — March" onChange={e => set('label', e.target.value)} />
            <button style={primary} onClick={close}>Upload Document</button>
          </>
        )}

        {type === 'notif' && (
          <>
            <div style={title}>🔔 Enable Notifications</div>
            <div style={{ fontSize: 13, color: '#7a9bbf', marginBottom: 18, lineHeight: 1.65 }}>
              CareCircle can send reminders for medications, upcoming appointments, and task deadlines.
            </div>
            <button style={primary} onClick={() => { onEnableNotif(); close(); }}>Enable Notifications</button>
            <button style={secondary} onClick={close}>Maybe Later</button>
          </>
        )}
      </div>
    </div>
  );
}
