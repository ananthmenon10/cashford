# Cashford — repo guide

World Cup 2026 **prediction & settle-up** game for friend groups. Members predict scorelines;
correct predictors split the incorrect predictors' stakes; the app tracks net dues per league.

> Inherits `~/CLAUDE.md` and `~/AI/projects/CLAUDE.md`. This file adds Cashford-specific facts.

## Stack
- **Next.js 15** (App Router, React 19) · **TypeScript** · **Tailwind v4** (`@theme` semantic tokens)
- **Supabase** — Postgres + Auth + RLS, schema **`cashford`**
- **Vercel** — region **`bom1`** (co-located with Supabase ap-south-1)
- Tests: **Vitest**

## Repo & deploy
- GitHub: `ananthmenon10/cashford` (private). Prod: **https://cashford.vercel.app**.
- **Push to `main` → Vercel auto-deploys prod.** Branch for safe iteration; PR/preview otherwise.
- **Staging:** `vercel deploy --yes` → `vercel alias set <deployment-url> cashford-staging.vercel.app`.
  Vercel deployment protection (SSO) normally gates previews (`ssoProtection: all_except_custom_domains`).
  The Cashford app login is separate (username + password, Supabase auth) — a logged-in session is
  needed to see league/match screens, so QC requires the user's real browser session.
- **Version stamp:** `node scripts/stamp-version.mjs` writes `lib/version.ts` (`APP_VERSION` = git
  commit count + 1; shown as the `vNN` pill). Run it before a prod release, commit, then push.
- **Commits:** conventional, HEREDOC; **no `Co-Authored-By` footer** (repo convention).
- Only commit/push when asked. **Never `git add .`** — these ops scripts are intentionally untracked:
  `scripts/{qa-live,qa-seed,qa-verify,reset-passwords,seed-solid-yenne,seed-demo,seed-users,sync-fixtures,test-harness}.mjs`. Stage files explicitly.

## Supabase & migrations
- Project ref **`fwqgyycqnslafpcetjqo`**; schema `cashford`. Migrations in `supabase/migrations/`.
- **Applying DDL:** the CLI is **not linked** and there is **no DB password** in env, and the
  service-role key **cannot run DDL**. Apply schema changes via the **Management API** with the
  Personal Access Token in `.env.local` (`SUPABASE_ACCESS_TOKEN`, `sbp_…`):
  ```bash
  SCRATCH=/tmp; PAT=$SUPABASE_ACCESS_TOKEN; REF=fwqgyycqnslafpcetjqo
  python3 -c "import json;open('$SCRATCH/b.json','w').write(json.dumps({'query':open('supabase/migrations/<file>.sql').read()}))"
  curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" --data @"$SCRATCH/b.json"
  ```
  The same endpoint runs read queries for inspection (`{"query":"select …"}`). There is **one shared
  DB** (no separate staging DB) — additive migrations are safe; be careful with destructive ones.
- RLS: reference tables (`teams`, `fixtures`, `fixture_insights`) are `select … to authenticated
  using (true)`; user data is scoped to the viewer's leagues via `cashford.my_league_ids()`. Writes
  are service-role only (the service client bypasses RLS).

## Env vars (`.env.local`, gitignored — names only, never echo values)
`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` (server-only,
`lib/supabase/service.ts`) · `SUPABASE_ACCESS_TOKEN` (Management-API/DDL PAT) · `CRON_SECRET` ·
`API_FOOTBALL_KEY` (legacy; live data source is ESPN, keyless).

## Data model (schema `cashford`)
`profiles` · `leagues` · `league_members` · `teams` · `fixtures` (104 WC matches; knockout teams
resolve from TBD) · `contests` (one per league per fixture) · `predictions` · `contest_results` ·
`transfers` · `contest_audit_log` · **`fixture_insights`** (1:1 ESPN-derived cache for the predict screen).
- **`fixtures.external_id`** = the ESPN event id (the join key for all ESPN data — no extra mapping).
- **`lock_at = kickoff_at`** (denormalized; predictions lock at kickoff). "Open" = pre-kickoff.
- Settlement (`lib/settlement.ts`, `lib/settle-contest.ts`): winners split losers' stakes; golden tests cover it. **Don't touch settlement/scoring without strong tests.**

## ESPN integration (keyless, league slug `fifa.world`)
- `lib/espn.ts` — `pollScores`: scoreboard for live scores + knockout team resolution, matched by `external_id`.
- `lib/espn-insights.ts` — match `summary` endpoint → odds (`pickcenter`→legacy `odds[]`), `lastFiveGames`
  (form), `headToHeadGames` (H2H), and `standings` (group table, already group-scoped). `pollInsights`
  warms upcoming open fixtures (≤5-day window, capped concurrency); `refreshInsights` is TTL-guarded.
  `mapInsightsView` is the typed boundary (coerces Supabase string-`numeric`s → numbers).
- `lib/odds-model.ts` — Poisson model: de-vig 1X2 → λ split → scoreline grid → top scores, BTTS,
  clean sheets, `pOver`. **Pure + unit-tested** (odds shapes are unstable; keep it defensive).
- **Cron:** `app/api/cron/tick/route.ts` (GET/POST, `CRON_SECRET` auth) is driven by **Supabase pg_cron**
  (`net.http_post`). Runs `pollScores → lockDueContests → settleFinishedContests → pollInsights`. No
  Vercel cron config.

## Verify before "done"
`npm run typecheck` (tsc) · `npm run build` (next build) · `npm test` / `npx vitest run`. For UI,
the authed screens need a real login — QC on staging via the user's logged-in Chrome
(`claude-in-chrome`); `chrome-devtools-axi` can't reach logged-in sessions.

## Leagues & QC safety
- **Real leagues — never write-test (no test picks):** **Solid Yenne Boys**, **KK Bois**, **PES Bois**.
- **Test League** — safe for writes, but uses placeholder teams (Gamma/Delta) with no ESPN ids → no
  real odds/insights. Members: `test{a,b,c,d}@cashford.internal`, `ananth@cashford.internal`.
- **Viewing** any league's screens is read-only-safe. The match page's insights cold-fill writes only
  to the `fixture_insights` cache (never a user pick).

## Design system
`docs/design/Cashford System.dc.html` ("Clean Sheet v1"; §07 = dark theme palette). Tokens live in
`app/globals.css` `@theme` (light) + `html.dark` (dark, class-based via `@custom-variant dark`).
Dark mode is class-based with a no-FOUC inline script in `app/layout.tsx` + `localStorage` `cf-theme`.
Fonts: Hanken Grotesk (text), Geist Mono (numerals/scores). Plans live in `docs/plans/`.
