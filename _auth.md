# Cashford — Auth & Accounts

Records **which account / which method** per service. **No secrets here** — keys live in `.env.local` (git-ignored).

| Service | Account / Project | Method | Where the secret lives | Notes |
|---------|-------------------|--------|------------------------|-------|
| Supabase | _(TBD — Ananth's project)_ | Project URL + anon key (client) / service-role key (server) | `.env.local` | Postgres + Auth + Edge Functions + pg_cron |
| API-Football (api-sports.io) | _(TBD — free-tier signup)_ | `x-apisports-key` header | `.env.local` (`API_FOOTBALL_KEY`) | WC2026: `league=1, season=2026`; 100 req/day |
| GitHub | `ananthmenon10` | `gh` CLI / SSH | system keychain | repo `ananthmenon10/cashford` (private) — not yet created |
| Vercel | _(TBD)_ | Git integration (auto-deploy on push to main) | Vercel dashboard | env vars mirrored from `.env.local` |

## App player accounts (created by admin, not self-signup)
Supabase Auth users via synthetic emails `username@cashford.internal`. Public signup is **disabled**. Admin (Ananth) creates accounts with the service role; each starts with `must_change_password=true`.

| Username | Leagues | Role |
|----------|---------|------|
| `ananth` | KK Bois, PES Bois | admin + player |
| `utkarsh` | KK Bois, PES Bois | player |
| `sharan` | KK Bois | player |
| `hashir` | KK Bois | player |
| `harsh` | PES Bois | player |

_Temp passwords are generated at account creation and shared by Ananth out-of-band; not recorded here._
