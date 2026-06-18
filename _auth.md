# Cashford — Auth & Accounts

Records **which account / which method** per service. **No secrets here** — keys live in `.env.local` (git-ignored).

| Service | Account / Project | Method | Where the secret lives | Notes |
|---------|-------------------|--------|------------------------|-------|
| Supabase | _(TBD — Ananth's project)_ | Project URL + anon key (client) / service-role key (server) | `.env.local` | Postgres + Auth + Edge Functions + pg_cron |
| ESPN (public API) | none — public, key-less | unauthenticated GET `site.api.espn.com` | n/a | WC2026 via `soccer/fifa.world` scoreboard. Chosen because API-Football's free tier is season-capped (2022–2024). `API_FOOTBALL_KEY` in `.env.local` is now unused. |
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
