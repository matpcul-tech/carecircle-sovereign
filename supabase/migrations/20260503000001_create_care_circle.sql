-- Migration: create care_circle table
-- Stores Care Circle members (family/caregivers) attached to a patient
-- so health alerts can be routed to the right people.

create extension if not exists "pgcrypto";

create table if not exists public.care_circle (
  id           uuid        primary key default gen_random_uuid(),
  patient_id   uuid        not null references auth.users(id) on delete cascade,
  member_email text        not null,
  member_name  text        not null,
  relationship text        not null,
  alert_level  text        not null check (alert_level in ('critical', 'informational')),
  created_at   timestamptz not null default now()
);

create index if not exists care_circle_patient_id_idx
  on public.care_circle (patient_id);

create index if not exists care_circle_member_email_idx
  on public.care_circle (member_email);

-- One member email per patient (a person isn't added twice to the same circle).
create unique index if not exists care_circle_patient_member_unique_idx
  on public.care_circle (patient_id, lower(member_email));

alter table public.care_circle enable row level security;

-- Patients can read their own circle.
create policy "care_circle_select_own"
  on public.care_circle
  for select
  using (auth.uid() = patient_id);

-- Patients can add members to their own circle.
create policy "care_circle_insert_own"
  on public.care_circle
  for insert
  with check (auth.uid() = patient_id);

-- Patients can update their own circle members.
create policy "care_circle_update_own"
  on public.care_circle
  for update
  using (auth.uid() = patient_id)
  with check (auth.uid() = patient_id);

-- Patients can remove their own circle members.
create policy "care_circle_delete_own"
  on public.care_circle
  for delete
  using (auth.uid() = patient_id);

-- Service role bypasses RLS automatically, used by server routes
-- for fan-out alerting where auth.uid() is not the patient.
