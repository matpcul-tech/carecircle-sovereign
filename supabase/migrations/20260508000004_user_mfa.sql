-- Migration: user_mfa — TOTP second factor + backup codes.
--
-- CareCircle members can enroll a TOTP authenticator app. The shared secret
-- is stored AES-256-GCM-encrypted (server-only VAULT_KEY_HEX, same key as the
-- document vault) — never in plaintext. Backup codes are stored only as
-- SHA-256 hashes. All access is via the service-role /api/auth/mfa/* routes;
-- there are no client policies, so a stolen member JWT cannot read or alter
-- another member's factor material directly.

create table if not exists public.user_mfa (
  user_id          uuid        primary key references auth.users(id) on delete cascade,
  secret_cipher    text        not null,          -- base64 AES-256-GCM ciphertext of the base32 secret
  secret_iv        text        not null,          -- base64 12-byte GCM IV
  enabled          boolean     not null default false,
  backup_codes     jsonb       not null default '[]'::jsonb,  -- array of sha256 hex hashes (one-time)
  enrolled_at      timestamptz,
  updated_at       timestamptz not null default now()
);

alter table public.user_mfa enable row level security;
-- No client policies on purpose: only the service role touches this table,
-- exclusively through the /api/auth/mfa/* routes.

notify pgrst, 'reload schema';
