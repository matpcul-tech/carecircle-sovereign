'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Heart } from 'lucide-react';
import { validatePassword } from '@/lib/password-policy';
import {
  ACCESS_REQUEST_RELATIONSHIPS,
  STATUS_COLOR,
  STATUS_LABEL,
  type AccessRequestRow,
  type PendingSession,
} from '@/lib/access-requests';

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

function readPending(): PendingSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('cc-pending');
    if (!raw) return null;
    const s = JSON.parse(raw) as PendingSession;
    return s && typeof s.access_token === 'string' ? s : null;
  } catch {
    return null;
  }
}

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function RequestAccessInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const showStatusFirst = searchParams.get('status') === '1';

  const [pending, setPending] = useState<PendingSession | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [patientEmail, setPatientEmail] = useState('');
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState<string>(ACCESS_REQUEST_RELATIONSHIPS[1]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [requests, setRequests] = useState<AccessRequestRow[] | null>(null);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [showForm, setShowForm] = useState(!showStatusFirst);

  useEffect(() => {
    setPending(readPending());
    setHydrated(true);
  }, []);

  const loadRequests = useCallback(async (s: PendingSession) => {
    setLoadingRequests(true);
    try {
      const r = await fetch('/api/circle/request-access?mine=1', {
        headers: { Authorization: `Bearer ${s.access_token}` },
        cache: 'no-store',
      });
      const d = (await r.json().catch(() => ({}))) as { requests?: AccessRequestRow[]; error?: string };
      if (r.status === 401) {
        window.localStorage.removeItem('cc-pending');
        setPending(null);
        setRequests(null);
        return;
      }
      setRequests(Array.isArray(d.requests) ? d.requests : []);
    } catch {
      setRequests([]);
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  useEffect(() => {
    if (pending) loadRequests(pending);
  }, [pending, loadRequests]);

  const submit = async () => {
    if (submitting) return;
    setSubmitErr(null);
    setNotice(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientEmail.trim())) {
      setSubmitErr("Your elder's Health OS email is required.");
      return;
    }
    if (!name.trim()) {
      setSubmitErr('Your name is required.');
      return;
    }
    if (!pending) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setSubmitErr('A valid email is required.');
        return;
      }
      const pw = validatePassword(password, { email: email.trim(), name: name.trim() });
      if (!pw.ok) {
        setSubmitErr(pw.reason || 'Password does not meet requirements.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const r = await fetch('/api/circle/request-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(pending ? { Authorization: `Bearer ${pending.access_token}` } : {}),
        },
        body: JSON.stringify({
          patient_email: patientEmail.trim().toLowerCase(),
          requester_name: name.trim(),
          requester_email: pending ? undefined : email.trim().toLowerCase(),
          requester_phone: phone.trim() || undefined,
          relationship,
          message: message.trim() || undefined,
          password: pending ? undefined : password,
        }),
      });
      const d = (await r.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        session?: { access_token: string; refresh_token: string; expires_at: number } | null;
        user_id?: string;
      };
      if (!r.ok) throw new Error(d.error || 'Request failed');
      setNotice(d.message || 'Your request was sent.');
      if (d.session && d.user_id) {
        const s: PendingSession = {
          access_token: d.session.access_token,
          refresh_token: d.session.refresh_token,
          expires_at: d.session.expires_at,
          user_id: d.user_id,
        };
        window.localStorage.setItem('cc-pending', JSON.stringify(s));
        setPending(s);
      } else if (pending) {
        loadRequests(pending);
      }
      setShowForm(false);
      setPatientEmail('');
      setMessage('');
    } catch (e) {
      setSubmitErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const signInToCircle = () => {
    window.localStorage.removeItem('cc-pending');
    router.replace('/login');
  };

  const anyApproved = (requests || []).some((r) => r.status === 'approved');

  return (
    <div style={{ minHeight: '100vh', background: '#0B1829', fontFamily: O, color: '#F4EDE1', padding: '40px 20px' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box}
        input::placeholder,textarea::placeholder{color:#516a87}
        input:focus,select:focus,textarea:focus{border-color:#7BC8A0 !important}
      `}</style>

      <div style={{ maxWidth: 460, margin: '0 auto' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, textDecoration: 'none' }}>
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

        <div style={{ fontFamily: T, fontSize: 10, color: '#C07941', textTransform: 'uppercase', letterSpacing: '.18em', marginBottom: 8 }}>
          Ask your elder for access
        </div>
        <h1 style={{ fontFamily: P, fontSize: 28, fontWeight: 300, lineHeight: 1.2, marginBottom: 22 }}>
          Join your elder&apos;s Care Circle
        </h1>

        {/* STATUS LIST (when a pending session exists) */}
        {hydrated && pending && (
          <div style={{ ...card, marginBottom: 16 }}>
            <span style={label}>Your requests</span>
            {loadingRequests && requests === null ? (
              <div style={{ fontSize: 12, color: '#A8B8C8' }}>Loading...</div>
            ) : (requests || []).length === 0 ? (
              <div style={{ fontSize: 12, color: '#A8B8C8', lineHeight: 1.6 }}>
                No requests yet. Fill in the form below to ask your elder for access.
              </div>
            ) : (
              (requests || []).map((r) => (
                <div
                  key={r.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom: '1px solid rgba(255,255,255,.06)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{r.patient_name || 'Your elder'}</div>
                    <div style={{ fontSize: 11, color: '#A8B8C8' }}>
                      {r.relationship} · asked {fmt(r.created_at)}
                      {r.status === 'approved' && r.granted_role ? ` · ${r.granted_role}` : ''}
                    </div>
                  </div>
                  <span
                    style={{
                      fontFamily: T,
                      fontSize: 9,
                      padding: '4px 10px',
                      borderRadius: 8,
                      whiteSpace: 'nowrap',
                      textTransform: 'uppercase',
                      letterSpacing: '.1em',
                      color: STATUS_COLOR[r.status],
                      border: `1px solid ${STATUS_COLOR[r.status]}55`,
                      background: `${STATUS_COLOR[r.status]}14`,
                    }}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
              ))
            )}
            {anyApproved && (
              <button
                onClick={signInToCircle}
                style={{
                  width: '100%',
                  marginTop: 14,
                  padding: '13px 0',
                  borderRadius: 12,
                  border: 'none',
                  cursor: 'pointer',
                  background: 'linear-gradient(135deg,#7BC8A0,#3D8B5E)',
                  color: '#0B1829',
                  fontSize: 14,
                  fontWeight: 700,
                  fontFamily: O,
                }}
              >
                Sign in to the circle
              </button>
            )}
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                style={{
                  width: '100%',
                  marginTop: 10,
                  padding: '11px 0',
                  borderRadius: 12,
                  border: '1px solid rgba(192,121,65,.4)',
                  cursor: 'pointer',
                  background: 'transparent',
                  color: '#C07941',
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: O,
                }}
              >
                Ask another elder for access
              </button>
            )}
          </div>
        )}

        {notice && (
          <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 12, fontSize: 12, lineHeight: 1.6, background: 'rgba(74,222,128,.08)', border: '1px solid rgba(74,222,128,.25)', color: '#4ade80' }}>
            {notice}
          </div>
        )}

        {/* FORM */}
        {hydrated && showForm && (
          <div style={card}>
            <span style={label}>Your elder&apos;s Health OS email</span>
            <input style={input} type="email" placeholder="elder@example.com" value={patientEmail} onChange={(e) => setPatientEmail(e.target.value)} />

            <span style={label}>Your name</span>
            <input style={input} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />

            <span style={label}>Relationship to your elder</span>
            <select style={input} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
              {ACCESS_REQUEST_RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>

            {!pending && (
              <>
                <span style={label}>Your email</span>
                <input style={input} type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />

                <span style={label}>Password (12+ chars, mix of letters, numbers, symbols)</span>
                <input style={input} type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              </>
            )}

            <span style={label}>Phone (optional)</span>
            <input style={input} type="tel" placeholder="+1 580 555 0123" value={phone} onChange={(e) => setPhone(e.target.value)} />

            <span style={label}>Note to your elder (optional)</span>
            <textarea
              style={{ ...input, minHeight: 80, resize: 'vertical' }}
              maxLength={500}
              placeholder="A few words so they know it is you."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div style={{ fontFamily: T, fontSize: 9, color: '#A8B8C8', textAlign: 'right', marginTop: -6, marginBottom: 10 }}>
              {message.length}/500
            </div>

            {submitErr && (
              <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10, fontSize: 11, background: 'rgba(224,92,58,.1)', border: '1px solid rgba(224,92,58,.3)', color: '#E05C3A' }}>
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
              {submitting ? 'Sending...' : 'Send request'}
            </button>

            <p style={{ marginTop: 14, fontFamily: T, fontSize: 10, color: '#A8B8C8', lineHeight: 1.7, letterSpacing: '.04em' }}>
              SOVEREIGN SHIELD ON. We do not confirm whether an email belongs to a patient. Your elder is notified and decides.
            </p>
          </div>
        )}

        <p style={{ marginTop: 18, fontSize: 11, color: '#A8B8C8', textAlign: 'center', lineHeight: 1.8 }}>
          Have an invite code?{' '}
          <Link href="/signup" style={{ color: '#7BC8A0', textDecoration: 'underline', textUnderlineOffset: 3 }}>Join with a code</Link>
          <br />
          Already in a circle?{' '}
          <Link href="/login" style={{ color: '#7BC8A0', textDecoration: 'underline', textUnderlineOffset: 3 }}>Log in</Link>
        </p>
      </div>
    </div>
  );
}

export default function RequestAccessPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', background: '#0B1829', color: '#A8B8C8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: O }}>
          Loading...
        </div>
      }
    >
      <RequestAccessInner />
    </Suspense>
  );
}
