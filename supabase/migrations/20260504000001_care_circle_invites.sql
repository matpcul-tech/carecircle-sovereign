-- Migration: Care Circle invite-code system
--
-- Model: the CareIQ patient generates a unique invite code tied to their
-- auth.uid(). A family member visits care-os, enters the code, and signs
-- up — server-side redemption links the new family-member auth account to
-- the patient via a care_circle row. Family members are NOT patients.

create extension if not exists "pgcrypto";

----------------------------------------------------------------------
-- 1. care_circle_invites
----------------------------------------------------------------------

create table if not exists public.care_circle_invites (
  id                     uuid        primary key default gen_random_uuid(),
  code                   text        not null unique,
  patient_id             uuid        not null references auth.users(id) on delete cascade,
  patient_name           text,
  suggested_relationship text,
  suggested_alert_level  text        check (suggested_alert_level in ('critical', 'informational')),
  created_at             timestamptz not null default now(),
  expires_at             timestamptz not null default (now() + interval '7 days'),
  used_at                timestamptz,
  used_by                uuid        references auth.users(id) on delete set null,
  revoked_at             timestamptz
);

create index if not exists care_circle_invites_code_idx
  on public.care_circle_invites (code);

create index if not exists care_circle_invites_patient_idx
  on public.care_circle_invites (patient_id);

alter table public.care_circle_invites enable row level security;

-- Patients (CareIQ users) manage their own invite codes.
create policy "invites_select_own"
  on public.care_circle_invites
  for select
  using (auth.uid() = patient_id);

create policy "invites_insert_own"
  on public.care_circle_invites
  for insert
  with check (auth.uid() = patient_id);

create policy "invites_update_own"
  on public.care_circle_invites
  for update
  using (auth.uid() = patient_id)
  with check (auth.uid() = patient_id);

create policy "invites_delete_own"
  on public.care_circle_invites
  for delete
  using (auth.uid() = patient_id);

-- Anonymous validation and redemption happens server-side via the service
-- role (RLS bypass), since the family member is not yet authenticated when
-- they enter a code. No anon SELECT policy is needed.

----------------------------------------------------------------------
-- 2. care_circle: link to the family-member auth account
----------------------------------------------------------------------

alter table public.care_circle
  add column if not exists member_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists member_phone   text,
  add column if not exists invite_id      uuid references public.care_circle_invites(id) on delete set null;

create index if not exists care_circle_member_user_id_idx
  on public.care_circle (member_user_id);

-- Family members can read their own circle row(s). They use this to look up
-- the patient_id their dashboard should display.
drop policy if exists "care_circle_member_select_own" on public.care_circle;
create policy "care_circle_member_select_own"
  on public.care_circle
  for select
  using (auth.uid() = member_user_id);

-- Family members can update their own contact details (e.g. phone for SMS).
drop policy if exists "care_circle_member_update_own" on public.care_circle;
create policy "care_circle_member_update_own"
  on public.care_circle
  for update
  using (auth.uid() = member_user_id)
  with check (auth.uid() = member_user_id);

----------------------------------------------------------------------
-- 3. Helper: short, unambiguous, URL-safe invite code generator
----------------------------------------------------------------------
-- 8-char codes drawn from a 32-char alphabet (no 0/O/1/I to avoid confusion).
-- Patient_id + UNIQUE constraint on code guarantees collision safety;
-- the loop below retries on the rare collision.
create or replace function public.generate_care_circle_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet  constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  exists_already boolean;
  i int;
begin
  loop
    candidate := '';
    for i in 1..8 loop
      candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    select exists(select 1 from public.care_circle_invites where code = candidate)
      into exists_already;
    exit when not exists_already;
  end loop;
  return candidate;
end;
$$;
