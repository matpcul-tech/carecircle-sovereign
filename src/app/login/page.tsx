'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Heart } from 'lucide-react';

const T = "'DM Mono',monospace";
const O = "'Outfit',sans-serif";
const P = "'Playfair Display',serif";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface CCSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
  patient_id: string;
  patient_name: string | null;
}

interface CareCircleRow {
  patient_id: string;
  patient_name?: string | null;
}

interface SupabaseTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: { id: string };
}

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(123,200,160,.14)',
  borderRadius: 18,
  padding: 24,
};

const input: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(123,200,160,.14)',
  borderRadius: 10,
  padding: '11px 14px',
  fontSize: 13,
  color: '#F4EDE1',
  fontFamily: O,
  outline: 'none',
  marginBottom: 10,
};

const label: React.CSSProperties = {
  fontFamily: T,
  fontSize: 9,
  color: '#A8B8C8',
  textTransform: 'uppercase',
  letterSpacing: '.18em',
  marginBottom: 6,
  display: 'block',
};

function readSession(): CCSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('cc-session');
    if (!raw) return null;
    return JSON.parse(raw) as CCSession;
  } catch {
    return null;
  }
}

function sessionStillValid(s: CCSession): boolean {
  return s.expires_at - 60 > Math.floor(Date.now() / 1000);
}

async function refreshSession(s: CCSession): Promise<CCSession | null> {
  const r = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    },
  );
  if (!r.ok) return null;
  const data = (await r.json()) as SupabaseTokenResponse;
  const updated: CCSession = {
    ...s,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  };
  window.localStorage.setItem('cc-session', JSON.stringify(updated));
  return updated;
}

export default function LoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // MFA step: when the login proxy returns mfa_required, we hold the opaque
  // token and switch to a code prompt.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = readSession();
      if (!s) {
        if (!cancelled) setChecking(false);
        return;
      }
      if (sessionStillValid(s)) {
        if (!cancelled) router.replace('/app');
        return;
      }
      const refreshed = await refreshSession(s);
      if (cancelled) return;
      if (refreshed) {
        router.replace('/app');
      } else {
        window.localStorage.removeItem('cc-session');
        setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Persist the resolved session and enter the app. `circle` may be null when
  // the account has no linked Care Circle yet.
  const finalizeLogin = useCallback(
    (
      s: { access_token: string; refresh_token: string; expires_at: number; user_id: string },
      circle: CareCircleRow | null,
    ) => {
      if (!circle) {
        setError(
          'You are signed in, but no Care Circle is linked to this email. ' +
            'Ask the patient to send you an invite link, then open that link to join.',
        );
        return;
      }
      const session: CCSession = {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_at: s.expires_at,
        user_id: s.user_id,
        patient_id: circle.patient_id,
        patient_name: circle.patient_name ?? null,
      };
      window.localStorage.setItem('cc-session', JSON.stringify(session));
      router.replace('/app');
    },
    [router],
  );

  const submit = useCallback(async () => {
    if (submitting) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('A valid email is required.');
      return;
    }
    if (password.length < 1) {
      setError('Password is required.');
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || 'Login failed. Check your email and password.');
        return;
      }
      if (d.mfa_required) {
        setMfaToken(d.mfa_token);
        setError(null);
        return;
      }
      finalizeLogin(d.session, d.circle ?? null);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [email, password, submitting, finalizeLogin]);

  const verifyMfa = useCallback(async () => {
    if (submitting || !mfaToken) return;
    const clean = code.replace(/\s/g, '');
    if (clean.length < 6) {
      setError('Enter the 6-digit code from your authenticator (or a backup code).');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/mfa/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_token: mfaToken, code: clean }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        // An expired pending-login token means we must restart the flow.
        if (r.status === 401 && /expired|invalid session/i.test(d.error || '')) {
          setMfaToken(null);
          setCode('');
        }
        setError(d.error || 'Invalid code.');
        return;
      }
      finalizeLogin(d.session, d.circle ?? null);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [submitting, mfaToken, code, finalizeLogin]);

  if (checking) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: '#0B1829',
          color: '#A8B8C8',
          fontFamily: O,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
          *{box-sizing:border-box}
        `}</style>
        Checking session...
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0B1829',
        fontFamily: O,
        color: '#F4EDE1',
        padding: '40px 20px',
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box}
        input::placeholder{color:#516a87}
        input:focus{border-color:#7BC8A0 !important}
      `}</style>

      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <Link
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 28,
            textDecoration: 'none',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg,#3D8B5E,#8060cc)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 14px rgba(123,200,160,.3)',
            }}
          >
            <Heart size={16} color="#fff" fill="#fff" />
          </div>
          <div style={{ fontFamily: P, fontSize: 18, color: '#F4EDE1' }}>
            CareCircle
            <span style={{ fontFamily: T, fontSize: 9, color: '#C07941', letterSpacing: 2, textTransform: 'uppercase', marginLeft: 6 }}>Sovereign Edition</span>
          </div>
        </Link>

        <div
          style={{
            fontFamily: T,
            fontSize: 10,
            color: '#7BC8A0',
            textTransform: 'uppercase',
            letterSpacing: '.18em',
            marginBottom: 8,
          }}
        >
          Care Circle Login
        </div>
        <h1 style={{ fontFamily: P, fontSize: 28, fontWeight: 300, lineHeight: 1.2, marginBottom: 22 }}>
          Welcome back
        </h1>

        <div style={card}>
          {!mfaToken ? (
            <>
              <span style={label}>Email</span>
              <input
                style={input}
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />

              <span style={label}>Password</span>
              <input
                style={input}
                type="password"
                autoComplete="current-password"
                placeholder=""
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
              <div style={{ textAlign: 'right', marginBottom: 6 }}>
                <Link href="/reset" style={{ fontSize: 11, color: '#A8B8C8', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                  Forgot password?
                </Link>
              </div>
            </>
          ) : (
            <>
              <span style={label}>Two-factor code</span>
              <input
                style={{ ...input, fontFamily: T, letterSpacing: '.3em', textAlign: 'center', fontSize: 18 }}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') verifyMfa(); }}
              />
              <div style={{ fontSize: 11, color: '#A8B8C8', lineHeight: 1.6, marginBottom: 4 }}>
                Enter the 6-digit code from your authenticator app, or one of your backup codes.
              </div>
            </>
          )}

          {error && (
            <div
              style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 10,
                fontSize: 11,
                background: 'rgba(232,82,110,.1)',
                border: '1px solid rgba(232,82,110,.3)',
                color: '#E05C3A',
              }}
            >
              {error}
            </div>
          )}

          <button
            onClick={mfaToken ? verifyMfa : submit}
            disabled={submitting}
            style={{
              width: '100%',
              padding: '13px 0',
              borderRadius: 12,
              border: 'none',
              cursor: submitting ? 'not-allowed' : 'pointer',
              background: 'linear-gradient(135deg,#7BC8A0,#3D8B5E)',
              color: '#0B1829',
              fontSize: 14,
              fontWeight: 700,
              fontFamily: O,
              opacity: submitting ? 0.6 : 1,
              boxShadow: '0 0 20px rgba(123,200,160,.3)',
            }}
          >
            {submitting ? (mfaToken ? 'Verifying...' : 'Signing in...') : mfaToken ? 'Verify code' : 'Sign in'}
          </button>

          {mfaToken ? (
            <p style={{ marginTop: 18, fontSize: 11, color: '#A8B8C8', textAlign: 'center', lineHeight: 1.6 }}>
              <button
                onClick={() => { setMfaToken(null); setCode(''); setError(null); }}
                style={{ background: 'none', border: 'none', color: '#7BC8A0', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer', fontFamily: O, fontSize: 11 }}
              >
                Cancel and start over
              </button>
            </p>
          ) : (
            <p style={{ marginTop: 18, fontSize: 11, color: '#A8B8C8', textAlign: 'center', lineHeight: 1.6 }}>
              New here?{' '}
              <Link
                href="/signup"
                style={{ color: '#7BC8A0', textDecoration: 'underline', textUnderlineOffset: 3 }}
              >
                Use your invite code to sign up
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
