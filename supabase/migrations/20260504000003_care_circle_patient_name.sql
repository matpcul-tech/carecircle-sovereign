-- Migration: add patient_name to care_circle
-- Lets the family member's session restore the patient name on login,
-- not just on first signup. Backfills existing rows from
-- care_circle_invites.patient_name when the linkage exists.

alter table public.care_circle
  add column if not exists patient_name text;

-- Backfill: for any existing care_circle row with an invite_id, copy
-- patient_name from the invite that created it.
update public.care_circle cc
  set patient_name = ci.patient_name
  from public.care_circle_invites ci
  where cc.invite_id = ci.id
    and cc.patient_name is null
    and ci.patient_name is not null;

notify pgrst, 'reload schema';
