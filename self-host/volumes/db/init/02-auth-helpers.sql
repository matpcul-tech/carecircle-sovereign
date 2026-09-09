-- Backstop for the JWT helper functions the app's RLS relies on
-- (public.cc_role(), is_patient_or_member(), every policy calls auth.uid()).
-- Recent Supabase Postgres images already define these; `create or replace`
-- makes this a safe no-op if so, and a fix-up if not.

create schema if not exists auth;

-- PostgREST sets the `request.jwt.claims` GUC (JSON) from the verified token.
-- Support both the modern JSON GUC and the legacy per-claim GUCs.
create or replace function auth.uid() returns uuid
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create or replace function auth.role() returns text
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

create or replace function auth.email() returns text
  language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
  );
$$;

create or replace function auth.jwt() returns jsonb
  language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb;
$$;

-- Let the app roles reference the auth schema (and thus auth.uid()). Guarded
-- so it doesn't fail before the roles exist on some image versions.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant usage on schema auth to anon';
    execute 'grant usage on schema auth to authenticated';
    execute 'grant usage on schema auth to service_role';
  end if;
  -- Ensure PostgREST's login role can assume the request roles.
  if exists (select 1 from pg_roles where rolname = 'authenticator')
     and exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant anon, authenticated, service_role to authenticator';
  end if;
end $$;
