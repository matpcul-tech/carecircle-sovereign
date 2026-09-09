'use client';

import { useState, useEffect, useCallback } from 'react';
import { type CCSession } from '@/lib/cc-data';
import { T, O, CARD_BG, CARD_BORDER } from './ui';
import { STATUS_COLOR, STATUS_LABEL, type AccessRequestRow } from '@/lib/access-requests';

/**
 * Pending family access requests for the patient whose circle this is.
 * Rendered only for circle admins (the patient themselves counts as admin).
 * Each pending request offers a role and an alert level, then Approve or
 * Deny; the decision goes through /api/circle/request-access/decide, which
 * writes the care_circle row and the PHI access log entry.
 */

type CareRole = 'admin' | 'caregiver' | 'viewer';
type AlertLevel = 'critical' | 'informational';

const ROLE_HELP: Record<CareRole, string> = {
  viewer: 'Read only. Sees medications, appointments, tasks, and alerts. No documents.',
  caregiver: 'Can add and edit medications, tasks, and appointments, and upload documents. Cannot delete.',
  admin: 'Full access, including deleting records and approving other family members.',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,.05)',
  border: '1px solid rgba(123,200,160,.14)',
  borderRadius: 10,
  padding: '9px 12px',
  fontSize: 12,
  color: '#F4EDE1',
  fontFamily: O,
  outline: 'none',
  marginBottom: 6,
};

const smallLabel: React.CSSProperties = {
  fontFamily: T,
  fontSize: 9,
  color: '#A8B8C8',
  textTransform: 'uppercase',
  letterSpacing: '.14em',
  marginBottom: 4,
  display: 'block',
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export default function AccessRequestsCard({ session }: { session: CCSession }) {
  const [requests, setRequests] = useState<AccessRequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, { role: CareRole; alert: AlertLevel }>>({});

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/circle/request-access?patient_id=${encodeURIComponent(session.patient_id)}`, {
        headers: authHeaders,
        cache: 'no-store',
      });
      const d = (await r.json().catch(() => ({}))) as { requests?: AccessRequestRow[]; error?: string };
      if (!r.ok) {
        setError(d.error || `Could not load requests (${r.status}).`);
        setRequests([]);
        return;
      }
      setRequests(Array.isArray(d.requests) ? d.requests : []);
      setError(null);
    } catch {
      setError('Network error loading requests.');
      setRequests([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token, session.patient_id]);

  useEffect(() => {
    load();
  }, [load]);

  const choiceFor = (id: string) => choices[id] || { role: 'viewer' as CareRole, alert: 'critical' as AlertLevel };

  const decide = async (r: AccessRequestRow, decision: 'approve' | 'deny') => {
    if (busyId) return;
    if (decision === 'deny' && !window.confirm(`Deny ${r.requester_name}'s request? They will be told it was not approved.`)) return;
    setBusyId(r.id);
    setError(null);
    try {
      const c = choiceFor(r.id);
      const res = await fetch('/api/circle/request-access/decide', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          request_id: r.id,
          decision,
          care_role: c.role,
          alert_level: c.alert,
        }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(d.error || `Could not ${decision} (${res.status}).`);
        return;
      }
      await load();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const pending = (requests || []).filter((r) => r.status === 'pending');
  const decided = (requests || []).filter((r) => r.status !== 'pending').slice(0, 5);

  return (
    <div style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: 14, padding: 16, marginBottom: 12 }}>
      {requests === null ? (
        <div style={{ fontSize: 12, color: '#A8B8C8' }}>Loading access requests...</div>
      ) : pending.length === 0 ? (
        <div style={{ fontSize: 12, color: '#A8B8C8', lineHeight: 1.6 }}>
          No one is waiting. Family can ask to join at /request-access, or you can send an invite code.
        </div>
      ) : (
        pending.map((r) => {
          const c = choiceFor(r.id);
          const busy = busyId === r.id;
          return (
            <div
              key={r.id}
              style={{
                padding: '12px 0',
                borderBottom: '1px solid rgba(255,255,255,.06)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{r.requester_name}</div>
                  <div style={{ fontSize: 11, color: '#A8B8C8' }}>
                    {r.relationship} · {r.requester_email}
                    {r.requester_phone ? ` · ${r.requester_phone}` : ''}
                  </div>
                  <div style={{ fontFamily: T, fontSize: 9, color: '#A8B8C8', marginTop: 2 }}>
                    Asked {fmt(r.created_at)} · expires {fmt(r.expires_at)}
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
                    color: STATUS_COLOR.pending,
                    border: `1px solid ${STATUS_COLOR.pending}55`,
                    background: `${STATUS_COLOR.pending}14`,
                  }}
                >
                  Waiting
                </span>
              </div>

              {r.message && (
                <div
                  style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,.04)',
                    fontSize: 12,
                    color: '#F4EDE1',
                    lineHeight: 1.55,
                    fontStyle: 'italic',
                  }}
                >
                  &ldquo;{r.message}&rdquo;
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                <div>
                  <span style={smallLabel}>Role</span>
                  <select
                    style={selectStyle}
                    value={c.role}
                    disabled={busy}
                    onChange={(e) => setChoices((p) => ({ ...p, [r.id]: { ...c, role: e.target.value as CareRole } }))}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="caregiver">Caregiver</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <span style={smallLabel}>Alerts</span>
                  <select
                    style={selectStyle}
                    value={c.alert}
                    disabled={busy}
                    onChange={(e) => setChoices((p) => ({ ...p, [r.id]: { ...c, alert: e.target.value as AlertLevel } }))}
                  >
                    <option value="critical">Critical only</option>
                    <option value="informational">All</option>
                  </select>
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#A8B8C8', lineHeight: 1.5, marginBottom: 10 }}>{ROLE_HELP[c.role]}</div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => decide(r, 'approve')}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 10,
                    border: 'none',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    background: 'linear-gradient(135deg,#7BC8A0,#3D8B5E)',
                    color: '#0B1829',
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: O,
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {busy ? 'Working...' : 'Approve'}
                </button>
                <button
                  onClick={() => decide(r, 'deny')}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    borderRadius: 10,
                    border: '1px solid rgba(224,92,58,.4)',
                    cursor: busy ? 'not-allowed' : 'pointer',
                    background: 'transparent',
                    color: '#E05C3A',
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: O,
                  }}
                >
                  Deny
                </button>
              </div>
            </div>
          );
        })
      )}

      {error && (
        <div style={{ marginTop: 10, fontSize: 11, color: '#E05C3A' }}>{error}</div>
      )}

      {decided.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <span style={smallLabel}>Recent decisions</span>
          {decided.map((r) => (
            <div
              key={r.id}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '6px 0' }}
            >
              <div style={{ fontSize: 12, minWidth: 0 }}>
                {r.requester_name}
                <span style={{ color: '#A8B8C8' }}> · {r.relationship}</span>
                {r.status === 'approved' && r.granted_role ? <span style={{ color: '#A8B8C8' }}> · {r.granted_role}</span> : null}
              </div>
              <span
                style={{
                  fontFamily: T,
                  fontSize: 8.5,
                  padding: '3px 8px',
                  borderRadius: 7,
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
          ))}
        </div>
      )}
    </div>
  );
}
