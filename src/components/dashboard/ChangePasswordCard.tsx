'use client';
import { useState } from 'react';
import { type CCSession } from '@/lib/cc-data';
import { T, O, CARD_BG, CARD_BORDER } from './ui';

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(0,212,184,.14)', borderRadius: 10,
  padding: '10px 12px', fontSize: 13, color: '#eef2f8',
  fontFamily: O, outline: 'none', marginBottom: 8,
};
const label: React.CSSProperties = {
  fontFamily: T, fontSize: 9, color: '#7a9bbf', textTransform: 'uppercase',
  letterSpacing: '.16em', marginBottom: 6, display: 'block',
};
const btn: React.CSSProperties = {
  width: '100%', padding: '11px 0', borderRadius: 10, border: 'none',
  cursor: 'pointer', background: 'linear-gradient(135deg,#00d4b8,#00b89e)',
  color: '#07101f', fontSize: 12, fontWeight: 700, fontFamily: O,
};

export default function ChangePasswordCard({ session }: { session: CCSession }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (next !== confirm) { setError('New passwords do not match.'); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ current_password: current, new_password: next, code: code.replace(/\s/g, '') }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'Could not change password.'); return; }
      setDone(true); setOpen(false);
      setCurrent(''); setNext(''); setConfirm(''); setCode('');
    } catch {
      setError('Network error.');
    } finally {
      setBusy(false);
    }
  };

  const wrap: React.CSSProperties = {
    background: CARD_BG, border: CARD_BORDER, borderRadius: 14, padding: 16, marginBottom: 12,
  };

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Password</span>
        {!open && (
          <button
            onClick={() => { setOpen(true); setDone(false); setError(null); }}
            style={{
              fontFamily: O, fontSize: 11, fontWeight: 600, color: '#00d4b8',
              background: 'rgba(0,212,184,.1)', border: '1px solid rgba(0,212,184,.3)',
              borderRadius: 8, padding: '5px 10px', cursor: 'pointer',
            }}
          >Change</button>
        )}
      </div>

      {done && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#4ade80', lineHeight: 1.6 }}>
          Password updated.
        </div>
      )}

      {open && (
        <div style={{ marginTop: 12 }}>
          {error && (
            <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, fontSize: 11, background: 'rgba(232,82,110,.1)', border: '1px solid rgba(232,82,110,.3)', color: '#e8526e' }}>
              {error}
            </div>
          )}
          <span style={label}>Current password</span>
          <input style={inputStyle} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <span style={label}>New password (12+ chars, mix of letters/numbers/symbols)</span>
          <input style={inputStyle} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <span style={label}>Confirm new password</span>
          <input style={inputStyle} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <span style={label}>Two-factor code (only if 2FA is on)</span>
          <input style={inputStyle} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button onClick={() => { setOpen(false); setError(null); }} style={{ ...btn, background: 'rgba(255,255,255,.06)', color: '#eef2f8' }}>Cancel</button>
            <button onClick={submit} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>{busy ? 'Saving...' : 'Update password'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
