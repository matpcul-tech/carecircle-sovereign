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
 * cross-origin path; the member's bearer token is forwarded and the
 * Health OS still enforces authentication and circle membership.
 *
 * Redirects are followed MANUALLY, re-attaching the Authorization header
 * at each hop: fetch's automatic follow strips Authorization on a
 * cross-origin redirect, so an apex->www bounce silently de-authenticates
 * the request and every vitals call 401s. Hops are capped and the header
 * is only re-sent to hosts we were redirected to by our own Health OS
 * domain chain.
 *
 * If the configured Health OS URL does not yield a usable, authenticated
 * answer (network error, 404, or a 401 - which is also what an outdated
 * deployment's cookie gate returns), the canonical Vercel URL of the
 * Health OS project is tried so a domain misconfiguration degrades
 * gracefully instead of blanking the dashboard.
 */

const PRIMARY = (process.env.NEXT_PUBLIC_HEALTH_OS_URL || 'https://sovereignhealthcareos.com').replace(/\/$/, '');
const FALLBACK = (process.env.HEALTH_OS_FALLBACK_URL || 'https://chikashahealthcareos.vercel.app').replace(/\/$/, '');
const MAX_HOPS = 4;

async function fetchFollowingRedirects(base: string, auth: string): Promise<Response | null> {
  let url = `${base}/api/shield/decrypt`;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let r: Response;
    try {
      r = await fetch(url, {
        headers: { Authorization: auth },
        cache: 'no-store',
        redirect: 'manual',
      });
    } catch {
      return null;
    }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return r;
      url = new URL(loc, url).toString();
      continue;
    }
    return r;
  }
  return null;
}

/** JSON from the endpoint itself, not a redirect loop or a missing route. */
function usable(r: Response | null): r is Response {
  if (!r) return false;
  if (r.status === 404 || (r.status >= 300 && r.status < 400)) return false;
  return (r.headers.get('content-type') || '').includes('application/json');
}

async function respond(r: Response, via: string): Promise<NextResponse> {
  const body = await r.text();
  return new NextResponse(body, {
    status: r.status,
    headers: { 'content-type': 'application/json', 'x-healthos-via': via },
  });
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'authentication required' }, { status: 401 });
  }

  const primary = await fetchFollowingRedirects(PRIMARY, auth);
  if (usable(primary) && primary.ok) return respond(primary, PRIMARY);

  // Primary answered with an error (or not at all): a 401 here can just as
  // easily be an outdated deployment's cookie gate as a bad token, so give
  // the canonical project URL a chance before passing an error through.
  if (FALLBACK !== PRIMARY) {
    const fallback = await fetchFollowingRedirects(FALLBACK, auth);
    if (usable(fallback)) return respond(fallback, FALLBACK);
  }

  if (usable(primary)) return respond(primary, PRIMARY);
  return NextResponse.json({ error: `Health OS unreachable at ${PRIMARY}` }, { status: 502 });
}
