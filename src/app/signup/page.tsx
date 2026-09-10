'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { validatePassword } from '@/lib/password-policy';

const T = "'DM Mono',monospace";
const O = "'Outfit',sans-serif";
const P = "'Playfair Display',serif";

type AlertLevel = 'critical' | 'informational';

interface InviteInfo {
  valid: true;
  patient_name: string | null;
  suggested_relationship: string | null;
  suggested_alert_level: AlertLevel | null;
  expires_at: string;
}

interface RedeemResponse {
  ok: true;
  user: { id: string; email: string };
  patient: { id: string; name: string | null };
  session: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  } | null;
}

const RELATIONSHIPS = [
  'Spouse', 'Daughter', 'Son', 'Parent', 'Sibling',
  'Caregiver', 'Home Health Aide', 'Friend', 'Other',
];

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

function SignupInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialCode = (searchParams.get('code') || '').toUpperCase();

  const [code, setCode] = useState(initialCode);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [validating, setValidating] = useState(false);
  const [validateErr, setValidateErr] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState(RELATIONSHIPS[0]);
  const [alertLevel, setAlertLevel] = useState<AlertLevel>('informational');

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const validateCode = useCallback(async (raw: string) => {
    const c = raw.trim().toUpperCase();
    setInvite(null);
    setValidateErr(null);
    if (!c) return;
    setValidating(true);
    try {
      const r = await fetch(`/api/circle/redeem?code=${encodeURIComponent(c)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'invalid code');
      const info = d as InviteInfo;
      setInvite(info);
      if (info.suggested_relationship) setRelationship(info.suggested_relationship);
      if (info.suggested_alert_level) setAlertLevel(info.suggested_alert_level);
    } catch (e) {
      setValidateErr((e as Error).message);
    } finally {
      setValidating(false);
    }
  }, []);

  useEffect(() => {
    if (initialCode) validateCode(initialCode);
  }, [initialCode, validateCode]);

  const submit = async () => {
    if (!invite || submitting) return;
    if (!name.trim()) { setSubmitErr('Your name is required.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setSubmitErr('A valid email is required.'); return;
    }
    const pw = validatePassword(password, { email: email.trim(), name: name.trim() });
    if (!pw.ok) {
      setSubmitErr(pw.reason || 'Password does not meet requirements.'); return;
    }
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const r = await fetch('/api/circle/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          email: email.trim().toLowerCase(),
          password,
          member_name: name.trim(),
          member_phone: phone.trim() || undefined,
          relationship,
          alert_level: alertLevel,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'signup failed');
      const data = d as RedeemResponse;

      // Persist session so the dashboard can fetch this family member's data.
      if (data.session) {
        localStorage.setItem(
          'cc-session',
          JSON.stringify({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
            expires_at: data.session.expires_at,
            user_id: data.user.id,
            patient_id: data.patient.id,
            patient_name: data.patient.name,
          }),
        );
      }
      router.push('/app');
    } catch (e) {
      setSubmitErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

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
        input:focus,select:focus{border-color:#7BC8A0 !important}
      `}</style>

      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        {/* Brand */}
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

        <div style={{ fontFamily: T, fontSize: 10, color: '#7BC8A0', textTransform: 'uppercase', letterSpacing: '.18em', marginBottom: 8 }}>
          Care Circle Signup
        </div>
        <h1 style={{ fontFamily: P, fontSize: 28, fontWeight: 300, lineHeight: 1.2, marginBottom: 22 }}>
          {invite?.patient_name
            ? <>Join <em style={{ fontStyle: 'italic', color: '#7BC8A0' }}>{invite.patient_name}</em>&apos;s Care Circle</>
            : <>Enter your invite code</>}
        </h1>

        {/* CODE */}
        <div style={{ ...card, marginBottom: 16 }}>
          <span style={label}>Invite Code</span>
          <input
            style={{
              ...input,
              fontFamily: T,
              letterSpacing: '.3em',
              textAlign: 'center',
              fontSize: 16,
              textTransform: 'uppercase',
              marginBottom: 0,
            }}
            placeholder="ABCDEFGH"
            maxLength={12}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onBlur={(e) => validateCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') validateCode(code); }}
          />

          {validating && (
            <div style={{ marginTop: 10, fontSize: 11, color: '#A8B8C8' }}>Validating…</div>
          )}
          {validateErr && (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, fontSize: 11, background: 'rgba(232,82,110,.1)', border: '1px solid rgba(232,82,110,.3)', color: '#E05C3A' }}>
              {validateErr}
            </div>
          )}
          {invite && (
            <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, background: 'rgba(74,222,128,.08)', border: '1px solid rgba(74,222,128,.25)', fontSize: 11, color: '#4ade80' }}>
              ✅ Code valid · joining {invite.patient_name || 'a patient'}&apos;s circle
            </div>
          )}
        </div>

        {/* SIGNUP FORM (only after code is validated) */}
        {invite && (
          <div style={card}>
            <span style={label}>Your Name</span>
            <input style={input} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />

            <span style={label}>Email</span>
            <input style={input} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />

            <span style={label}>Password (12+ chars, mix of letters/numbers/symbols)</span>
            <input style={input} type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />

            <span style={label}>Phone (for emergency SMS — optional)</span>
            <input style={input} type="tel" placeholder="+1 555 555 0123" value={phone} onChange={(e) => setPhone(e.target.value)} />

            <span style={label}>Relationship to {invite.patient_name || 'patient'}</span>
            <select style={input} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
              {RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>

            <span style={label}>Alert preference</span>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {(['informational', 'critical'] as AlertLevel[]).map((lvl) => (
                <button
                  key={lvl}
                  type="button"
                  onClick={() => setAlertLevel(lvl)}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 10,
                    border: alertLevel === lvl ? '1px solid #7BC8A0' : '1px solid rgba(123,200,160,.14)',
                    background: alertLevel === lvl ? 'rgba(123,200,160,.12)' : 'rgba(255,255,255,.04)',
                    color: alertLevel === lvl ? '#7BC8A0' : '#A8B8C8',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontFamily: O,
                    textTransform: 'uppercase',
                    letterSpacing: '.1em',
                  }}
                >
                  {lvl === 'critical' ? '🚨 Critical only' : '🔔 All alerts'}
                </button>
              ))}
            </div>

            {submitErr && (
              <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, fontSize: 11, background: 'rgba(232,82,110,.1)', border: '1px solid rgba(232,82,110,.3)', color: '#E05C3A' }}>
                {submitErr}
              </div>
            )}

            <button
              onClick={submit}
              disabled={submitting}
              style={{
                width: '100%',
                padding: '13px 0',
                borderRadius: 12,
                border: 'none',
                cursor: 'pointer',
                background: 'linear-gradient(135deg,#7BC8A0,#3D8B5E)',
                color: '#0B1829',
                fontSize: 14,
                fontWeight: 700,
                fontFamily: O,
                opacity: submitting ? 0.6 : 1,
                boxShadow: '0 0 20px rgba(123,200,160,.3)',
              }}
            >
              {submitting ? 'Creating account…' : 'Join the Care Circle'}
            </button>

            <p style={{ marginTop: 14, fontSize: 11, color: '#A8B8C8', lineHeight: 1.6 }}>
              By joining, you&apos;ll receive {alertLevel === 'critical' ? 'critical-only' : 'all'} health alerts about {invite.patient_name || 'your loved one'}. Alerts name which metric crossed a threshold and what to do — not raw lab values. Sign in for full details.
            </p>
          </div>
        )}

        {!invite && (
          <div style={{ ...card, marginBottom: 16, borderColor: 'rgba(192,121,65,.3)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F4EDE1', marginBottom: 6 }}>No invite code?</div>
            <p style={{ fontSize: 12, color: '#A8B8C8', lineHeight: 1.6, marginBottom: 12 }}>
              You can ask your elder for access directly. They approve it and decide what you can see.
            </p>
            <Link
              href="/request-access"
              style={{
                display: 'inline-block',
                padding: '10px 18px',
                borderRadius: 10,
                background: 'linear-gradient(135deg,#7BC8A0,#3D8B5E)',
                color: '#0B1829',
                fontSize: 12,
                fontWeight: 700,
                textDecoration: 'none',
                fontFamily: O,
              }}
            >
              Request access
            </Link>
          </div>
        )}

        {/* Login link for returning family members */}
        <p style={{ marginTop: 18, fontSize: 11, color: '#A8B8C8', textAlign: 'center', lineHeight: 1.6 }}>
          Already have an account?{' '}
          <Link
            href="/login"
            style={{ color: '#7BC8A0', textDecoration: 'underline', textUnderlineOffset: 3 }}
          >
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: '100vh', background: '#0B1829', color: '#A8B8C8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: O }}>
        Loading…
      </div>
    }>
      <SignupInner />
    </Suspense>
  );
}
