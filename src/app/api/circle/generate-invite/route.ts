import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'edge';

const RATE_LIMIT = { name: 'generate-invite', max: 20, windowSeconds: 60 };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://care-os-uo7x.vercel.app';

const ALERT_LEVELS = ['critical', 'informational'] as const;
type AlertLevel = (typeof ALERT_LEVELS)[number];

const CARE_ROLES = ['admin', 'caregiver', 'viewer'] as const;
type CareRole = (typeof CARE_ROLES)[number];

// Unambiguous alphabet — no 0/O/1/I.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

interface GenerateInviteBody {
  patient_name?: string;
  suggested_relationship?: string;
  suggested_alert_level?: string;
  suggested_role?: string;
  expires_in_days?: number;
}

interface SupabaseUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown> | null;
}

// CareIQ may live on a different origin — keep CORS open for trusted clients.
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: CORS_HEADERS });
}

function generateCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

async function getUserFromAuthHeader(req: NextRequest): Promise<SupabaseUser | null> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;

  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!r.ok) return null;
  return (await r.json()) as SupabaseUser;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromAuthHeader(req);
    if (!user) return bad('authentication required', 401);

    if (!(await checkRateLimit(RATE_LIMIT, user.id))) {
      return bad('rate limit exceeded, please slow down', 429);
    }

    let body: GenerateInviteBody = {};
    try {
      body = (await req.json()) as GenerateInviteBody;
    } catch {
      // body is optional
    }

    const suggested_relationship = body.suggested_relationship?.trim() || null;

    const rawLevel = (body.suggested_alert_level || 'informational').trim();
    if (!ALERT_LEVELS.includes(rawLevel as AlertLevel)) {
      return bad('suggested_alert_level must be "critical" or "informational"');
    }
    const suggested_alert_level = rawLevel as AlertLevel;

    // Optional least-privilege role the family member will receive on redeem.
    const rawRole = (body.suggested_role || 'caregiver').trim();
    if (!CARE_ROLES.includes(rawRole as CareRole)) {
      return bad('suggested_role must be "admin", "caregiver", or "viewer"');
    }
    const suggested_role = rawRole as CareRole;

    const meta = (user.user_metadata || {}) as Record<string, unknown>;
    const patient_name =
      body.patient_name?.trim() ||
      (typeof meta.full_name === 'string' ? meta.full_name : null) ||
      (typeof meta.name === 'string' ? meta.name : null) ||
      null;

    const expires_in_days = Math.min(Math.max(body.expires_in_days ?? 7, 1), 30);
    const expires_at = new Date(Date.now() + expires_in_days * 86_400_000).toISOString();

    // Retry on the (vanishingly rare) code collision; bail on any other error.
    let invite: Record<string, unknown> | null = null;
    let lastError = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = generateCode();
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/care_circle_invites`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          Prefer: 'return=representation',
        },
        body: JSON.stringify([
          {
            code,
            patient_id: user.id,
            patient_name,
            suggested_relationship,
            suggested_alert_level,
            suggested_role,
            expires_at,
          },
        ]),
      });

      if (insertRes.ok) {
        const rows = (await insertRes.json()) as Array<Record<string, unknown>>;
        invite = rows[0];
        break;
      }

      const txt = await insertRes.text();
      lastError = `Supabase ${insertRes.status}: ${txt}`;
      const isCodeCollision =
        txt.includes('care_circle_invites_code_key') ||
        (insertRes.status === 409 && txt.includes('code'));
      if (!isCodeCollision) {
        return bad(lastError, 500);
      }
    }

    if (!invite) return bad(lastError || 'failed to generate invite', 500);

    const code = invite.code as string;
    return NextResponse.json(
      {
        invite,
        code,
        signup_url: `${APP_URL}/signup?code=${code}`,
        expires_at,
      },
      { headers: CORS_HEADERS },
    );
  } catch {
    return bad('Internal error', 500);
  }
}
