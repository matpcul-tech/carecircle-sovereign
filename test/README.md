# CareCircle — Evaluation & Stress-Test Report

Real, executable evaluation of the care-os codebase. Every claim below is
backed by a test in this directory that runs against the **actual** module
or route handler (Supabase/Resend/Twilio/Anthropic calls are intercepted by
a recording `fetch` stub — no live services, no schema changes).

## How to run

```bash
npm run typecheck   # tsc --noEmit
npm run build       # next build
npm test            # 66 tests across crypto, all API routes, and stress/DoS
```

Tooling: Node 22's built-in test runner + type stripping. `test/register.mjs`
registers a resolve hook (`test/loader.mjs`) so the real handlers — which
import `next/server` and the `@/` alias — load unmodified.

## Baseline health

| Check | Result |
|-------|--------|
| `tsc --noEmit` (strict) | ✅ clean |
| `next build` (8 routes) | ✅ compiles, lints, generates |
| Test suite | ✅ 66/66 passing |

## What works well (verified)

- **Vault AES-256-GCM** (`vault-crypto.test.mts`, 14 tests): correct
  round-trips including empty and the 25 MB max upload; unique IV per call
  across 5,000 encryptions (no nonce reuse); tamper of ciphertext, tag, or
  IV is rejected; wrong-key and malformed-key rejected; 2,000 random-size
  fuzz round-trips with zero corruption.
- **Vault authorization** (`vault-auth.test.mts`): missing/invalid token →
  401, non-member → 403, and the cross-patient IDOR guard in
  `authVaultForFile` correctly blocks a file owned by another patient (403).
- **Alerts HMAC** (`alerts.test.mts`): the signed `panel_grade_change` path
  correctly accepts a valid signature and rejects missing, tampered, and
  stale (>300 s) signatures; threshold math is right at and just past every
  boundary; critical-only members are excluded from informational alerts.
- **Invite redemption** (`redeem.test.mts`): rejects short passwords/bad
  emails before creating anything; honors expired/used/revoked (410);
  **rolls back the orphaned auth user** when the circle insert fails;
  marks the invite used to block replay; maps duplicate email → 409.
- **update-nickname** (`update-nickname.test.mts`): requires a valid JWT,
  scopes the PATCH to the caller's own `member_user_id`, clamps to 60 chars.

## Fixes applied (F1–F6)

All findings are fixed and the tests now assert the *fixed* behavior
(73/73 passing, `tsc` clean, `next build` clean).

- **F1 — CRITICAL DoS: fixed.** `serverScan()` now does one linear
  `regex.replace(pattern, token)` pass per pattern instead of a per-match
  `String.replace` loop, and `/api/shield` caps input to 40 messages ×
  8000 chars. Measured on the same 600 KB date-dense payload: **~33,000 ms →
  22 ms** from the algorithm alone, and ~0 ms after the length cap. Tests:
  `stress.test.mts` (`F1 fixed: …`).
- **F2 — shield auth: fixed.** `/api/shield` now requires a valid Supabase
  JWT (`getUserId`); anonymous or bad-token requests get 401 and never reach
  the Anthropic API. `AIPage` sends `Authorization: Bearer <access_token>`.
- **F3 — circle auth: fixed.** `/api/circle` GET and POST require a JWT and
  authorize via `isPatientOrMember(userId, patientId)` (the code analog of
  the SQL `is_patient_or_member` policy). Non-authenticated → 401,
  non-member → 403.
- **F4 — alerts auth: fixed.** The CareIQ HMAC signature is now mandatory on
  **every** alert request (vitals and grade-change alike), covering the exact
  raw body. Unsigned/tampered/stale → 401, no email or SMS fan-out.
- **F6 — shield sanitization: fixed (bonus).** Every user-role message is
  scanned and sanitized, not just the last, so PHI in earlier turns no longer
  reaches the model.

Shared auth helpers live in `src/lib/api-auth.ts`.

> **Integration note:** F4 makes signing mandatory for the vitals path. If
> the CareIQ caller only signed grade-change requests before, it must now
> sign vitals requests too (same `ts + ":" + rawBody` HMAC-SHA256 with
> `CAREIQ_ALERT_SIGNING_KEY`). This is the intended security posture.

- **F5 — invite-redemption TOCTOU: fixed.** `redeem` now claims the invite
  with a single conditional PATCH (`?id=eq.X&used_at=is.null&revoked_at=is.null`
  setting `used_at`) *before* creating any account. PostgREST applies the
  WHERE-clause server-side, so of N concurrent redemptions exactly one gets a
  non-empty representation; losers are rejected 410 before an account exists.
  Failed redemptions (auth-create or circle-insert errors) release the claim
  so the code stays reusable. Test: `stress.test.mts`
  (`F5 fixed (TOCTOU): … exactly one wins`) plus claim/release assertions in
  `redeem.test.mts`.

## HIPAA hardening: role-scoped access + audit logging

Added after the F1–F6 fixes to address two HIPAA Security Rule gaps:
minimum-necessary access (§164.502(b)) and audit controls (§164.312(b)).
Suite is now **94/94 passing**, `tsc` clean, `next build` clean.

### Role-scoped access (minimum-necessary)

Migration `20260508000001_care_role_scoped_access.sql` adds a `care_role`
(`admin` | `caregiver` | `viewer`) to `care_circle` and splits the single
`is_patient_or_member()` gate into per-verb capability functions
(`cc_can_read` / `cc_can_write` / `cc_can_delete` / `cc_can_read_vault` /
`cc_can_delete_vault`). RLS on medications, medication_logs, appointments,
care_tasks, and vault_files now enforces:

| Capability | admin | caregiver | viewer |
|---|:--:|:--:|:--:|
| Read clinical records | ✅ | ✅ | ✅ |
| Create / update records | ✅ | ✅ | — |
| Delete records | ✅ | — | — |
| Read / upload vault docs | ✅ | ✅ | — |
| Delete vault docs | ✅ | — | — |

The patient is implicitly `admin`. Existing members are grandfathered to
`admin` (non-breaking); new members default to `caregiver`. The role is
threaded through `generate-invite` (`suggested_role`), `redeem`, and the
add-member route. **Redeem cannot escalate:** a client-supplied role may
only *narrow* the invite's `suggested_role`, never raise it. The
service-role vault API routes enforce the same tiers in code (viewers get
403 on download/upload; only admins can delete). Tests: `vault-roles.test.mts`,
role cases in `redeem.test.mts` and `circle.test.mts`.

### Audit logging (§164.312(b))

Migration `20260508000002_phi_access_log.sql` adds an append-only
`phi_access_log` table (patient/admin-readable, no client writes). Two feeds:

- **DB triggers** capture every INSERT/UPDATE/DELETE on the client-writable
  clinical tables (medications, medication_logs, appointments, care_tasks),
  stamping actor + role from `auth.uid()` / `cc_role()`.
- **Service-role API routes** log the flows that bypass those tables: vault
  upload/download/delete, AI chat queries (PHI egress to the model), and
  outbound alert dispatch — via `src/lib/audit.ts`.

**Known limitation (documented in the migration):** PostgreSQL has no SELECT
trigger, so plain reads of the clinical tables are not captured. The
highest-sensitivity reads — vault document downloads and AI queries — *are*
logged. Full read-auditing of the clinical tables would need a read-through
API endpoint or a DB audit extension / log drain (pgAudit); tracked as
follow-up. Tests: `audit.test.mts` plus emission assertions in
`vault-roles.test.mts`, `shield.test.mts`, `alerts.test.mts`.

## Accurate Shield wording + rate limiting

Two follow-ups after the role/audit work. Suite is now **103/103 passing**,
`tsc` clean, `next build` clean.

### Shield wording (truth-in-advertising)

The "Sovereign Prompt Shield" was described across the app as de-identifying
PHI ("PHI has been replaced with protected tokens", "never reaches a
commercial server in readable form", "ZK Shield", "HIPAA-compliant
infrastructure"). In reality it regex-redacts five identifier patterns (SSN,
phone, DOB, MRN, dates) and still sends everything else — names, clinical
details — to a third-party model. All user-facing and system-prompt copy was
rewritten to state what it actually does: server-side redaction of common
direct identifiers, *not* full de-identification, with data sent to an
external provider over TLS. Touched: shield system prompt + `action` label
(`PII_BLOCKED` → `PII_REDACTED`, `shieldVersion` de-`ZK`'d), landing page,
ShieldPage, AIPage, signup, alert/invite email + SMS footers, and the
CareCircleApp banner.

### Rate limiting

Migration `20260508000003_rate_limits.sql` adds a `rate_limits` table and an
atomic fixed-window `rate_limit_hit(key, max, window)` RPC (shared state
across serverless/edge instances). `src/lib/rate-limit.ts` wraps it
(**fail-open** — a limiter outage never blocks core flows). Applied to:

| Route | Key | Limit |
|---|---|---|
| `/api/shield` | user id | 30 / min |
| `/api/circle/redeem` GET | IP | 30 / min |
| `/api/circle/redeem` POST | IP | 10 / min |
| `/api/circle/generate-invite` | user id | 20 / min |
| `/api/circle` GET/POST | IP | 60 / min |
| `/api/circle/update-nickname` | user id | 30 / min |
| `/api/alerts` | patient id | 120 / min |

Tests (`rate-limit.test.mts`, plus 429 cases in `shield.test.mts` and
`redeem.test.mts`) verify allow/deny passthrough, the composed key + params,
fail-open on limiter error, and that an over-limit caller is rejected 429
*before* the model call / invite lookup / account creation.

## MFA + auth hardening

Adds a TOTP second factor and hardens the sign-in path. Suite is now
**132/132 passing**, `tsc` clean, `next build` clean.

### Password policy
`src/lib/password-policy.ts` — 12–128 chars, ≥3 character classes, blocks a
common-password list and any value containing the email local-part or member
name. Enforced server-side in `redeem` and mirrored in the signup UI. Tests:
`password-policy.test.mts`.

### TOTP (RFC 6238)
`src/lib/totp.ts` — base32, HOTP/TOTP (HMAC-SHA1, 6 digits, 30 s), constant-
time verify with ±1 step skew, otpauth URI. Verified against the canonical
**RFC 4226 test vectors**. Tests: `totp.test.mts`.

### MFA enrollment & storage
Migration `20260508000004_user_mfa.sql` — `user_mfa` holds the TOTP secret
**AES-256-GCM-encrypted** (VAULT_KEY_HEX, never plaintext) and backup codes as
**SHA-256 hashes only**; service-role access only. Routes (`/api/auth/mfa/*`):
`enroll` → `activate` (verifies first code, issues 10 one-time backup codes) →
`status` / `disable` (disable requires a valid code, so a single-factor
session can't strip MFA). All rate-limited. Tests: `mfa.test.mts` — real
enroll→activate→verify flow, wrong-code rejection, backup-code single-use,
enable-guard, disable-guard.

### Hardened login (`/api/auth/login`)
Replaces the browser's direct Supabase password grant. Adds:
- **per-IP throttle** (30/min) and **per-email lockout** (5 failures/15 min,
  reset on success);
- **generic errors** — never reveals whether an email exists;
- **MFA gating** — when the member has MFA, the session is *withheld* and an
  encrypted, 5-minute `mfa_token` is returned; `/api/auth/mfa/login-verify`
  exchanges it (plus a TOTP or backup code) for the real session.

The login and signup pages are wired to the new flow (second-factor prompt +
enrollment card in FamilyPage). Tests: `login.test.mts` — success, generic
401, MFA gating (session withheld), IP + email lockout, failure-counter reset.

> **Note:** MFA here is app-enforced at the login proxy, independent of
> Supabase's own MFA feature. Tokens still live in `localStorage` (unchanged);
> moving them to httpOnly cookies remains a recommended follow-up.

## Provider abstraction (vendor-swappable AI / email / SMS)

Decouples the app from single vendors so you can move off (or self-host) any
of them by env alone. Suite is now **142/142 passing**, `tsc` clean,
`next build` clean. See `.env.example` for the full matrix.

- **`src/lib/providers/llm.ts`** — one `chatComplete()` seam.
  `LLM_PROVIDER=anthropic` (default) or `openai` (any OpenAI-compatible
  `/chat/completions` endpoint: **a self-hosted local model via Ollama / vLLM
  / LM Studio**, OpenAI, etc.). Selected at call time; normalizes the system
  prompt + message shapes per provider. `/api/shield` now calls this — the
  AI vendor is a config switch, and can be dropped entirely for a local model.
- **`src/lib/providers/email.ts`** — `EMAIL_PROVIDER=resend` (default) or
  `http` (POST to your own mailer webhook — self-hosted relay / SES shim).
  `/api/circle` and `/api/alerts` use it.
- **`src/lib/providers/sms.ts`** — `SMS_PROVIDER=twilio` (default) or `http`
  (your own gateway). `/api/alerts` uses it.

Defaults keep the exact previous endpoints/behavior (all prior tests pass
unchanged). Tests: `providers.test.mts` — Anthropic vs OpenAI-compatible body
formatting + parsing, bearer-token handling, config-error detection, email +
SMS provider dispatch, and an **end-to-end shield request served by a local
OpenAI-compatible model with no Anthropic call**.

## Findings (as originally verified by test)

### F1 — CRITICAL: `/api/shield` quadratic-complexity DoS, unauthenticated
`serverScan()` sanitizes with `matches.forEach(m => sanitized =
sanitized.replace(m, token))` — O(matches × length). A body of repeated
`"12/34/"` yields ~n/6 DATE matches over a length-n string, so cost is
quadratic. The route has **no authentication and no input-size limit**.

Measured (`stress.test.mts` + micro-bench):

| Input | Size | Time |
|-------|------|------|
| `"12/34/"` × 20k | 120 KB | ~1.4 s |
| `"12/34/"` × 40k | 240 KB | ~5.3 s |
| `"12/34/"` × 80k | 480 KB | ~21 s |
| `"12/34/"` × 100k | 600 KB | ~33 s |

A same-length benign digit string scans in ~2 ms. One anonymous ~250 KB
request pins a serverless CPU for seconds; a handful exhausts capacity and
amplifies function cost. **Fix:** cap message length (e.g. 8–16 KB) before
scanning, and replace the per-match loop with a single
`String.replace(regex, token)` pass per pattern.

### F2 — HIGH: `/api/shield` has no authentication (LLM cost abuse + PHI)
The handler never checks `Authorization`; any anonymous caller reaches the
paid Anthropic API (`shield.test.mts` proves the outbound call). This is an
open, billable LLM proxy and the delivery vector for F1. **Fix:** require a
valid Supabase JWT (reuse `authVault`'s token check) and rate-limit.

### F3 — HIGH: `/api/circle` GET & POST have no authentication (PII / IDOR)
`GET ?patient_id=<uuid>` returns the full circle — member **names, emails,
and phone numbers** — with no auth. `POST` adds an arbitrary member to any
patient's circle and fires an invite email. Both use the service-role key,
so RLS is bypassed. Proven in `circle.test.mts`. **Fix:** authenticate the
caller and authorize via `is_patient_or_member(patient_id)` (patient owner
or existing member) instead of trusting the body/query `patient_id`.

### F4 — HIGH: `/api/alerts` vitals path has no authentication
The `panel_grade_change` path is HMAC-signed, but a body carrying only
`vitals` is processed with no signature or token. An anonymous caller who
guesses/enumerates a `patient_id` can trigger real alert **emails and SMS**
to that patient's whole circle (spam, cost, and membership confirmation).
Proven in `alerts.test.mts` (`SECURITY: unauthenticated vitals request…`).
**Fix:** require the same HMAC signature (or a JWT) on every path, not just
grade changes.

### F5 — MEDIUM: invite redemption is not atomic (single-use bypass / replay)
`redeem` checks `used_at` is null, then creates the account, then marks the
invite used — a TOCTOU window with no compare-and-set. Two concurrent
POSTs with the same code both pass the check and both succeed.
`stress.test.mts` (`TOCTOU`) drives two concurrent redemptions from one
invite and confirms **two accounts + two circle rows** are created. **Fix:**
make the "claim" atomic — e.g. `PATCH …?code=eq.X&used_at=is.null` with
`Prefer: return=representation` and treat an empty result as already-claimed
*before* creating the user, or add a DB uniqueness/guard on `used_by`.

### F6 — LOW: `/api/shield` only sanitizes the last message
`finalMessages` re-scans just `messages[len-1]`; PII in earlier turns is
forwarded to the model verbatim. `shield.test.mts` shows an SSN in a prior
turn reaching Anthropic unredacted — contradicting the "PHI replaced with
protected tokens" guarantee in the system prompt. **Fix:** scan every
user-role message, not only the final one.

## Notes / non-issues reviewed

- RLS on the data-screen tables (meds, appts, tasks, vault_files,
  family_messages) is sound: every policy funnels through
  `is_patient_or_member`, and `family_messages` INSERT correctly pins
  `sender_user_id = auth.uid()`.
- Dropping the `patient_id → auth.users` FKs (20260505000002) is
  intentional and RLS still gates access; acceptable.
- `ensureValidSession` is deliberately lenient (keeps the session on
  refresh failure); reasonable for a page-load gate since data calls still
  401. Not a finding.
