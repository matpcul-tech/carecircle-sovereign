'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Heart } from 'lucide-react';

const T = "'DM Mono',monospace";
const O = "'Outfit',sans-serif";
const P = "'Playfair Display',serif";

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(123,200,160,.14)',
  borderRadius: 18,
  padding: 24,
};
const input: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(123,200,160,.14)', borderRadius: 10,
  padding: '11px 14px', fontSize: 13, color: '#F4EDE1',
  fontFamily: O, outline: 'none', marginBottom: 10,
};
const label: React.CSSProperties = {
  fontFamily: T, fontSize: 9, color: '#A8B8C8', textTransform: 'uppercase',
  letterSpacing: '.18em', marginBottom: 6, display: 'block',
};
const button: React.CSSProperties = {
  width: '100%', padding: '13px 0', borderRadius: 12, border: 'none',
  background: 'linear-gradient(135deg,#7BC8A0,#3D8B5E)', color: '#0B1829',
  fontSize: 14, fontWeight: 700, fontFamily: O, boxShadow: '0 0 20px rgba(123,200,160,.3)',
};

export default function ResetPage() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [doneReset, setDoneReset] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    setToken(t);
    setReady(true);
  }, []);

  const requestLink = useCallback(async () => {
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('A valid email is required.'); return;
    }
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/request-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      await r.json().catch(() => ({}));
      // Always show the same confirmation, matching the server's generic reply.
      setSent(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [email, busy]);

  const doReset = useCallback(async () => {
    if (busy || !token) return;
    if (next !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || 'Could not reset password.'); return; }
      setDoneReset(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [token, next, confirm, busy]);

  const shell = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: '#0B1829', fontFamily: O, color: '#F4EDE1', padding: '40px 20px' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,300;0,400;0,600&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box}
        input::placeholder{color:#516a87}
        input:focus{border-color:#7BC8A0 !important}
      `}</style>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, textDecoration: 'none' }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#3D8B5E,#8060cc)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 14px rgba(123,200,160,.3)' }}>
            <Heart size={16} color="#fff" fill="#fff" />
          </div>
          <div style={{ fontFamily: P, fontSize: 18, color: '#F4EDE1' }}>CareCircle</div>
        </Link>
        {children}
      </div>
    </div>
  );

  const errorBox = error && (
    <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, fontSize: 11, background: 'rgba(232,82,110,.1)', border: '1px solid rgba(232,82,110,.3)', color: '#E05C3A' }}>
      {error}
    </div>
  );

  if (!ready) return shell(<div style={{ color: '#A8B8C8' }}>Loading...</div>);

  // Mode B: token present -> set a new password.
  if (token) {
    return shell(
      <>
        <h1 style={{ fontFamily: P, fontSize: 26, fontWeight: 300, marginBottom: 20 }}>Choose a new password</h1>
        <div style={card}>
          {doneReset ? (
            <div>
              <div style={{ fontSize: 13, color: '#4ade80', marginBottom: 14, lineHeight: 1.6 }}>
                Your password has been reset. If two-factor is on, you will be asked for a code at sign-in.
              </div>
              <Link href="/login" style={{ ...button, display: 'block', textAlign: 'center', textDecoration: 'none' }}>Go to sign in</Link>
            </div>
          ) : (
            <>
              {errorBox}
              <span style={label}>New password (12+ chars, mix of letters/numbers/symbols)</span>
              <input style={input} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              <span style={label}>Confirm new password</span>
              <input style={input} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') doReset(); }} />
              <button onClick={doReset} disabled={busy} style={{ ...button, opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
                {busy ? 'Resetting...' : 'Reset password'}
              </button>
            </>
          )}
        </div>
      </>,
    );
  }

  // Mode A: no token -> request a reset link.
  return shell(
    <>
      <h1 style={{ fontFamily: P, fontSize: 26, fontWeight: 300, marginBottom: 20 }}>Reset your password</h1>
      <div style={card}>
        {sent ? (
          <div style={{ fontSize: 13, color: '#A8B8C8', lineHeight: 1.7 }}>
            If an account exists for that email, a reset link is on its way. The link is valid for 30 minutes.
            <div style={{ marginTop: 16 }}>
              <Link href="/login" style={{ color: '#7BC8A0', textDecoration: 'underline', textUnderlineOffset: 3 }}>Back to sign in</Link>
            </div>
          </div>
        ) : (
          <>
            {errorBox}
            <span style={label}>Email</span>
            <input style={input} type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') requestLink(); }} />
            <button onClick={requestLink} disabled={busy} style={{ ...button, opacity: busy ? 0.6 : 1, cursor: busy ? 'not-allowed' : 'pointer' }}>
              {busy ? 'Sending...' : 'Send reset link'}
            </button>
            <p style={{ marginTop: 18, fontSize: 11, color: '#A8B8C8', textAlign: 'center' }}>
              <Link href="/login" style={{ color: '#7BC8A0', textDecoration: 'underline', textUnderlineOffset: 3 }}>Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </>,
  );
}
