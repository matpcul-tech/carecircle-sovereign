-- Migration: Guided Answers
--
-- A no-AI answer library for the chat tab. When NEXT_PUBLIC_AI_CHAT_ENABLED
-- is off the tab browses these rows instead of calling a model, so the
-- content is reviewed by a person before anyone can read it.
--
-- The review gate lives here rather than in the client: an answer is only
-- selectable once status = 'approved', so a draft cannot reach a family
-- member even if the UI has a bug.

create extension if not exists "pgcrypto";

create table if not exists public.guided_topics (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  sort_order  integer not null default 0
);

create table if not exists public.guided_answers (
  id          uuid        primary key default gen_random_uuid(),
  topic_id    uuid        not null references public.guided_topics(id) on delete cascade,
  question    text        not null,
  answer      text        not null,
  source_name text,
  source_url  text,
  status      text        not null default 'draft' check (status in ('draft', 'approved')),
  reviewed_by uuid        references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  sort_order  integer     not null default 0,
  updated_at  timestamptz not null default now()
);

-- What a family member looked for and did not find. Deliberately has no
-- user id and no free text: it says a gap exists in a topic, never who
-- asked or what they typed, so it can be read for content planning
-- without becoming a record of anyone's health concerns.
-- topic_id is null when the gap was reported from the topic list itself.
create table if not exists public.guided_misses (
  id         uuid        primary key default gen_random_uuid(),
  topic_id   uuid        references public.guided_topics(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists guided_topics_sort_idx
  on public.guided_topics (sort_order, title);

create index if not exists guided_answers_topic_status_idx
  on public.guided_answers (topic_id, status, sort_order);

create index if not exists guided_misses_topic_created_idx
  on public.guided_misses (topic_id, created_at desc);

alter table public.guided_topics  enable row level security;
alter table public.guided_answers enable row level security;
alter table public.guided_misses  enable row level security;

-- Any signed-in member may browse the topic list.
drop policy if exists "guided_topics_select_authenticated" on public.guided_topics;
create policy "guided_topics_select_authenticated"
  on public.guided_topics
  for select
  to authenticated
  using (true);

-- Approved answers only. Drafts are invisible to the client entirely:
-- the filter is the database's, not the UI's.
drop policy if exists "guided_answers_select_approved" on public.guided_answers;
create policy "guided_answers_select_approved"
  on public.guided_answers
  for select
  to authenticated
  using (status = 'approved');

-- A member may report a gap. There is no select policy, so the client can
-- write a miss but can never read the misses back.
drop policy if exists "guided_misses_insert_authenticated" on public.guided_misses;
create policy "guided_misses_insert_authenticated"
  on public.guided_misses
  for insert
  to authenticated
  with check (true);

-- No insert, update or delete policies on topics or answers: content is
-- authored and approved by the service role or by SQL, never by a client.
-- Approving a row is a deliberate manual step, for example:
--   update public.guided_answers
--      set status = 'approved', reviewed_by = '<reviewer auth uid>',
--          reviewed_at = now(), updated_at = now()
--    where id = '<answer id>';

notify pgrst, 'reload schema';
