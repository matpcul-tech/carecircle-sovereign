import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Same-origin proxy for the Health OS vitals endpoint.
 *
 * The dashboard used to call {HEALTH_OS_URL}/api/shield/decrypt straight
 * from the browser, which made vitals hostage to cross-origin plumbing:
 * a CORS misconfiguration, a domain redirect (apex -> www), or the domain
 * pointing at the wrong deployment all surface as an opaque
 * "Failed to fetch". Fetching server-side removes the browser from the
 * cross-origin path entirely; the member's bearer token is forwarded and
 * the Health OS still enforces authentication and circle membership.
 *
 * If the configured Health OS URL does not serve the endpoint (a 404 or a
 * network error — e.g. the custom domain is attached to an older project),
 * the canonical Vercel URL of the Health OS project is tried as a fallback
 * so a domain misconfiguration degrades gracefully instead of blanking the
 * dashboard.
 */

const PRIMARY = (process.env.NEXT_PUBLIC_HEALTH_OS_URL || 'https://sovereignhealthcareos.com').replace(/\/$/, '');
const FALLBACK = (process.env.HEALTH_OS_FALLBACK_URL || 'https://chikashahealthcareos.vercel.app').replace(/\/$/, '');

async function upstream(base: string, auth: string): Promise<Response | null> {
  try {
    return await fetch(`${base}/api/shield/decrypt`, {
      headers: { Authorization: auth },
      cache: 'no-store',
      redirect: 'follow',
    });
  } catch {
    return null;
  }
}

/** A usable answer is JSON from the endpoint itself — even an auth error. */
function usable(r: Response | null): r is Response {
  if (!r) return false;
  if (r.status === 404) return false;
  return (r.headers.get('content-type') || '').includes('application/json');
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }

  let r = await upstream(PRIMARY, auth);
  let via = PRIMARY;
  if (!usable(r) && FALLBACK !== PRIMARY) {
    r = await upstream(FALLBACK, auth);
    via = FALLBACK;
  }
  if (!usable(r)) {
    return NextResponse.json(
      { error: `Health OS unreachable at ${PRIMARY}` },
      { status: 502 },
    );
  }

  const body = await r.text();
  return new NextResponse(body, {
    status: r.status,
    headers: { 'content-type': 'application/json', 'x-healthos-via': via },
  });
}
