-- Migration: fixed-window rate limiting for abuse-prone API routes.
--
-- The care-os API routes run on serverless/edge instances with no shared
-- memory, so an in-process counter cannot bound abuse across instances. This
-- table + function provide a shared, atomic fixed-window limiter that the
-- routes call via PostgREST RPC (see src/lib/rate-limit.ts). Used to blunt:
--   * /api/shield        AI cost abuse
--   * /api/circle/redeem invite-code brute forcing
--   * /api/circle/*      unauthenticated-ish add/list floods
--   * /api/alerts        alert-dispatch floods
--
-- Keys are opaque strings the caller builds (e.g. "shield:<user_id>" or
-- "redeem-get:<ip>"). Old rows are harmless; a periodic cleanup of stale
-- windows can be added later if the table grows.

create table if not exists public.rate_limits (
  key          text        primary key,
  window_start timestamptz not null default now(),
  count        integer     not null default 0
);

alter table public.rate_limits enable row level security;
-- No client policies on purpose: only the service role (RLS bypass) and the
-- security-definer function below ever touch this table.

-- Atomic fixed-window limiter. Returns true when the call is ALLOWED, false
-- when the caller has exceeded p_max hits inside the current
-- p_window_seconds window. The whole read-modify-write is one statement, so
-- concurrent hits on the same key cannot race past the limit.
create or replace function public.rate_limit_hit(
  p_key text,
  p_max integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now   timestamptz := now();
  v_count integer;
begin
  insert into public.rate_limits as rl (key, window_start, count)
    values (p_key, v_now, 1)
  on conflict (key) do update
    set
      count = case
        when rl.window_start < v_now - make_interval(secs => p_window_seconds)
          then 1
          else rl.count + 1
        end,
      window_start = case
        when rl.window_start < v_now - make_interval(secs => p_window_seconds)
          then v_now
          else rl.window_start
        end
  returning rl.count into v_count;

  return v_count <= p_max;
end;
$$;

grant execute on function public.rate_limit_hit(text, integer, integer)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
