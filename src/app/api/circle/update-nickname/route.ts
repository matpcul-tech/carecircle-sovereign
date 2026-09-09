import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'edge';

const RATE_LIMIT = { name: 'update-nickname', max: 30, windowSeconds: 60 };

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

interface UpdateBody {
  nickname?: string | null;
}

function bad(message: string, status = 400, debug?: unknown) {
  const body: Record<string, unknown> = { error: message };
  if (debug !== undefined) body.debug = debug;
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

function bearerToken(req: NextRequest): string {
  const auth = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : '';
}

async function getUserId(token: string): Promise<string | null> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { id?: string };
  return typeof data.id === 'string' ? data.id : null;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE) {
    return bad('server misconfigured', 500);
  }

  const token = bearerToken(req);
  if (!token) return bad('authentication required', 401);

  const userId = await getUserId(token);
  if (!userId) return bad('authentication required', 401);

  if (!(await checkRateLimit(RATE_LIMIT, userId))) {
    return bad('rate limit exceeded, please slow down', 429);
  }

  let body: UpdateBody;
  try {
    body = (await req.json()) as UpdateBody;
  } catch {
    return bad('invalid json body');
  }

  // Trim, cap at 60 chars, normalize empty to null. The 60-char ceiling
  // protects every downstream display surface (header, vitals card,
  // alert subjects).
  const raw = (body.nickname ?? '').toString();
  const trimmed = raw.trim().slice(0, 60);
  const nickname = trimmed.length > 0 ? trimmed : null;

  // PATCH the family member's care_circle row. We use service-role so
  // the existing RLS policies do not need a new UPDATE rule for this
  // column. The where-clause restricts to the authenticated user's own
  // member_user_id, so a member can only update their own nickname.
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/care_circle?member_user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ patient_nickname: nickname }),
    },
  );

  if (!r.ok) {
    const t = await r.text();
    console.error('[update-nickname] supabase', r.status, t.slice(0, 240));
    return bad('update failed', 502, {
      supabase_status: r.status,
      supabase_body: t.slice(0, 240),
    });
  }

  const rows = (await r.json()) as Array<{ patient_nickname: string | null }>;
  if (rows.length === 0) {
    return bad('no care_circle row found for this member', 404);
  }

  return NextResponse.json(
    { ok: true, nickname: rows[0].patient_nickname },
    { headers: CORS_HEADERS },
  );
}
