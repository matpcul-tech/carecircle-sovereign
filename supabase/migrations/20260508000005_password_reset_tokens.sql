-- Migration: password_reset_tokens - single-use, expiring tokens for the
-- forgot-password flow.
--
-- The app never sent GoTrue recovery emails, so /api/auth/request-reset mints
-- a token here and emails a link; /api/auth/reset consumes it (atomic
-- used_at claim) and sets the new password via the GoTrue admin API. Only the
-- SHA-256 hash of the token is stored, never the token itself. Service-role
-- access only; there are no client policies.

create table if not exists public.password_reset_tokens (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null,
  email       text        not null,
  token_hash  text        not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_idx
  on public.password_reset_tokens (user_id, created_at desc);

alter table public.password_reset_tokens enable row level security;
-- No client policies on purpose: only the service role (via the /api/auth/*
-- routes) reads or writes this table.

notify pgrst, 'reload schema';
