# Cashford ⚽💸

World Cup 2026 prediction & settle-up game for two private friend-leagues (**KK Bois**, **PES Bois**). Predict each match's outcome + scoreline; predictions lock 30 min before kickoff, reveal after; the app auto-settles a ₹ ledger after full-time.

> Full spec: [`docs/plans/2026-06-18-001-feat-cashford-worldcup-prediction-game-plan.md`](docs/plans/2026-06-18-001-feat-cashford-worldcup-prediction-game-plan.md)

## Stack
Next.js (App Router, TS) · Supabase (Postgres + Auth + Edge Functions + pg_cron) · Tailwind v4 · Vercel. Fixtures & live scores from **API-Football** (free tier).

## Setup
```bash
npm install
cp .env.local.example .env.local   # then fill in Supabase + API-Football keys
npm run dev                         # http://localhost:3000
```

### Env vars (`.env.local`)
| Var | From |
|-----|------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same |
| `SUPABASE_SERVICE_ROLE_KEY` | same (**server-only**, bypasses RLS) |
| `API_FOOTBALL_KEY` | dashboard.api-football.com (free `x-apisports-key`) |

### Database
Migrations live in [`supabase/migrations/`](supabase/migrations). Apply once Supabase creds are set:
```bash
supabase link --project-ref <ref>
supabase db push
```
`0001_schema.sql` — tables + constraints · `0002_rls_functions.sql` — RLS, helpers, triggers · `0003_seed.sql` — the two leagues.

Player accounts are created by the admin (no public signup) — see the create-user flow (Phase 2) and [`_auth.md`](./_auth.md).

## Project structure
```
app/            Next.js routes (App Router)
lib/supabase/   client.ts (browser) · server.ts (RSC/route) · service.ts (service role, server-only)
middleware.ts   auth gate + force-first-login-password-change
supabase/migrations/  SQL schema, RLS, seed
docs/plans/     the spec
```

## Status
Phase 0 (scaffold) + Phase 1 (schema/RLS migrations) done. Next: Phase 2 auth + seed, Phase 3 fixture sync. See the plan's §13 Fast Path.
