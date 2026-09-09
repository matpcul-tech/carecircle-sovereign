-- Migration: add patient_nickname column to care_circle.
--
-- Each family member can pick their own display name for the patient
-- ("Mom", "Grandma Mary", "Dad"). The column is per-row (per
-- member_user_id), so two siblings in the same care circle can use
-- different names. The column is nullable; the redeem route does not
-- populate it. The dashboard renders patient_nickname when set, then
-- falls back to patient_name from cc-session, then to "Your loved one".
--
-- The /api/circle/update-nickname endpoint writes this column. It
-- verifies the caller's Supabase JWT, extracts member_user_id, and
-- updates the matching care_circle row using service-role so the
-- existing RLS policies do not need a new UPDATE rule.

alter table public.care_circle
  add column if not exists patient_nickname text;

notify pgrst, 'reload schema';
