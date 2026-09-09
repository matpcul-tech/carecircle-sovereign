-- Migration: family_messages
--
-- Threaded message board between the patient (CareIQ side, cookie auth)
-- and their care_circle members (care-os side, Supabase JWT auth).
-- RLS gates SELECT via is_patient_or_member, which already covers both
-- the patient (auth.uid() = patient_id) and the member branch.
--
-- INSERT policies:
--   - Members write directly with their JWT, sender_role='member',
--     sender_user_id = auth.uid().
--   - Patients write through CareIQ's /api/messages/post route using
--     service_role, sender_role='patient'. No client policy is added
--     for that path on purpose.

create table if not exists public.family_messages (
  id              uuid        primary key default gen_random_uuid(),
  patient_id      uuid        not null,
  sender_role     text        not null check (sender_role in ('patient','member','system')),
  sender_user_id  uuid        references auth.users(id),
  sender_label    text,
  body            text        not null check (length(body) between 1 and 4000),
  created_at      timestamptz not null default now()
);

create index if not exists family_messages_patient_idx
  on public.family_messages (patient_id, created_at desc);

alter table public.family_messages enable row level security;

drop policy if exists "fmsg_select" on public.family_messages;
create policy "fmsg_select"
  on public.family_messages
  for select
  using (public.is_patient_or_member(patient_id));

drop policy if exists "fmsg_member_insert" on public.family_messages;
create policy "fmsg_member_insert"
  on public.family_messages
  for insert
  with check (
    sender_role = 'member'
    and sender_user_id = auth.uid()
    and public.is_patient_or_member(patient_id)
  );
