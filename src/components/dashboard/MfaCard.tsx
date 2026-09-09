'use client';
import { useState, useEffect, useCallback } from 'react';
import { type CCSession } from '@/lib/cc-data';
import { T, O, CARD_BG, CARD_BORDER } from './ui';

type Phase = 'loading' | 'off' | 'enrolling' | 'on';

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(0,212,184,.14)', borderRadius: 10,
  padding: '10px 12px', fontSize: 14, color: '#eef2f8',
  fontFamily: T, letterSpacing: '.25em', textAlign: 'center', outline: 'none', marginBottom: 10,
};

const btn = (bg: string, color: string): React.CSSProperties => ({
  width: '100%', padding: '11px 0', borderRadius: 10, border: 'none',
  cursor: 'pointer', background: bg, color, fontSize: 12, fontWeight: 700, fontFamily: O,
});

export default function MfaCard({ session }: { session: CCSession }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [remaining, setRemaining] = useState(0);
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disarm, setDisarm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/mfa/status', { headers: authHeaders });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setPhase('off'); return; }
      setPhase(d.enabled ? 'on' : 'off');
      setRemaining(d.backup_codes_remaining ?? 0);
    } catch { setPhase('off'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token]);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const beginEnroll = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/mfa/enroll', { method: 'POST', headers: authHeaders });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'Could not start enrollment.'); return; }
      setSecret(d.secret); setUri(d.otpauth_uri); setCode(''); setPhase('enrolling');
    } catch { setError('Network error.'); } finally { setBusy(false); }
  };

  const activate = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/mfa/activate', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ code: code.replace(/\s/g, '') }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'Invalid code.'); return; }
      setBackupCodes(d.backup_codes || []); setCode(''); setPhase('on');
      setRemaining((d.backup_codes || []).length);
    } catch { setError('Network error.'); } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/mfa/disable', {
        method: 'POST', headers: authHeaders, body: JSON.stringify({ code: code.replace(/\s/g, '') }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'Invalid code.'); return; }
      setDisarm(false); setCode(''); setBackupCodes(null); setPhase('off');
    } catch { setError('Network error.'); } finally { setBusy(false); }
  };

  const wrap: React.CSSProperties = {
    background: CARD_BG, border: CARD_BORDER, borderRadius: 14, padding: 16, marginBottom: 12,
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: T, fontSize: 9, color: '#7a9bbf', textTransform: 'uppercase',
    letterSpacing: '.16em', marginBottom: 6, display: 'block',
  };

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Two-factor authentication</span>
        <span
          style={{
            fontFamily: T, fontSize: 8, padding: '3px 8px', borderRadius: 8,
            background: phase === 'on' ? 'rgba(74,222,128,.14)' : 'rgba(122,155,191,.12)',
            color: phase === 'on' ? '#4ade80' : '#7a9bbf',
            border: `1px solid ${phase === 'on' ? 'rgba(74,222,128,.25)' : 'rgba(122,155,191,.2)'}`,
            textTransform: 'uppercase', letterSpacing: '.1em',
          }}
        >
          {phase === 'loading' ? '…' : phase === 'on' ? 'On' : 'Off'}
        </span>
      </div>

      {error && (
        <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, fontSize: 11, background: 'rgba(232,82,110,.1)', border: '1px solid rgba(232,82,110,.3)', color: '#e8526e' }}>
          {error}
        </div>
      )}

      {phase === 'off' && (
        <>
          <div style={{ fontSize: 11, color: '#7a9bbf', lineHeight: 1.6, marginBottom: 12 }}>
            Add a second factor from an authenticator app (Google Authenticator, Authy, 1Password). You&apos;ll enter a 6-digit code at sign-in.
          </div>
          <button onClick={beginEnroll} disabled={busy} style={btn('linear-gradient(135deg,#00d4b8,#00b89e)', '#07101f')}>
            {busy ? 'Starting…' : 'Enable two-factor'}
          </button>
        </>
      )}

      {phase === 'enrolling' && (
        <>
          <span style={labelStyle}>1 · Add this secret to your authenticator app</span>
          <div style={{ fontFamily: T, fontSize: 14, letterSpacing: '.15em', color: '#00d4b8', background: 'rgba(0,212,184,.06)', border: '1px solid rgba(0,212,184,.18)', borderRadius: 8, padding: '10px 12px', wordBreak: 'break-all', marginBottom: 8 }}>
            {secret}
          </div>
          <div style={{ fontSize: 10, color: '#7a9bbf', lineHeight: 1.5, marginBottom: 12, wordBreak: 'break-all' }}>
            Or use this setup link: <span style={{ color: '#8fb0d0' }}>{uri}</span>
          </div>
          <span style={labelStyle}>2 · Enter the 6-digit code it shows</span>
          <input style={inputStyle} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') activate(); }} />
          <button onClick={activate} disabled={busy} style={btn('linear-gradient(135deg,#00d4b8,#00b89e)', '#07101f')}>
            {busy ? 'Verifying…' : 'Verify & turn on'}
          </button>
        </>
      )}

      {phase === 'on' && backupCodes && (
        <>
          <div style={{ fontSize: 11, color: '#4ade80', lineHeight: 1.6, marginBottom: 8, fontWeight: 600 }}>
            Two-factor is on. Save these backup codes now — each works once if you lose your device. They won&apos;t be shown again.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
            {backupCodes.map((c) => (
              <div key={c} style={{ fontFamily: T, fontSize: 12, color: '#eef2f8', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>{c}</div>
            ))}
          </div>
          <button onClick={() => setBackupCodes(null)} style={btn('rgba(255,255,255,.06)', '#eef2f8')}>I&apos;ve saved them</button>
        </>
      )}

      {phase === 'on' && !backupCodes && !disarm && (
        <>
          <div style={{ fontSize: 11, color: '#7a9bbf', lineHeight: 1.6, marginBottom: 12 }}>
            Your account is protected by an authenticator app. {remaining} backup code{remaining === 1 ? '' : 's'} remaining.
          </div>
          <button onClick={() => { setDisarm(true); setError(null); }} style={btn('rgba(232,82,110,.1)', '#e8526e')}>Turn off two-factor</button>
        </>
      )}

      {phase === 'on' && !backupCodes && disarm && (
        <>
          <span style={labelStyle}>Confirm with a code to turn off</span>
          <input style={inputStyle} inputMode="numeric" placeholder="123456 or backup code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') disable(); }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setDisarm(false); setCode(''); }} style={btn('rgba(255,255,255,.06)', '#eef2f8')}>Cancel</button>
            <button onClick={disable} disabled={busy} style={btn('rgba(232,82,110,.14)', '#e8526e')}>{busy ? 'Turning off…' : 'Turn off'}</button>
          </div>
        </>
      )}
    </div>
  );
}
