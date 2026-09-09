import { NextRequest, NextResponse } from 'next/server';

/**
 * Shared fixed-window rate limiter, backed by the public.rate_limit_hit()
 * Postgres function so the limit holds across serverless/edge instances.
 *
 * Fail-open: if the limiter backend is unreachable or misconfigured, requests
 * are allowed through. Availability of the core flows is prioritized over
 * strict enforcement; the limiter is a mitigation, not the primary auth gate.
 */

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_ROLE = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export interface RateLimitRule {
  /** Stable prefix identifying the endpoint, e.g. "shield" or "redeem-post". */
  name: string;
  /** Max requests permitted per window. */
  max: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

/** Best-effort client IP from proxy headers; falls back to a shared bucket. */
export function clientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'noip'
  );
}

/**
 * Record one hit for `key` under `rule`. Returns true when the request is
 * allowed, false when the caller is over the limit. Never throws.
 */
export async function checkRateLimit(rule: RateLimitRule, key: string): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return true; // fail-open
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      body: JSON.stringify({
        p_key: `${rule.name}:${key}`,
        p_max: rule.max,
        p_window_seconds: rule.windowSeconds,
      }),
      cache: 'no-store',
    });
    if (!r.ok) return true; // fail-open on limiter error
    const allowed = (await r.json()) as unknown;
    return allowed !== false;
  } catch {
    return true; // fail-open on network error
  }
}

/**
 * Clear a counter (e.g. reset a per-email failed-login lockout after a
 * successful sign-in). Best-effort; never throws.
 */
export async function resetRateLimit(name: string, key: string): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/rate_limits?key=eq.${encodeURIComponent(`${name}:${key}`)}`,
      {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
        cache: 'no-store',
      },
    );
  } catch {
    /* ignore */
  }
}

/** Standard 429 response with a Retry-After hint, CORS-safe headers merged in. */
export function tooManyRequests(
  rule: RateLimitRule,
  extraHeaders: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(
    { error: 'rate limit exceeded, please slow down' },
    {
      status: 429,
      headers: { 'Retry-After': String(rule.windowSeconds), ...extraHeaders },
    },
  );
}
