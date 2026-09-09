import { NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

export type CareRole = 'admin' | 'caregiver' | 'viewer';

export interface VaultAuthOk {
  ok: true;
  userId: string;
  patientId: string;
  role: CareRole;
  accessToken: string;
}
export interface VaultAuthDeny {
  ok: false;
  status: number;
  message: string;
}
export type VaultAuthResult = VaultAuthOk | VaultAuthDeny;

// Vault capability tiers, kept in lockstep with the SQL cc_can_* functions.
export const canReadVault = (role: CareRole) => role === 'admin' || role === 'caregiver';
export const canWriteVault = (role: CareRole) => role === 'admin' || role === 'caregiver';
export const canDeleteVault = (role: CareRole) => role === 'admin';

/**
 * Authorize a vault API call. Verifies the Supabase Bearer token,
 * resolves the calling user's care_circle row, and returns the
 * patient_id whose vault they may operate on.
 */
export async function authVault(req: NextRequest): Promise<VaultAuthResult> {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    return { ok: false, status: 500, message: "server misconfigured" };
  }

  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) return { ok: false, status: 401, message: "missing authorization" };
  const token = m[1].trim();
  if (!token) return { ok: false, status: 401, message: "missing authorization" };

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!userRes.ok) return { ok: false, status: 401, message: "invalid token" };
  const user = (await userRes.json()) as { id: string };

  const ccRes = await fetch(
    `${SUPABASE_URL}/rest/v1/care_circle?member_user_id=eq.${user.id}&select=patient_id,care_role&limit=1`,
    {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      cache: "no-store",
    },
  );
  if (!ccRes.ok) {
    return { ok: false, status: 500, message: "care_circle lookup failed" };
  }
  const rows = (await ccRes.json()) as Array<{ patient_id: string; care_role?: string }>;
  if (rows.length === 0) {
    return { ok: false, status: 403, message: "no care circle membership" };
  }

  const role: CareRole =
    rows[0].care_role === "admin" || rows[0].care_role === "viewer"
      ? rows[0].care_role
      : "caregiver";

  return { ok: true, userId: user.id, patientId: rows[0].patient_id, role, accessToken: token };
}

/**
 * Same as authVault but additionally verifies the file id belongs to
 * the calling user's patient. Used by download and delete routes.
 */
export async function authVaultForFile(
  req: NextRequest,
  fileId: string,
): Promise<VaultAuthResult> {
  const auth = await authVault(req);
  if (!auth.ok) return auth;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/vault_files?id=eq.${encodeURIComponent(fileId)}&select=patient_id&limit=1`,
    {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      cache: "no-store",
    },
  );
  if (!r.ok) return { ok: false, status: 500, message: "vault lookup failed" };
  const rows = (await r.json()) as Array<{ patient_id: string }>;
  if (rows.length === 0) return { ok: false, status: 404, message: "not found" };
  if (rows[0].patient_id !== auth.patientId) {
    return { ok: false, status: 403, message: "forbidden" };
  }
  return auth;
}
