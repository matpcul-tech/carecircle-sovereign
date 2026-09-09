-- Migration: backfill care_circle.patient_name from auth.users metadata.
--
-- The earlier 20260504000003 migration backfilled care_circle.patient_name
-- from care_circle_invites.patient_name, but that no-opped because the
-- invites themselves were also written with patient_name=null. The root
-- cause is in the CareIQ InviteFamilyModal, which posted to
-- /api/circle/generate-invite without a patient_name in the body.
--
-- CareIQ stores the patient profile in patients.profile_encrypted
-- (AES-256-GCM, keyed with VAULT_KEY_HEX which only CareIQ has), so the
-- patients table has no plaintext name we can read here. The patient is
-- also a Supabase auth user (CareIQ schema: patients.id = auth.uid()),
-- and CareIQ onboarding writes the patient's name into
-- auth.users.raw_user_meta_data, so that is the plaintext source we use
-- for the backfill.
--
-- Resolution order matches the runtime fallback in
-- src/app/api/circle/redeem/route.ts (resolvePatientName):
--   1. raw_user_meta_data->>'full_name'
--   2. raw_user_meta_data->>'name'
--   3. raw_user_meta_data->>'first_name' + 'last_name'
--   4. email local-part (last resort)
--
-- Two tables are touched:
--   public.care_circle           every member row that joined when the
--                                redeem route still propagated null.
--   public.care_circle_invites   any invite that was created before
--                                CareIQ started sending patient_name.
--                                We only backfill rows that are still
--                                usable (not used, not revoked) so the
--                                history of completed signups stays
--                                immutable.

update public.care_circle cc
  set patient_name = coalesce(
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(u.raw_user_meta_data->>'name'), ''),
    nullif(
      trim(
        concat_ws(' ',
          u.raw_user_meta_data->>'first_name',
          u.raw_user_meta_data->>'last_name'
        )
      ),
      ''
    ),
    split_part(u.email, '@', 1)
  )
  from auth.users u
  where cc.patient_id = u.id
    and cc.patient_name is null;

update public.care_circle_invites i
  set patient_name = coalesce(
    nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(u.raw_user_meta_data->>'name'), ''),
    nullif(
      trim(
        concat_ws(' ',
          u.raw_user_meta_data->>'first_name',
          u.raw_user_meta_data->>'last_name'
        )
      ),
      ''
    ),
    split_part(u.email, '@', 1)
  )
  from auth.users u
  where i.patient_id = u.id
    and i.patient_name is null
    and i.used_at is null
    and i.revoked_at is null;

notify pgrst, 'reload schema';
