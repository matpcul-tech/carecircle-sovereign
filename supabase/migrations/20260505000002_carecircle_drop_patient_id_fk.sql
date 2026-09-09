-- Migration: relax patient_id FKs on the Care Circle data screens.
--
-- 20260505000001 keyed every patient_id to auth.users(id). In practice
-- CareIQ patients are tracked in the careiq-os 'patients' table and do
-- not always have a matching auth.users row, so any INSERT into the
-- new tables (medications, medication_logs, appointments, care_tasks,
-- vault_files) fails the FK with code 23503:
--
--   insert or update on table "medications" violates foreign key
--   constraint "medications_patient_id_fkey"
--
-- care_circle is the single source of truth for which patients exist
-- from the family-app perspective, and RLS via is_patient_or_member()
-- already gates every read/write. The FK to auth.users provided no
-- additional security and was breaking real inserts, so drop it on
-- each of the five tables. patient_id remains uuid + not null +
-- indexed, and the RLS check is unchanged.

alter table public.medications     drop constraint if exists medications_patient_id_fkey;
alter table public.medication_logs drop constraint if exists medication_logs_patient_id_fkey;
alter table public.appointments    drop constraint if exists appointments_patient_id_fkey;
alter table public.care_tasks      drop constraint if exists care_tasks_patient_id_fkey;
alter table public.vault_files     drop constraint if exists vault_files_patient_id_fkey;
