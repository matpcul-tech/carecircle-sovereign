#!/usr/bin/env node
// Generate the secrets a self-hosted Supabase + CareCircle needs.
//
//   node scripts/generate-keys.mjs            # print a ready-to-paste block
//   JWT_SECRET=... node scripts/generate-keys.mjs   # derive keys from an existing secret
//
// The ANON_KEY and SERVICE_ROLE_KEY are HS256 JWTs signed with JWT_SECRET -
// exactly the shape GoTrue/PostgREST/Storage expect. Keep JWT_SECRET and
// SERVICE_ROLE_KEY secret; ANON_KEY is public.
import crypto from 'node:crypto';

function b64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(payload, secret) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = b64url(crypto.createHmac('sha256', secret).update(data).digest());
  return `${data}.${sig}`;
}

const jwtSecret = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 60 * 60 * 24 * 365 * 10; // 10 years

const anonKey = signJwt({ role: 'anon', iss: 'supabase', iat, exp }, jwtSecret);
const serviceKey = signJwt({ role: 'service_role', iss: 'supabase', iat, exp }, jwtSecret);

const postgresPassword = crypto.randomBytes(18).toString('base64url');
const vaultKeyHex = crypto.randomBytes(32).toString('hex');

process.stdout.write(
  [
    '# --- generated secrets: paste into self-host/.env ---',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `JWT_SECRET=${jwtSecret}`,
    `ANON_KEY=${anonKey}`,
    `SERVICE_ROLE_KEY=${serviceKey}`,
    '',
    '# --- the app (.env.local) uses these to reach your stack ---',
    '# NEXT_PUBLIC_SUPABASE_URL=https://api.yourdomain.example   (this gateway)',
    `# NEXT_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
    `# SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
    `# VAULT_KEY_HEX=${vaultKeyHex}`,
    '',
  ].join('\n'),
);
