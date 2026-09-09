/**
 * HIPAA audit-trail helper (§164.312(b)).
 *
 * Writes an append-only row into public.phi_access_log via the service role.
 * Used by the service-role API routes for the PHI flows that do not pass
 * through the client-writable clinical tables (whose mutations are captured
 * by database triggers instead): vault upload/download/delete, AI chat
 * queries, and outbound alert dispatch.
 *
 * Logging is best-effort: an audit-write failure is logged to the server
 * console but never fails the underlying request. (For a stricter posture,
 * callers can await the returned promise and treat a false result as fatal.)
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'download'
  | 'upload'
  | 'ai_query'
  | 'alert_sent';

export type AuditResource =
  | 'vault_file'
  | 'ai_chat'
  | 'alert';

export interface AuditEntry {
  patientId: string;
  action: AuditAction;
  resourceType: AuditResource;
  actorUserId?: string | null;
  actorRole?: string | null;
  resourceId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

/** Pull best-effort client context (ip, user-agent) from a request's headers. */
export function requestContext(headers: Headers): { ip: string | null; userAgent: string | null } {
  const ip =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    null;
  return { ip, userAgent: headers.get('user-agent') };
}

export async function logPhiAccess(entry: AuditEntry): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/phi_access_log`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify([
        {
          patient_id: entry.patientId,
          actor_user_id: entry.actorUserId ?? null,
          actor_role: entry.actorRole ?? null,
          action: entry.action,
          resource_type: entry.resourceType,
          resource_id: entry.resourceId ?? null,
          detail: entry.detail ?? {},
          source: 'api',
          ip: entry.ip ?? null,
          user_agent: entry.userAgent ?? null,
        },
      ]),
    });
    if (!r.ok) {
      console.error('[audit] write failed', r.status, (await r.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error('[audit] write threw', (e as Error).message);
    return false;
  }
}
