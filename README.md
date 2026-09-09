# CareCircle Sovereign Edition

Family care coordination for Chickasaw families, on Nation terms. One shared
place for medications, appointments, care tasks, documents, emergency
contacts, and a Tribal Health OS assistant, with live clinical data from
Chikasha Health OS and the Sovereign Shield built in.

This repository is the Sovereign Edition of CareCircle. It is based on the
care-os chassis (the CareCircle FQHC edition) and keeps feature parity with
it: the same Next.js 14 app, the same Supabase data layer, the same
role-scoped RLS, vault encryption, MFA, audit log, and provider seams for
AI, email, and SMS.

## What is different from care-os

- **Palette.** Sovereign navy, sage, and terracotta replace the FQHC teal and
  gold. Fonts stay Playfair Display for headings, Outfit for body, and DM Mono
  for labels. The primary call-to-action gradient in new code is
  `linear-gradient(135deg,#C07941,#8B3A2A)`.
- **Health OS data plane and a shared Supabase project.** The patient record
  lives in Chikasha Health OS, not CareIQ. `NEXT_PUBLIC_HEALTH_OS_URL`
  (default `https://sovereignhealthcareos.com`) replaces
  `NEXT_PUBLIC_CAREIQ_URL`, and `HEALTH_OS_ALERT_SIGNING_KEY` replaces
  `CAREIQ_ALERT_SIGNING_KEY`. Because `care_circle.patient_id` is the
  patient's Supabase auth uid, `NEXT_PUBLIC_SUPABASE_URL` for this app MUST
  point at the Health OS Supabase project. Running it against a separate
  project breaks family authorization and access requests.
- **Family-initiated access requests.** care-os only supports
  patient-initiated invites. Here a family member can ask for access at
  `/request-access`; the elder is emailed and approves or denies from the
  Family page, choosing the role (viewer, caregiver, admin) and alert level.
  Requests live in `care_circle_access_requests`, written only by the
  service-role routes so the patient email lookup never confirms whether an
  account exists. Every decision is written to the PHI access log.
- **Patient sign-in.** A Chikasha Health OS patient can sign in to CareCircle
  and see their own circle as an admin, which is how they approve requests.
  Accounts this app creates for family members carry
  `user_metadata.role = 'care_circle_member'` and are never treated as a
  patient. A family member with no circle yet lands on the request status
  page instead of an error.
- **Tribal ID masking.** The Shield scan redacts tribal enrollment and
  CDIB-style identifiers (`CHK`, `CDIB`, `CN` followed by digits) before any
  message reaches the model, alongside SSNs, phone numbers, dates of birth,
  dates, and medical record numbers.
- **Persona rules.** The assistant is the Tribal Health OS assistant. It never
  invents numbers, scores, or diagnoses; it never gives dementia risk
  numbers; serious clinical decisions go to the Chickasaw Nation Department
  of Health care team; and it treats everything it receives as sensitive
  health information.
- **Copy.** No fabricated testimonials. Nation-facing language throughout.

## Health OS side (required, in the chikashahealthcareos1 repo)

CareCircle Sovereign Edition is a family window onto the Health OS. Three
things must exist on the Health OS side for it to work:

1. **`GET /api/shield/decrypt`** authorizes a caller by `care_circle`
   membership (the caller's Supabase JWT resolves to a `member_user_id` row
   for the patient, or the caller is the patient) and returns the
   CareIQ-shaped payload the family pages already read: `patient_id`,
   `bp_systolic`, `bp_diastolic`, `a1c`, `ldl`, `hr`, `spo2`, `risk_score`,
   `updated_at`, `decrypted_at`, `shield_version`, plus the biomarker panel
   fields the Health OS page consumes.
2. **Alert push to `POST /api/alerts`** on this app, signed with
   `HEALTH_OS_ALERT_SIGNING_KEY` (HMAC over the raw body, sent as
   `x-alert-signature` with `x-alert-timestamp`). The key must be the same
   value on both sides.
3. **Run this repository's migrations** (`supabase/migrations/`) against the
   shared Health OS Supabase project, including
   `20260909000001_care_circle_access_requests.sql`.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in the Health OS Supabase project values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Providers for AI, email, and SMS are swappable by env (`LLM_PROVIDER`,
`EMAIL_PROVIDER`, `SMS_PROVIDER`), including a self-hosted local model via
`LLM_PROVIDER=openai`.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

## Self-hosting the data layer

To run Supabase (Postgres, auth, storage) yourself instead of the managed
cloud, see [`self-host/`](./self-host/README.md), a Docker Compose stack that
serves the identical API surface so the app's migrations and RLS run
unchanged. Point `NEXT_PUBLIC_SUPABASE_URL` at your gateway. In the Sovereign
Edition that gateway must be the same project the Health OS uses.

The app also ships a `Dockerfile` (standalone Next.js output). Run it
alongside the self-hosted stack with the app overlay:

```bash
cd self-host
docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --build
```

## Routes

| Path               | Description                                                   |
|--------------------|---------------------------------------------------------------|
| `/`                | Landing page                                                  |
| `/signup`          | Join a circle with an invite code, or request access instead  |
| `/request-access`  | Ask an elder for access; watch the request status             |
| `/login`           | Family member or patient sign-in (MFA aware)                  |
| `/app`             | Family monitor                                                |
| `/dashboard`       | Full dashboard: home, meds, tasks, calendar, vault, family, AI |

## Project structure

```
carecircle-sovereign/
  src/app/                 Next.js App Router pages and API routes
    api/circle/request-access/         family-initiated access requests
    api/circle/request-access/decide/  elder or admin approves or denies
    api/shield/                        Tribal Health OS assistant with PII scan
    api/alerts/                        signed alert intake from the Health OS
  src/components/          CareCircleApp and the dashboard pages
  src/lib/                 auth, audit, rate limit, crypto, providers
  supabase/migrations/     schema, RLS, capability functions
  self-host/               Docker Compose stack for a self-hosted data layer
  test/                    Node test runner suites for the API routes
```

## License

MIT
