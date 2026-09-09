-- Migration: family-initiated access requests (CareCircle Sovereign Edition).
--
-- care-os only supports patient-initiated invites: the patient generates a
-- code and a family member redeems it. For Chickasaw families the common
-- path runs the other way: a family member asks for access to the elder's
-- Chikasha Health OS record and the elder approves. The patient is a
-- Supabase auth user in the Health OS project (care_circle.patient_id is
-- their auth uid), so this app must run against the Health OS Supabase
-- project for these references to resolve.
--
-- Rows are written and deleted only by the service-role API routes
-- (/api/circle/request-access and /decide). There is deliberately NO insert
-- or delete policy: the patient lookup by email happens server-side and the
-- route returns the same neutral response whether or not the email belongs
-- to a patient, so account existence is never leaked to the requester.

create extension if not exists "pgcrypto";

create table if not exists public.care_circle_access_requests (
  id                 uuid        primary key default gen_random_uuid(),
  patient_id         uuid        not null references auth.users(id) on delete cascade,
  patient_name       text,
  requester_user_id  uuid        not null references auth.users(id) on delete cascade,
  requester_email    text        not null,
  requester_name     text        not null,
  requester_phone    text,
  relationship       text        not null,
  message            text,
  status             text        not null default 'pending'
                       check (status in ('pending', 'approved', 'denied', 'cancelled')),
  granted_role       text        check (granted_role in ('admin', 'caregiver', 'viewer')),
  granted_alert      text        check (granted_alert in ('critical', 'informational')),
  decided_by         uuid        references auth.users(id) on delete set null,
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null default (now() + interval '30 days')
);

create index if not exists care_circle_access_requests_patient_status_idx
  on public.care_circle_access_requests (patient_id, status);

create index if not exists care_circle_access_requests_requester_status_idx
  on public.care_circle_access_requests (requester_user_id, status);

-- One open request per requester per patient. Approved or denied history
-- rows can accumulate; only the pending one is unique.
create unique index if not exists care_circle_access_requests_pending_unique_idx
  on public.care_circle_access_requests (patient_id, requester_user_id)
  where status = 'pending';

alter table public.care_circle_access_requests enable row level security;

-- The patient, or an admin of the patient's circle, sees every request
-- addressed to that patient.
drop policy if exists "access_requests_select_patient_or_admin" on public.care_circle_access_requests;
create policy "access_requests_select_patient_or_admin"
  on public.care_circle_access_requests
  for select
  using (auth.uid() = patient_id or public.cc_role(patient_id) = 'admin');

-- The requester sees their own requests.
drop policy if exists "access_requests_select_requester" on public.care_circle_access_requests;
create policy "access_requests_select_requester"
  on public.care_circle_access_requests
  for select
  using (auth.uid() = requester_user_id);

-- The patient or a circle admin decides.
drop policy if exists "access_requests_update_patient_or_admin" on public.care_circle_access_requests;
create policy "access_requests_update_patient_or_admin"
  on public.care_circle_access_requests
  for update
  using (auth.uid() = patient_id or public.cc_role(patient_id) = 'admin')
  with check (auth.uid() = patient_id or public.cc_role(patient_id) = 'admin');

-- The requester may only withdraw a request that is still pending.
drop policy if exists "access_requests_update_requester_cancel" on public.care_circle_access_requests;
create policy "access_requests_update_requester_cancel"
  on public.care_circle_access_requests
  for update
  using (auth.uid() = requester_user_id and status = 'pending')
  with check (auth.uid() = requester_user_id and status = 'cancelled');

-- No insert or delete policies: service-role routes only.

notify pgrst, 'reload schema';
