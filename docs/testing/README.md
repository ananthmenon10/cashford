# Cashford testing — how everything runs

The standing entry point for every suite. One command per layer, one command for everything.
Every phase adds cases here; nothing ships while any of these is red.

## Layers & runners

| Layer | What it covers | Runner | Source of cases |
|---|---|---|---|
| Logic (pure) | settlement, gameweek points, tiebreaks, splits, odds model | `npx vitest run` (tags: `npm run test:phase1`, `test:phase2`, …) | docs/testing/phaseN-cases.md — written from the PLAN, never from the implementation |
| Persistence | migrations idempotence, RLS, triggers, lifecycle transitions, sync reconciliation | vitest (db-tagged) + `node scripts/verify-phaseN.mjs` against the real DB | same case docs |
| Browser (user-perspective) | UX/UI/flow/navigation/copy/feature | Playwright-style scripted flows via chrome-devtools-axi sessions, one named session per agent (`CHROME_DEVTOOLS_AXI_SESSION=worker-<n>`) against `https://cashford-staging.vercel.app` | docs/testing/phaseN-browser.md |
| Regression (all) | everything above | `npm run test:all` (added Phase 6) — vitest full + all verify scripts + browser golden paths | — |

## Rules

1. **Case docs precede code.** The test author (Sonnet) writes `phaseN-cases.md` + the suites from
   the phase PLAN doc while the implementer (Opus) builds from the same plan. Neither reads the
   other's output until both are done.
2. **Golden suites are frozen.** `lib/settlement.ts` tests (WC engine) and, after Phase 2,
   `lib/gameweek-*.ts` suites never get edited to make a change pass — a red golden test means
   the CHANGE is wrong until proven otherwise in review.
3. **Test data is disposable and namespaced.** Browser tests create their own leagues/users:
   leagues `ZZ-TEST-*`, users `p<N>test<x>@cashford.internal`. Never touch Solid Yenne Boys,
   KK Bois, PES Bois. Teardown scripts remove them (`scripts/qa-teardown.mjs` pattern).
4. **No live external fetches in tests.** FPL/ESPN/FotMob payloads are recorded snapshots in
   `tests/fixtures/` with a documented refresh script.
5. **Browser tests assert copy verbatim** for the strings in the copy system (they are product
   decisions, not decoration).
6. **Every settlement/points bug found later** gets a regression case added to the matching
   cases doc in the same PR as the fix.

## Current suites

- Phase 1: `docs/testing/phase1-cases.md` (schema/sync/matching) — unit + prod-readonly +
  authed-readonly persistence cases green; disposable-mode case bodies in progress (see below).
- Phase 2: `docs/testing/phase2-cases.md` (points/tiebreak/settlement/lifecycle) — the case
  matrix lives in docs/plans/2026-07-27-005 §6 until authored. Its persistence cases use the
  same disposable harness.

## Disposable Postgres harness (shared-table-mutating persistence cases)

Cashford has one shared prod DB (per the repo CLAUDE.md) — there is no separate staging
database. Persistence cases that mutate shared reference tables (`gameweeks`, `fixtures`,
`gameweek_fixtures`) — deadline freeze, FPL reconciliation, pot provisioning, the sync lease
protocol — must never run against the prod project ref, even using disposable/ZZ-TEST leagues,
because those tables aren't league-scoped. This harness gives them a real, throwaway Postgres
instead.

**Stand up + run, one command each:**

```bash
scripts/disposable-db/up.sh                                                            # (re)creates the container, applies every supabase/migrations/*.sql in order
node --env-file=.env.local scripts/verify-phase1-db-cases.mjs disposable --confirm-disposable
scripts/disposable-db/down.sh                                                           # tears it down (no volume — all data is gone)
```

Requires Docker reachable locally (`docker ps` must work — `colima start` if using Colima
instead of Docker Desktop). Image: `supabase/postgres:15.8.1.093` — the same base Supabase
CLI uses locally, so `auth.users`/`auth.uid()`, the `anon`/`authenticated`/`service_role`
roles, and `gen_random_uuid()` all work out of the box against our migrations without hand
stubbing anything.

- `scripts/disposable-db/00-bootstrap-auth.sql` seeds one `auth.users` row (username
  `ananth`) between the schema/RLS migration and the accounts migration — the accounts
  migration backfills `leagues.created_by` to that profile, a precondition that was already
  true in prod (ananth's account predates it) but doesn't exist on a fresh DB.
- Every disposable-mode case in `scripts/verify-phase1-db-cases.mjs` runs inside its own
  `BEGIN`/`ROLLBACK` (see `withRollback`) — nothing persists between cases, so the harness
  never needs re-seeding mid-run. `up.sh` gives you a clean empty-of-scratch-data DB at the
  post-migration baseline every time.
- **Safety history:** the original skeleton dispatch had 6 "disposable"-mode case bodies
  (P1-P01–P04, P1-P06, P1-I10) wired to the prod-facing `runSql()` Management-API helper
  instead of a local connection. Running `--confirm-disposable` for the first time against
  this harness surfaced it: P1-P06 and P1-I10 had executed real mutating statements against
  prod (an attempted double-open gameweek update and an attempted contests insert against
  real leagues). Both were rejected by a unique index / trigger with zero persisted change
  (verified read-only immediately after), but the bug — a disposable case able to reach
  prod at all — is now fixed: every disposable-mode case connects only to
  `DISPOSABLE_DB_URL` (default `postgresql://postgres:postgres@localhost:55432/postgres`),
  never the Supabase Management API.
