# CareCircle — Family Care Coordination

A "Care OS" for families coordinating care for aging parents. Shared dashboard for medications, appointments, care tasks, insurance documents, emergency contacts, and an AI care assistant.

## Quick Start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

Copy `.env.example` to `.env.local` and fill in the values. Providers for AI,
email, and SMS are swappable by env (`LLM_PROVIDER`, `EMAIL_PROVIDER`,
`SMS_PROVIDER`) — including a self-hosted local model via `LLM_PROVIDER=openai`.

## Self-hosting the data layer

To run Supabase (Postgres / auth / storage) yourself instead of the managed
cloud, see [`self-host/`](./self-host/README.md) — a Docker Compose stack that
serves the identical API surface so the app's migrations and RLS run
unchanged. Point `NEXT_PUBLIC_SUPABASE_URL` at your gateway.

The app also ships a `Dockerfile` (standalone Next.js output). Run it
alongside the self-hosted stack — one host, one network, one BAA — with the
app overlay:

```bash
cd self-host
docker compose -f docker-compose.yml -f docker-compose.app.yml up -d --build
```

## Deploy to Vercel

```bash
# Option 1: Vercel CLI
npm i -g vercel
vercel

# Option 2: GitHub → Vercel
# Push to GitHub, connect repo at vercel.com/new
```

## Project Structure

```
carecircle/
├── public/
│   ├── favicon.svg          # App icon
│   └── manifest.json        # PWA manifest
├── src/
│   ├── main.jsx             # Entry point + router
│   ├── index.css             # Global styles
│   ├── LandingPage.jsx       # Marketing / conversion page (/)
│   ├── App.jsx               # Main app shell (/app)
│   ├── App.css               # App styles
│   ├── data.js               # Demo data constants
│   ├── storage.js            # localStorage persistence layer
│   └── notifications.js      # Browser notification + reminder system
├── index.html
├── vite.config.js
├── vercel.json               # SPA rewrite rules
└── package.json
```

## Routes

| Path    | Component      | Description                    |
|---------|---------------|--------------------------------|
| `/`     | LandingPage   | Marketing page with pricing    |
| `/app`  | App           | Full care coordination app     |

## Features

- **Medication Tracker** — Visual daily schedule, one-tap logging, refill alerts
- **Shared Care Calendar** — Appointments with prep notes and post-visit summaries
- **Task Management** — Assign care duties by family member with priority levels
- **Document Vault** — Encrypted storage for insurance, legal, and medical docs
- **AI Care Assistant** — Visit summaries, family updates, proactive alerts
- **Emergency Profile** — One-tap access for first responders and ER staff
- **Persistent Storage** — All data saved to localStorage across sessions
- **Push Notifications** — Browser-native medication reminders and care alerts
- **PWA Ready** — Installable as a mobile app via manifest.json

## Tech Stack

- React 18 + Vite
- React Router v6
- Lucide React icons
- localStorage persistence
- Browser Notification API
- Deployed via Vercel

## Monetization (Planned)

- Free tier: 1 care recipient, 2 family members
- Family ($9/mo): AI summaries, 8 members, 25GB vault
- Family+ ($19/mo): Unlimited, scanning, provider portal

## License

MIT
