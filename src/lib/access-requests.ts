/**
 * Shared shapes for family-initiated access requests. Client-safe: no
 * server imports, used by the request-access page, the Family page card,
 * and the API routes.
 */

export const ACCESS_REQUEST_RELATIONSHIPS = [
  'Spouse',
  'Daughter',
  'Son',
  'Parent',
  'Sibling',
  'Grandchild',
  'Niece/Nephew',
  'Caregiver',
  'Home Health Aide',
  'Friend',
  'Other',
] as const;

export type AccessRequestStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

export interface AccessRequestRow {
  id: string;
  patient_id: string;
  patient_name: string | null;
  requester_user_id: string;
  requester_email: string;
  requester_name: string;
  requester_phone: string | null;
  relationship: string;
  message: string | null;
  status: AccessRequestStatus;
  granted_role: 'admin' | 'caregiver' | 'viewer' | null;
  granted_alert: 'critical' | 'informational' | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  expires_at: string;
}

/** Session parked in localStorage while a request is waiting for approval. */
export interface PendingSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user_id: string;
}

export const STATUS_LABEL: Record<AccessRequestStatus, string> = {
  pending: 'Waiting for approval',
  approved: 'Approved',
  denied: 'Denied',
  cancelled: 'Withdrawn',
};

export const STATUS_COLOR: Record<AccessRequestStatus, string> = {
  pending: '#C07941',
  approved: '#4ade80',
  denied: '#E05C3A',
  cancelled: '#A8B8C8',
};
