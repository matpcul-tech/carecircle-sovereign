-- Migration: role-scoped access for Care Circle members (HIPAA minimum-necessary).
--
-- Before this migration every care_circle member had identical, full
-- read/write/DELETE access to all of a patient's clinical data and documents
-- via is_patient_or_member(). That violates the minimum-necessary principle:
-- a read-only viewer or a limited caregiver should not be able to delete
-- medications or open the document vault.
--
-- We introduce three roles on care_circle.care_role:
--   admin     - full read / write / delete; full vault access. (Also the
--               patient themselves, implicitly.)
--   caregiver - read everything; create/update clinical records; read + upload
--               vault documents. Cannot delete records or delete vault files.
--   viewer    - read-only on clinical records; NO vault access. Can still read
--               and post family messages (handled by is_patient_or_member).
--
-- Capability functions below are the single source of truth and are used by
-- both the RLS policies here and the service-role API routes in code.

----------------------------------------------------------------------
-- 1. care_role column (+ grandfather existing members to admin)
----------------------------------------------------------------------
-- Guarded in a DO block so the one-time grandfather UPDATE cannot re-run and
-- clobber roles if the migration is replayed.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'care_circle'
      and column_name = 'care_role'
  ) then
    alter table public.care_circle
      add column care_role text not null default 'caregiver'
      check (care_role in ('admin', 'caregiver', 'viewer'));
    -- Everyone who joined before role-scoping keeps their current (full)
    -- access. New members default to 'caregiver' unless the invite/redeem
    -- flow assigns otherwise.
    update public.care_circle set care_role = 'admin';
  end if;
end $$;

-- Let the patient suggest a role when generating an invite.
alter table public.care_circle_invites
  add column if not exists suggested_role text
  check (suggested_role in ('admin', 'caregiver', 'viewer'));

----------------------------------------------------------------------
-- 2. Capability functions
----------------------------------------------------------------------
-- Resolve the caller's effective role for a patient: 'admin' if they ARE the
-- patient, else their care_circle role, else null (unrelated). security
-- definer so it does not recurse against care_circle's own RLS.
create or replace function public.cc_role(p_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select case
    when auth.uid() = p_id then 'admin'
    else (
      select care_role
      from public.care_circle
      where patient_id = p_id
        and member_user_id = auth.uid()
      order by case care_role
        when 'admin' then 0 when 'caregiver' then 1 else 2 end
      limit 1
    )
  end;
$$;

create or replace function public.cc_can_read(p_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.cc_role(p_id) in ('admin', 'caregiver', 'viewer');
$$;

create or replace function public.cc_can_write(p_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.cc_role(p_id) in ('admin', 'caregiver');
$$;

create or replace function public.cc_can_delete(p_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.cc_role(p_id) = 'admin';
$$;

create or replace function public.cc_can_read_vault(p_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.cc_role(p_id) in ('admin', 'caregiver');
$$;

create or replace function public.cc_can_delete_vault(p_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select public.cc_role(p_id) = 'admin';
$$;

grant execute on function public.cc_role(uuid) to authenticated, anon;
grant execute on function public.cc_can_read(uuid) to authenticated, anon;
grant execute on function public.cc_can_write(uuid) to authenticated, anon;
grant execute on function public.cc_can_delete(uuid) to authenticated, anon;
grant execute on function public.cc_can_read_vault(uuid) to authenticated, anon;
grant execute on function public.cc_can_delete_vault(uuid) to authenticated, anon;

----------------------------------------------------------------------
-- 3. Rewrite RLS: split the single is_patient_or_member() gate into
--    read / write / delete tiers per table.
----------------------------------------------------------------------

-- medications
drop policy if exists "meds_select" on public.medications;
drop policy if exists "meds_insert" on public.medications;
drop policy if exists "meds_update" on public.medications;
drop policy if exists "meds_delete" on public.medications;
create policy "meds_select" on public.medications for select using (public.cc_can_read(patient_id));
create policy "meds_insert" on public.medications for insert with check (public.cc_can_write(patient_id));
create policy "meds_update" on public.medications for update using (public.cc_can_write(patient_id)) with check (public.cc_can_write(patient_id));
create policy "meds_delete" on public.medications for delete using (public.cc_can_delete(patient_id));

-- medication_logs (a per-day "taken" tick is a routine write, so caregivers
-- may add and remove them; only reads are gated by cc_can_read)
drop policy if exists "med_logs_select" on public.medication_logs;
drop policy if exists "med_logs_insert" on public.medication_logs;
drop policy if exists "med_logs_delete" on public.medication_logs;
create policy "med_logs_select" on public.medication_logs for select using (public.cc_can_read(patient_id));
create policy "med_logs_insert" on public.medication_logs for insert with check (public.cc_can_write(patient_id));
create policy "med_logs_delete" on public.medication_logs for delete using (public.cc_can_write(patient_id));

-- appointments
drop policy if exists "appts_select" on public.appointments;
drop policy if exists "appts_insert" on public.appointments;
drop policy if exists "appts_update" on public.appointments;
drop policy if exists "appts_delete" on public.appointments;
create policy "appts_select" on public.appointments for select using (public.cc_can_read(patient_id));
create policy "appts_insert" on public.appointments for insert with check (public.cc_can_write(patient_id));
create policy "appts_update" on public.appointments for update using (public.cc_can_write(patient_id)) with check (public.cc_can_write(patient_id));
create policy "appts_delete" on public.appointments for delete using (public.cc_can_delete(patient_id));

-- care_tasks
drop policy if exists "tasks_select" on public.care_tasks;
drop policy if exists "tasks_insert" on public.care_tasks;
drop policy if exists "tasks_update" on public.care_tasks;
drop policy if exists "tasks_delete" on public.care_tasks;
create policy "tasks_select" on public.care_tasks for select using (public.cc_can_read(patient_id));
create policy "tasks_insert" on public.care_tasks for insert with check (public.cc_can_write(patient_id));
create policy "tasks_update" on public.care_tasks for update using (public.cc_can_write(patient_id)) with check (public.cc_can_write(patient_id));
create policy "tasks_delete" on public.care_tasks for delete using (public.cc_can_delete(patient_id));

-- vault_files: viewers get no vault access at all; only admins may delete.
-- (Upload/download/delete of the encrypted payload also go through the
-- service-role API routes, which enforce the same tiers in code.)
drop policy if exists "vault_select" on public.vault_files;
drop policy if exists "vault_delete" on public.vault_files;
create policy "vault_select" on public.vault_files for select using (public.cc_can_read_vault(patient_id));
create policy "vault_delete" on public.vault_files for delete using (public.cc_can_delete_vault(patient_id));

notify pgrst, 'reload schema';
