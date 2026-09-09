import { NextRequest } from 'next/server';

/**
 * Shared authentication/authorization helpers for the edge API routes.
 *
 * These routes talk to Supabase with the service-role key (RLS bypass), so
 * they MUST enforce access control themselves — the database will not do it
 * for them. `getUserId` verifies a caller's Supabase JWT; `isPatientOrMember`
 * mirrors the SQL is_patient_or_member() policy used by the RLS-gated tables:
 * the caller is authorized for a patient if they ARE that patient (their
 * auth.uid() equals patient_id) or they hold a care_circle membership row
 * linking them to that patient.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export function bearerToken(req: NextRequest): string {
  const auth =
    req.headers.get('authorization') || req.headers.get('Authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : '';
}

/** Verify a Supabase access token and return the user id, or null. */
export async function getUserId(token: string): Promise<string | null> {
  if (!token || !SUPABASE_URL || !ANON_KEY) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { id?: string };
  return typeof data.id === 'string' && data.id ? data.id : null;
}

/**
 * True when `userId` is the patient themselves or an authenticated
 * care_circle member of that patient. Uses the service role so the lookup
 * is not itself subject to RLS. Fails closed on any error.
 */
export async function isPatientOrMember(
  userId: string,
  patientId: string,
): Promise<boolean> {
  if (!userId || !patientId) return false;
  if (userId === patientId) return true;
  if (!SUPABASE_URL || !SERVICE_ROLE) return false;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/care_circle` +
      `?patient_id=eq.${encodeURIComponent(patientId)}` +
      `&member_user_id=eq.${encodeURIComponent(userId)}` +
      `&select=id&limit=1`,
    {
      headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      cache: 'no-store',
    },
  );
  if (!r.ok) return false;
  const rows = (await r.json()) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}
