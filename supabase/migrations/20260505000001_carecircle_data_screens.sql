-- Migration: Care Circle data screens
-- Adds the tables that back the family-facing Meds, Calendar, Tasks,
-- and Vault tabs in care-os. Every row is keyed by patient_id and
-- protected by RLS so only the patient and their care_circle members
-- can read or mutate it.

create extension if not exists "pgcrypto";

----------------------------------------------------------------------
-- Helper used by every policy below.
--   - The patient themselves (auth.uid() = patient_id)
--   - OR an authenticated care_circle member of that patient.
-- security definer + bypass on care_circle is intentional so the
-- function does not recurse against care_circle's own RLS.
----------------------------------------------------------------------
create or replace function public.is_patient_or_member(p_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    auth.uid() = p_id
    or exists (
      select 1 from public.care_circle
      where patient_id = p_id
        and member_user_id = auth.uid()
    );
$$;

grant execute on function public.is_patient_or_member(uuid) to authenticated, anon;

----------------------------------------------------------------------
-- 1. medications
----------------------------------------------------------------------
create table if not exists public.medications (
  id                  uuid        primary key default gen_random_uuid(),
  patient_id          uuid        not null references auth.users(id) on delete cascade,
  name                text        not null,
  dose                text,
  frequency           text,
  time_of_day         text,
  prescribing_doctor  text,
  start_date          date,
  active              boolean     not null default true,
  created_by          uuid        references auth.users(id),
  created_at          timestamptz not null default now()
);

create index if not exists medications_patient_active_idx
  on public.medications (patient_id, active, created_at desc);

alter table public.medications enable row level security;

drop policy if exists "meds_select" on public.medications;
create policy "meds_select" on public.medications for select
  using (public.is_patient_or_member(patient_id));

drop policy if exists "meds_insert" on public.medications;
create policy "meds_insert" on public.medications for insert
  with check (public.is_patient_or_member(patient_id));

drop policy if exists "meds_update" on public.medications;
create policy "meds_update" on public.medications for update
  using (public.is_patient_or_member(patient_id))
  with check (public.is_patient_or_member(patient_id));

drop policy if exists "meds_delete" on public.medications;
create policy "meds_delete" on public.medications for delete
  using (public.is_patient_or_member(patient_id));

----------------------------------------------------------------------
-- 2. medication_logs (per-day "taken" checkboxes)
----------------------------------------------------------------------
create table if not exists public.medication_logs (
  id              uuid        primary key default gen_random_uuid(),
  medication_id   uuid        not null references public.medications(id) on delete cascade,
  patient_id      uuid        not null references auth.users(id) on delete cascade,
  taken_on        date        not null,
  taken_at        timestamptz not null default now(),
  taken_by        uuid        references auth.users(id)
);

create unique index if not exists medication_logs_med_day_uniq
  on public.medication_logs (medication_id, taken_on);

create index if not exists medication_logs_patient_day_idx
  on public.medication_logs (patient_id, taken_on desc);

alter table public.medication_logs enable row level security;

drop policy if exists "med_logs_select" on public.medication_logs;
create policy "med_logs_select" on public.medication_logs for select
  using (public.is_patient_or_member(patient_id));

drop policy if exists "med_logs_insert" on public.medication_logs;
create policy "med_logs_insert" on public.medication_logs for insert
  with check (public.is_patient_or_member(patient_id));

drop policy if exists "med_logs_delete" on public.medication_logs;
create policy "med_logs_delete" on public.medication_logs for delete
  using (public.is_patient_or_member(patient_id));

----------------------------------------------------------------------
-- 3. appointments
----------------------------------------------------------------------
create table if not exists public.appointments (
  id              uuid        primary key default gen_random_uuid(),
  patient_id      uuid        not null references auth.users(id) on delete cascade,
  title           text        not null,
  provider_name   text,
  location        text,
  appt_date       date        not null,
  appt_time       time,
  notes           text,
  created_by      uuid        references auth.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists appointments_patient_date_idx
  on public.appointments (patient_id, appt_date);

alter table public.appointments enable row level security;

drop policy if exists "appts_select" on public.appointments;
create policy "appts_select" on public.appointments for select
  using (public.is_patient_or_member(patient_id));

drop policy if exists "appts_insert" on public.appointments;
create policy "appts_insert" on public.appointments for insert
  with check (public.is_patient_or_member(patient_id));

drop policy if exists "appts_update" on public.appointments;
create policy "appts_update" on public.appointments for update
  using (public.is_patient_or_member(patient_id))
  with check (public.is_patient_or_member(patient_id));

drop policy if exists "appts_delete" on public.appointments;
create policy "appts_delete" on public.appointments for delete
  using (public.is_patient_or_member(patient_id));

----------------------------------------------------------------------
-- 4. care_tasks
----------------------------------------------------------------------
create table if not exists public.care_tasks (
  id              uuid        primary key default gen_random_uuid(),
  patient_id      uuid        not null references auth.users(id) on delete cascade,
  name            text        not null,
  assigned_to     uuid        references auth.users(id),
  due_date        date,
  priority        text        not null default 'medium' check (priority in ('high','medium','low')),
  notes           text,
  completed       boolean     not null default false,
  completed_at    timestamptz,
  completed_by    uuid        references auth.users(id),
  created_by      uuid        references auth.users(id),
  created_at      timestamptz not null default now()
);

create index if not exists care_tasks_patient_completed_idx
  on public.care_tasks (patient_id, completed, due_date);

alter table public.care_tasks enable row level security;

drop policy if exists "tasks_select" on public.care_tasks;
create policy "tasks_select" on public.care_tasks for select
  using (public.is_patient_or_member(patient_id));

drop policy if exists "tasks_insert" on public.care_tasks;
create policy "tasks_insert" on public.care_tasks for insert
  with check (public.is_patient_or_member(patient_id));

drop policy if exists "tasks_update" on public.care_tasks;
create policy "tasks_update" on public.care_tasks for update
  using (public.is_patient_or_member(patient_id))
  with check (public.is_patient_or_member(patient_id));

drop policy if exists "tasks_delete" on public.care_tasks;
create policy "tasks_delete" on public.care_tasks for delete
  using (public.is_patient_or_member(patient_id));

----------------------------------------------------------------------
-- 5. vault_files (encrypted document metadata)
--
-- Object payloads live in the storage bucket 'care-circle-vault' as
-- AES-256-GCM ciphertext. iv is the base64-encoded 12-byte IV. The
-- 16-byte GCM auth tag is appended to the ciphertext. The encryption
-- key is held server-side only (env: VAULT_KEY_HEX) and is applied
-- via /api/vault/* routes; clients never see the key or the bucket
-- directly. Rows are RLS-gated for read and delete from the client.
----------------------------------------------------------------------
create table if not exists public.vault_files (
  id              uuid        primary key default gen_random_uuid(),
  patient_id      uuid        not null references auth.users(id) on delete cascade,
  filename        text        not null,
  mime_type       text,
  size_bytes      bigint,
  storage_path    text        not null,
  iv              text        not null,
  uploaded_by     uuid        references auth.users(id),
  uploaded_at     timestamptz not null default now()
);

create index if not exists vault_files_patient_idx
  on public.vault_files (patient_id, uploaded_at desc);

alter table public.vault_files enable row level security;

drop policy if exists "vault_select" on public.vault_files;
create policy "vault_select" on public.vault_files for select
  using (public.is_patient_or_member(patient_id));

drop policy if exists "vault_delete" on public.vault_files;
create policy "vault_delete" on public.vault_files for delete
  using (public.is_patient_or_member(patient_id));

-- Inserts go through the upload API route (service_role); no client
-- INSERT policy is added on purpose.

----------------------------------------------------------------------
-- 6. care_circle: broaden member SELECT so the Tasks "assigned to"
--    dropdown can list the other members of the same patient's circle.
----------------------------------------------------------------------
drop policy if exists "care_circle_member_select_own" on public.care_circle;
drop policy if exists "care_circle_member_select_circle" on public.care_circle;
create policy "care_circle_member_select_circle"
  on public.care_circle
  for select
  using (public.is_patient_or_member(patient_id));

----------------------------------------------------------------------
-- 7. Storage bucket: care-circle-vault (private)
--
-- No storage.objects policies are added; default RLS denies clients,
-- and service_role bypasses RLS for the upload/download/delete API
-- routes.
----------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('care-circle-vault', 'care-circle-vault', false)
on conflict (id) do nothing;
