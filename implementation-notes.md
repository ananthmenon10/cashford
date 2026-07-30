# Phase 1 foundation — implementation notes

Built from `docs/plans/2026-07-27-003-phase1-foundation-plan.md` on branch `feat/p1-foundation`.
Nothing here is applied to the production database — the migration is written and syntax-checked
only. `lib/settlement.ts` is untouched.

## What was built

| Plan section | File |
|---|---|
| §1 schema, RLS, triggers, routines | `supabase/migrations/20260727000001_competitions_gameweeks.sql` |
| §3 FPL adapter (pure) | `lib/fpl.ts` |
| §4 sync + lease protocol | `lib/sync-fpl.ts` |
| §5 ESPN id matcher | `lib/espn-match.ts` |
| §6 runtime integration | `lib/espn.ts`, `lib/espn-insights.ts`, `lib/settle-contest.ts`, `app/api/cron/tick/route.ts`, `app/leagues/new/{actions.ts,page.tsx}`, `app/leagues/join/actions.ts`, `app/leagues/[slug]/m/[id]/page.tsx`, `app/dev/gameweeks/page.tsx` |
| §7 scripts | `scripts/{phase1-preflight,verify-phase1-ddl,sync-fpl-dryrun,sync-fpl-once,verify-phase1}.mjs` |

## Deployment order

1. `node --env-file=.env.local scripts/phase1-preflight.mjs` — writes the World Cup checksum that
   `verify-phase1.mjs` compares against. **Run this before the migration.**
2. Apply the migration via the Management API (see the repo CLAUDE.md).
3. `node --env-file=.env.local scripts/verify-phase1-ddl.mjs`
4. `node --env-file=.env.local scripts/sync-fpl-dryrun.mjs`
5. `node --env-file=.env.local scripts/sync-fpl-once.mjs` then `scripts/verify-phase1.mjs`
6. ESPN id matching (`matchEspnFixtures`) and `activate_competition` last.

## Deviations

Each of these departs from the letter of the plan. None changes settlement math.

**Reconciliation loops are procedural, not set-based.** §1.13 describes `apply_fpl_reconciliation`
as one call taking a whole snapshot; the body iterates the payload rows in PL/pgSQL rather than
doing set-based upserts. 380 fixtures a run makes the cost irrelevant, and the per-row branches
(deadline frozen, late assignment, kickoff moved, unresolved club) are far easier to read and to
prove correct one row at a time.

**Four routines the plan implies but does not name.** `claim_sync_lease`, `renew_sync_lease`,
`release_sync_lease` and `run_gameweek_maintenance` are required by the §1.9 lease protocol and the
§4 sync flow but are not in the §1.13 routine list. Added with the same security posture as the
named ones (SECURITY DEFINER, pinned `search_path`, `service_role` EXECUTE only).

**`activate_competition` calls maintenance twice.** Once before the status flip so the invariants it
checks are computed from fresh state, once after so the first gameweek opens without waiting for a
cron tick. Idempotent, so the second call is free when nothing changed.

**Invite tokens are 48 hex characters.** The plan does not specify a length. 48 hex characters is
192 bits, which is exactly what `lib/invite.ts` produces (24 random bytes, shown as 32 base64url
characters). The first draft of this note claimed 48 while the SQL actually emitted 64; the SQL now
truncates to 48 and note and code agree.

**NULL scores mean "no observation" in `apply_score_update`.** A poll that returns a fixture with no
score yet must not blank an existing score. The routine therefore treats NULL home/away as "leave
the stored score alone" and only ever overwrites with a real number.

**`pollScores` still issues a second, non-score UPDATE.** `apply_score_update` owns score, status,
`score_source` and `score_observed_at`; its signature is pinned by the plan, so the fields it does
not own (`status_detail`, `minute`, resolved knockout team ids and labels, `advancer_team_id`) go in
a separate update on the same row.

**`sync-fpl-once.mjs` drives the deployed cron endpoint instead of importing the sync.** A `.mjs`
script cannot import `lib/sync-fpl.ts`: Node strips the types fine, but the extensionless relative
import inside it (`./fpl`) fails ESM resolution. The script arms `next_due_at = now()` and POSTs
`/api/cron/tick`, which is what the plan describes anyway and has the side benefit of exercising the
real code path rather than a script-only copy.

**One club alias added to `lib/fpl.ts`.** FPL calls them "Leeds", ESPN "Leeds United", so one club
in twenty was unresolvable — which would have silently dropped 38 fixtures from every reconciliation
payload. Verified against both live feeds afterwards: no unmatched clubs.

**`create_league` writes no legacy cup contests.** Cup contests belong to the World Cup engine,
which `trg_contests_cup_only` now confines to cup-format fixtures. A league created against a league
-format competition gets gameweek pots instead, so the old per-fixture contest fan-out is gone from
the create path.

**The create-league form gained a competition picker.** `create_league` needs an explicit
competition slug and the plan does not say where the UI gets one. The form lists competitions with
`status = 'active'` and requires a choice. The `<select>` is deliberately not disabled in the
single-competition case — a disabled select submits no value.

**`matchFixture` was extracted as a pure function.** The ordered-teams / ±3h kickoff / same-season
rule now lives in one exported function that `matchEspnFixtures` calls, rather than inline in the
loop. Same behaviour, and it is the interface `tests/phase1/espn-match.test.ts` expects. Cost: the
ambiguous `sync_issue` detail records a candidate *count* rather than the candidate id list.

## Review round 1 (Sol) — all 11 findings fixed

Four blockers, six should-fixes, one nit. Each fix is listed with what it changed.

1. `run_gameweek_maintenance` now locks pots, not just gameweeks. A new block flips
   `gameweek_contests` from `open` to `locked` once `now() >= deadline_at`, keyed on the pot's own
   snapshot per §1.2 — never the gameweek's, because a drifted snapshot is the value members
   actually entered against, and keying on the snapshot also catches pots whose gameweek jumped
   straight to `completed`. Returns a new `pots_locked` count.
2. `pollScores` reads the `applied` flag. `apply_score_update` returning `applied:false` is a
   rejection, not an error, and the old code carried on to the second update — which could have
   rewritten `advancer_team_id` from a result the routine had just refused, changing the recorded
   knockout winner after the money was paid on the old one. Nothing after the RPC runs unless
   `applied === true`.
3. Removed `fixtures.lock_at` from both snapshot scripts. That column lives on `contests`, so the
   pre-migration safety gate was failing before it could write its checksum.
4. `create_league` and `join_league` now require `deadline_at is not null and deadline_at > now()`
   when picking the open gameweek. Database time decides, so cron lag can no longer provision an
   already-expired pot or make a joiner eligible for a gameweek that has closed.
5. `lib/fpl.ts` rejects instead of coercing: a present-but-unparseable kickoff no longer becomes
   "undated" (which would have erased a stored kickoff), scores must be null or non-negative
   integers, every row must map, and the raw array lengths are checked before mapping so 380 good
   fixtures plus malformed extras can no longer pass as complete.
6. The lease renews before every write stage — team writes, reconciliation, maintenance — and any
   failed renewal aborts. Release is checked for `true`, so losing the token can no longer be
   reported as a successful run.
7. Both team-identity reads now throw on error rather than reading as empty, which would have made
   all 20 clubs look unknown and created duplicates. If a new team's provider mapping fails, the
   team row it just created is removed.
8. `create_league` repeats the reserved-slug list and the ₹1,000,000 stake ceiling. `authenticated`
   can call the routine directly, so UI-only validation was not validation.
9. Dropped `gameweeks.completed_at` from the debug page — no such column, and PostgREST rejects the
   whole selection over it.
10. `verify-phase1.mjs` now justifies a missing membership instead of just counting them: the
    fixture's FPL event must actually be null in the fetched snapshot, and if it was ever assigned
    here, the unassignment must appear in `fixture_moves`.
11. The nit: see the invite-token deviation above. Code and note now agree at 48 hex characters.

Two of these are worth calling out as new duplication to keep in step: the reserved-slug list now
exists in both `lib/validation.ts` and `create_league`, and the stake ceiling in both
`validateStake` and the routine. Security checks on a routine `authenticated` can call directly have
to live in the routine; the TS copies stay for the error messages.

### How the SQL fixes were verified

`initdb`/`postgres` are available locally, so rather than eyeball the SQL I stood up a disposable
Postgres 16 cluster, stubbed the 14 pre-existing `cashford` tables from the live schema (via
`information_schema` over the Management API) plus `auth.uid()` and `my_league_ids()`, and applied
the migration end to end — clean, 25 tables. Then I executed the changed routines and asserted the
behaviour: `create_league` and `join_league` both refuse an expired open gameweek (null eligibility,
no pot), the invite token matches `^[0-9a-f]{48}$`, the reserved slug and the over-ceiling stake
both raise, and a pot past its own deadline goes to `locked` with `pots_locked: 1`. Cluster torn
down afterwards. Nothing was applied to the production database.

`scripts/phase1-preflight.mjs` also now runs green against the real database (read-only, 106
fixtures, checksum written), which is the blocker-3 fix proven on live data, and the live FPL feed
still passes the stricter validation (38 events / 20 teams / 380 fixtures).

## Where the score-source predicate lives

There is no `lib/score-source.ts` and no TypeScript `canWriteScore`. §2 encodes field ownership as
write predicates inside `cashford.apply_score_update`, and a TypeScript copy of a money-adjacent
rule is a second source of truth that can drift from the one the database enforces. The test author
had written `tests/phase1/score-source.test.ts` against such a module; it has since been removed and
the predicate's behaviour is covered by the persistence-layer cases instead. Anything that needs to
know whether a score may be written must call the routine and read its `applied` flag — which is
what finding 2 above made `pollScores` do.

---

# Phase 2 — gameweek entries, settlement, API

Stages 2–4 of the plan `docs/plans/2026-07-27-005-phase2-engine-plan.md`: the database layer, the
service-side worker, and the route handlers on top of the pure engine. The engine itself
(`lib/gameweek-points.ts`, `lib/gameweek-settle.ts`) is untouched — all settlement math still lives
only there, and `lib/settlement.ts` was not opened.

## What was built

`supabase/migrations/20260727000002_gameweek_entries.sql` — one transaction, idempotent, 19
sections. Tables `gameweek_entries` / `gameweek_picks` / `gameweek_entry_results` /
`gameweek_results` / `gameweek_audit_log`; the composite unique keys §0.0 asks for on the Phase 1
tables; `transfers` gains a nullable `contest_id` and a `gameweek_contest_id` with an
exactly-one-of check and payer/receiver FKs that prove the payer entered that pot; RLS including
the pick reveal rule (`e.user_id = auth.uid() or gc.deadline_at <= now()`) enforced in the policy,
not the API; the §0.6 concurrency spine on `gameweek_contests`; the advisory-lock helpers; the §0b
effective-membership function; `bump_gameweek_input`; `refresh_entry_completeness`; the user
routines `enter_gameweek` / `update_gameweek_picks` / `mirror_gameweek_entry`; the L7 state machine
`claim_gameweek_settlement` / `abort_gameweek_settlement` / `finalize_gameweek_settlement`; and
rewrites of `apply_score_update` and `apply_fpl_reconciliation` to take the locks in the one global
order and bump `input_version`. `run_gameweek_maintenance` gains L3 entry resolution, immediate W1
voids, and the dirty-W1 refresh path.

`lib/gameweek-db.ts` — `settleGameweekContest` (claim → map the snapshot into `GwInput` →
`settleGameweek` → finalize, aborting on compute failure), `dispatchGameweekSettlements` (the §0.6
scan over ready / dirty / expired pots), and `leagueNetByUser`, which is the Dues aggregation:
legacy `contest_results.net_inr` plus `gameweek_entry_results.net_inr`, reversed transfers excluded
because the per-entry result rows carry the current settlement only.

`app/api/gw/{enter,picks,mirror,contest}/route.ts` with the shared plumbing in `lib/gw-api.ts`. All
four use the session-scoped client, so `auth.uid()` inside the routines is the real player. Zod
checks shape only. `app/leagues/[slug]/page.tsx` now reads its nets from `leagueNetByUser`, and
`app/api/cron/tick/route.ts` dispatches settlement right after `gameweekMaintenance`.

`scripts/verify-phase2.mjs` — the §6 integration smoke: a scratch competition, its own fixtures and
a `ZZ-TEST-P2` league, 5 members, 4 enter and 1 skips, a fixture addition drives needs_update, 3
resolve and 1 goes invalid, scores land, the worker settles, then a revision of the one fixture the
top two disagreed on flips the winner and the worker re-settles. Ordered cleanup, and it refuses to
run if migration 000002 is not applied. It has NOT been run yet — it needs the migration on the
shared database, which is the orchestrator's step.

## Proof

The migration applies cleanly and twice (25 → 30 tables) on a disposable Postgres 16 built from the
real migration files. 95 routine-level assertions pass against that twice-applied schema, covering
entry and edit validation, L9 eligibility including the NULL boundary, mirror (stake mismatch writes
nothing), the RLS reveal rule through `set role authenticated`, deadline enforcement after the
locks, L3 resolution, W1 voids, the claim/finalize round trip (foreign token, replayed token, short
payment, incomplete entry set), re-settlement with reversal, retry-on-moved-input, abort, the
11-minute claim expiry, the §0b effective rule, combined-cause bumps, and the privilege/realtime
posture.

The TypeScript worker was then run against that same database through a pg-backed stand-in for the
supabase-js calls: 19 assertions covering the full golden scenario — settle (u1 takes ₹200, Σ net 0,
2 transfers), an idle pass that writes nothing, a revision that flips the pot to u2 (4 transfer rows,
2 reversed, Σ non-reversed net 0, `settled_version` advanced, audit chain with both settlements),
and a corrupt snapshot that aborts, returns the pot to `settled` with no claim held, and logs a
`sync_issues` row.

`npm run typecheck` and `npm run build` are green (the four `/api/gw/*` routes appear in the route
table). `npx vitest run` is 274 passing: the 203 legacy `lib` tests and 30 Phase 1 tests unchanged,
plus the 41 Phase 2 engine tests.

Untested surface, stated plainly: nothing has run through PostgREST. The supabase-js query shapes in
`lib/gameweek-db.ts` (the `gameweek_results!inner` embed in the dirty scan, the `sync_issues`
insert) and every route handler are typecheck-and-build proven only. `scripts/verify-phase2.mjs` is
what covers them, and it runs once the migration is applied.

## Deviations

**Five columns the plan does not name.** `gameweek_contests.input_version_txid` implements the
"bump at most once per transaction" rule by comparing against `pg_current_xact_id()`; a
transaction-local temp table would have been the alternative and temp tables do not work inside
`search_path = ''` routines. `gameweek_contests.pending_cause` carries the re-settle cause from the
bump that dirtied the pot to the finalize that consumes it, which is the only way
`gameweek_results.last_settle_cause` can be accurate. `gameweek_results.pot_inr`,
`gameweek_entries.updated_at` and `gameweek_entry_results.settled_at` are conveniences the UI will
want and that cost nothing.

**`enter_gameweek` reuses an existing entry instead of raising.** A player who taps submit twice
should not see an error. The routine replaces the pick set and reports `created: false`; the edit
routine still refuses when no entry exists, so the two are not interchangeable.

**Both `gameweek_picks` foreign keys to the entry cascade on delete.** Picks have no meaning without
their entry, and the entry row itself is never deleted after the deadline.

**The SQL boundary is snake_case.** The routines return and accept `pred_home`, `net_inr`,
`from_user_id`; `lib/gameweek-db.ts` maps to and from the engine's camelCase in one place each way,
so a shape change on either side is a type error rather than a silent misread.

**Explicit table-level `revoke insert, update, delete` from anon and authenticated.** This schema's
default privileges grant everything, so the RLS policies alone would not have stopped a direct
write; the revokes are what make "picks are only written by a routine" true.

**Zod was added as a dependency.** §7 names it and the repo did not have it (3.25.x).

**`league_members.left_at` lands in Phase 2, ahead of its plan.** It is Phase 5 §1.1 M2's column,
but the leave routine has nowhere else to record a departure and deleting the row breaks the
`member_competitions` foreign key that entry depends on. Only the column and the two routines
(`leave_league`, `archive_league`) land here; the `my_league_ids()` redefinition, rejoin, and the
remaining current-member reads stay with Phase 5. A null `left_at` means "current member", so every
existing reader behaves as before.

## Traps worth remembering

`record IS NOT NULL` in PL/pgSQL is true only when *every* field is non-null, so testing a fetched
`gameweek_results` row that way silently reported "no result" for every settled pot — the dirty
predicate never fired. Presence must be tested on a NOT NULL column, here the primary key. This was
a real bug that only execution caught; review had read straight past it.

`create temp table … on commit drop` inside a `search_path = ''` SECURITY DEFINER routine does not
work: `pg_temp` is not on the path, and ON COMMIT DROP invalidates cached plans across transactions.
Three routines were rewritten to use inline `jsonb_to_recordset` and one CTE instead.

`array_agg` over zero rows returns NULL, not an empty array, and `FOREACH … IN ARRAY NULL` is a hard
Postgres error rather than a zero-iteration loop. The L8 completeness step in
`apply_fpl_reconciliation` was written as
`foreach v_gw in array (select array_agg(distinct u) from unnest(v_touched_gws) u)`, which aborted
the entire reconciliation transaction — bundled deadline and score updates included — on every run
where no fixture changed an *active* membership. That is the ordinary steady-state run, so this
would have crashed nearly every FPL sync in production. It also fired on a *deadline-only* batch
(`fixtures: []`), where the membership loop never runs at all — so a routine deadline tweak took the
whole transaction down too. Eight reproductions from the Phase 1 test author: P1-P01–P04 (deadline
only) and P1-P13, P1-P17, P1-P35, P1-P37 (membership churn). Fixed by driving the loop from a query
(`for v_gw in select distinct u from unnest(v_touched_gws) u`), which matches the idiom
`lock_gameweeks` already uses and is null-safe by construction rather than by a `coalesce` that a
later edit could drop. Both entry routes — deadline-only and membership-churn — are pinned in
`scripts/verify-phase2.mjs` against a second scratch `fpl_source` competition, plus an active-move
control so the fix cannot be "corrected" into never refreshing completeness at all. Verified both
ways on the disposable cluster: the pre-fix routine fails on the deadline-only batch *and* on the
first membership shape, the fixed one passes all 20 assertions.

**A PostgREST embed is ambiguous when the child has two foreign keys to the same parent, and the
error is easy to swallow.** `gameweek_entry_results` references `gameweek_entries` twice — once from
its own primary key and once from the composite `(entry_id, gameweek_contest_id)` — so
`gameweek_entries!inner(…)` is refused and the embed has to name the constraint:
`gameweek_entries!gameweek_entry_results_entry_id_fkey!inner(…)`. The Dues reader had been adding
`data ?? []` on error, which would have rendered every settled gameweek as ₹0 owed while the transfer
rows sat in the table. Select strings are plain strings — nothing type-checks them — so the fix is
pinned twice: a unit test asserts the hint is present *and* that the migration still declares both
keys, and `scripts/verify-phase2.mjs` runs the same select against the live schema.

**A set-returning RPC returns an array of row objects; a scalar one returns the bare value.**
`admin.rpc("gameweek_settlement_candidates")` yields `[{gameweek_contest_id, reason}, …]`, unlike
every other routine here which returns one jsonb. The pg-backed shim in `scratchpad/pg/worker-run.mts`
had to learn the same distinction (`select * from f(…)` versus `select f(…) as r`), and the caller
guards with `Array.isArray(data) ? data : []`.

## Reconciliation voids an active row even when its gameweek has frozen — intended

Flagged as a possible deviation on a fixture move away from a completed gameweek. It is not one.
The Phase 1 plan §4 step 3 conditions how the old row closes on **the row's own state**, not on the
source gameweek: "if it was `active` → set state='void' … if it was `excluded` → clear is_current
ONLY (it keeps state='excluded'; it was never counted, so it is not 'voided')". The frozen test in
the plan governs the **destination** only — "Adding the destination membership as ACTIVE … is
allowed only when the destination gameweek is NOT frozen". §1.2 also *depends* on the unconditional
void: a gameweek completes only when every active membership points at a finished fixture, and
fixtures that go `postponed`/`cancelled`/`abandoned` "must first have their membership voided under
§4's reconciliation rules before the gameweek can complete". A postponed fixture is unassigned by
FPL after its deadline has passed, so the source gameweek is always frozen at that moment. Making
the void conditional on a non-frozen source would leave the membership active forever, and any
gameweek containing a postponed fixture could never complete or settle. Behavior unchanged.

## Phase 2 review round 1 (Sol) — all 8 findings fixed

**1 (BLOCKER). Dues silently read zero for every gameweek.** `gameweek_entry_results` has two
foreign keys to `gameweek_entries` — the primary key's own reference and the composite
`(entry_id, gameweek_contest_id)` — so PostgREST rejects an unhinted `gameweek_entries!inner(…)`
embed as ambiguous. `leagueNetByUser` was discarding that error and adding an empty list, which
would have shown a member who won ₹200 as owed nothing while the transfer rows sat there. The embed
now names `gameweek_entries!gameweek_entry_results_entry_id_fkey`, and **both** Dues reads throw on
error rather than defaulting to zero. `lib/gameweek-db.test.ts` pins the hint, the summation across
both eras, and the throw-on-error; `scripts/verify-phase2.mjs` probes the same embed against the
real schema, because a hand-written PostgREST select string cannot be type-checked.

**2 (MAJOR). An edit deleted the pick for a void fixture, breaking L4.** Both write paths deleted
every stored pick and re-inserted only the currently active ones, so editing after one fixture went
void threw that fixture's prediction away — and if it returned before the deadline the entry became
incomplete and eventually `invalid`, contradicting L4's promise that the original pick counts again.
Entry now deletes only picks whose fixture is effective-active *now*; mirror deletes only the
fixtures the source actually predicted and copies `sp.membership_id` straight across, so provenance
is the source's, not a re-derived row.

**3 (MAJOR). An expired claim on unready data stayed stamped `settling` forever.** Readiness was
checked before expiry, so a worker that crashed after claiming and then saw a `finished → live`
correction got `not ready` on every later tick and never reached the reclaim branch. Expiry is now
computed before the readiness return, and an expired unready claim restores `claim_prior_status`,
clears every claim field, writes the `abort` audit row with `released: expired-unready`, and returns
`released: true` alongside `not ready`.

**4 (MAJOR). Finalize accepted any split that summed correctly.** Per-loser totals and Σnet = 0 are
necessary but not sufficient: ₹98/₹1/₹1 to three winners passed every check, as did two rows for one
pair whose sum matched. Finalize now derives M3's matrix in SQL — winners ordered by `user_id`,
`floor(stake / winners)` each, the leftover ₹1s to the first winners, zero rows dropped — aggregates
the payload by pair, and rejects any missing, extra, duplicate or mismatched pair.

**5 (MAJOR). Leave and archive had no transactional writer.** `removeMember` deleted the
`league_members` row, which `member_competitions` references, and `archiveLeague` moved only
`leagues.status` while the `league_competitions` row stayed `active` — the row entry actually checks
— so members could keep entering an archived league. New `cashford.leave_league` and
`cashford.archive_league` take the L9 rows in the L9 order (competition gate → `league_competitions`
→ `member_competitions`), set `left_at` or flip both statuses, and delete nothing. Entry and mirror
also re-read `leagues.status` *after* taking the `league_competitions` lock, which is what serializes
them against an archive in flight.

**6 (MAJOR). The dispatcher limited before it filtered.** Three client-side scans applied `.limit()`
ahead of the readiness and dirty predicates with no ordering and no error check, so a few hundred
clean settled pots could fill every scan while one corrected contest stayed dirty forever, and a
settled pot with no result row was excluded by the inner join and never reached the corruption check.
Replaced by `cashford.gameweek_settlement_candidates(p_limit)`, which applies the full
ready/dirty/expired/corrupt predicate set, orders corrupt → expired → dirty → ready then by deadline,
and only then limits. Every scan error now throws.

**7 (MAJOR). Mirror's completeness test passed vacuously on an empty gameweek.** With every fixture
void the "source covers the target's fixtures" check had nothing to iterate, so mirror reported
success after creating an entry with no picks. It now counts effective-active fixtures under the
gameweek lock and refuses at zero, and asserts after the write that the copied active pick count
equals that number.

**8 (MINOR). `pot_inr` was taken on trust.** A worker regression sending correct transfers with
`pot_inr: 1` settled the money correctly and showed a ₹1 gross pot everywhere. Finalize now rejects
any supplied value that is not `stake × entrants`.

**Landed now vs left to Phase 5.** Only `league_members.left_at` (Phase 5 §1.1 M2's column) and the
two routines land here — the leave routine has nowhere else to record a departure, and deleting the
row breaks the `member_competitions` foreign key. Left to Phase 5: the `my_league_ids()` redefinition
(M3), rejoin (M4), and every remaining current-member read. A null `left_at` means "current member",
so existing readers are unaffected, but two consequences are live in the meantime and belong to
Phase 5 to close: **a removed member cannot rejoin** (`join_league` inserts on conflict do nothing,
so the closed row is left closed), and **departed members still appear in league member lists**
outside the manage screen, which was filtered here so that removal visibly works.

**Pins.** `scratchpad/pg/rework-test.sql` — 38 assertions on the disposable cluster covering all
eight: the retained void pick and its return, mirror provenance, the zero-active refusals, leave and
archive plus the entry/mirror rejections, the four candidate reasons and the priority order under
`limit 1`, the expired-unready release and its audit row, the four rejected payloads (98/1/1,
duplicate pair, missing winner, wrong pot) and the lawful 34/33/33. Full chain on a twice-applied
schema: 95 + 20 + 38 SQL assertions, 19 worker assertions, 277 Vitest tests, typecheck and build.

One of Sol's findings caught a bug in the test suite rather than the code: `test.sql` finalized a
three-entrant ₹500 pot with `pot_inr: 1000`. The engine would have sent 1500; the fixture was wrong
and nothing had been checking it. Finding 8's derivation is what surfaced it.

## Phase 2 review round 2

Round one's fixes introduced two regressions. Both are about behaviour no unit test can reach, so
both are proved against a real Postgres: `scripts/disposable-db/round2-test.sql` (11 assertions) and
`scripts/disposable-db/round2-proof.mts` (24 assertions across three parts, two live sessions).

**1 (MAJOR). A pile of corrupt pots owned the settlement queue forever.** Filtering before the
`LIMIT` was not enough. A pot that is `settled`/`void` with no result row cannot be repaired by the
worker — the claim routine only files a `sync_issue` — so it stayed a candidate for as long as the
bad data existed, and it ranked *above* every money-bearing reason. Forty of them filled the default
limit of 40 on every pass, so an abandoned claim or a dirty pot was never dispatched and wrong money
stayed on screen indefinitely. It also wrote a fresh duplicate finding every tick.

Two changes bound it. `gameweek_settlement_candidates` now drops a corrupt row once an *unresolved*
`missing-result-row` issue for it exists, so each one consumes the queue once instead of forever;
and corrupt now sorts **last**, below expired, dirty and ready, so even an unfiled corrupt row can
never displace work that moves rupees. `claim_gameweek_settlement` files the issue with
`insert … select … where not exists`, once per row, and resolving the issue puts the row back in the
queue — which is what an operator who has repaired the data wants. Bound: every actionable contest
is reached within `ceil(unfiled_corrupt / limit) + 1` passes. Added
`idx_sync_issues_open_ref (kind, ref) where resolved_at is null` for both tests.

**2 (MAJOR). Join and archive deadlocked.** `join_league` (Phase 1, applied) takes the `leagues` row
first, then inserts `member_competitions`, which needs a foreign-key lock on a `league_competitions`
row. `archive_league` took `league_competitions` first and only reached `leagues` at the end, so the
two waited on each other and Postgres aborted one with `40P01`.

Fixed in the new Phase 2 routines, not in Phase 1, two ways at once:

1. `leave_league` and `archive_league` now take the `leagues` row **first** — the same first row join
   takes — so the lifecycle writers meet join at the top of the order instead of halfway down.
2. Every step-4 row lock on `league_competitions` / `member_competitions` is now `for no key update`
   instead of `for update`, in `leave_league`, `archive_league`, `write_gameweek_entry` and
   `mirror_gameweek_entry`. Nothing deletes those rows or changes their keys, so it is the correct
   strength — and unlike `FOR UPDATE` it does not conflict with the `FOR KEY SHARE` lock another
   transaction's foreign-key insert needs. That takes foreign-key waits out of the lock graph
   entirely while still excluding every real writer (`FOR NO KEY UPDATE` conflicts with itself and
   with `FOR UPDATE`), so L9 serialization is unchanged. `write_gameweek_entry` and
   `mirror_gameweek_entry` are included because they held the same `FOR UPDATE` and had the same
   cycle with join.

The `leagues` lock is also `for no key update`, deliberately: `FOR UPDATE` there would have closed a
*new* cycle with `run_gameweek_maintenance`, which holds the competition gate and then needs a
foreign-key lock on `leagues`.

**3. The candidate-routine contract had no test.** `lib/gameweek-db.test.ts` covered Dues only. Six
tests added: the dispatcher throws on a failed scan and dispatches the routine's rows in the
routine's order without re-sorting; and the routine keeps predicates before the limit, ranks corrupt
last, suppresses a filed corrupt row, and files the finding once.

**Proof.** Vitest 283/283, `tsc --noEmit` clean. On a freshly rebuilt disposable cluster (never the
shared DB): migration 000002 applies twice cleanly; `rework-test.sql` 38/38 (no regression);
`round2-test.sql` 11/11; `round2-proof.mts` 24/24 — pass 1 settles both money-bearing pots with 40
corrupt rows in the queue, pass 2 drains the 2 that did not fit, passes 3 and 4 return nothing and
file no duplicates, a newly corrupted pot is still reported; join vs archive in both interleavings
with a verified lock-wait overlap, no `40P01` and no timeout, one valid serial outcome each way; and
part C replays the reported cycle at row level — `FOR UPDATE` reproduces `40P01`, `FOR NO KEY UPDATE`
does not. `lib/settlement.ts` is byte-identical to HEAD.

Not proved here: the shared Supabase DB has not had the migration applied, so the deployed-schema
and live PostgREST checks remain a release gate (tasks 3 and 4).

## Deviations

**Round 2, finding 2 — the fix reaches two routines the review did not name.**
`write_gameweek_entry` and `mirror_gameweek_entry` held the same `FOR UPDATE` on
`league_competitions` / `member_competitions` and therefore had the same cycle with `join_league`
that archive did. Fixing only archive and leave would have left the identical deadlock reachable
from a normal entry. Both are Phase 2 routines, and the change is a lock-strength downgrade to the
strength the writes actually need, so nothing about their semantics moves.

**Round 2, finding 2 — the shared lock order starts at `leagues` with `FOR NO KEY UPDATE`, not
`FOR UPDATE`.** The brief said to match `join_league`, which uses `FOR UPDATE`. Matching it exactly
would have closed a new cycle with `run_gameweek_maintenance` (gate first, then a foreign-key lock on
`leagues`). `FOR NO KEY UPDATE` still conflicts with join's `FOR UPDATE`, so the two serialize as
required; it only stops blocking foreign-key locks. `join_league` itself is untouched.

**Round 2 — `round2-test.sql` and `round2-proof.mts` need a fresh cluster, one run each.** Their
pass counts are exact and the dispatcher scans globally, so a second seed in the same cluster changes
the numbers. Both files guard on this and fail loudly rather than reporting a wrong count; the
existing `rework-test.sql` was verified separately on its own fresh cluster.

## Phase 2 review round 3

Sol's round-3 pass confirmed both round-2 fixes and validated the `FOR NO KEY UPDATE` deviation, then
raised two MAJOR findings. Both are fixed in the working tree; the write-up below is a checkpoint, not
the final report, because Ananth paused the work before the last regression run finished.

**Finding 1 — an expired claim on a pot with fewer than two locked-in entrants owned the queue.**
`gameweek_settlement_candidates` ranks `expired` first with no entrant or readiness gate (correct: only
a release clears it), but `claim_gameweek_settlement` refused a sub-2-entrant pot *before* it worked out
whether the claim had expired, so the row stayed in `settling` and came back at rank 0 on every pass.
Forty of them starved a real dirty pot forever. Fixed as a class, not a branch:
`supabase/migrations/20260727000002_gameweek_entries.sql` now computes `v_expired` immediately after the
contest read, ahead of the first validation gate, and every refusal reachable while `status='settling'`
funnels through one new routine, `cashford.release_expired_gameweek_claim(uuid, text)` (2 call sites,
`'expired-under-min-entrants'` and `'expired-unready'`), which restores `claim_prior_status`, nulls the
claim stamp and writes an `abort` audit row. Verified by inspection that the `<2` gate was the only
remaining pre-expiry early return. Also closed an adjacent hole the brief did not name: `settling` with
a *null* claim stamp is now treated as abandoned by both the scan and the claim routine — changing one
side only would have minted a fresh permanent candidate. Bound now stated in the PROGRESS INVARIANT
comment: every actionable contest is reached within `ceil((unfiled_corrupt + stuck_expired) / limit) + 1`
passes.

**Finding 2 — repeated join versus null-boundary maintenance deadlocked.** Cause was lock *strength*:
Phase 1's `join_league` takes the `leagues` row `FOR UPDATE`, which refuses the `FOR KEY SHARE` that
maintenance's pot insert needs for its foreign key, while the repeated join parked in its
`member_competitions ON CONFLICT DO NOTHING` behind the row maintenance had just updated. Section 18d of
000002 `CREATE OR REPLACE`s `join_league` with Phase 1's body and exactly one word changed
(`for update` → `for no key update`); 000001 stays as applied and reviewed. Join-vs-join and
join-vs-leave/archive still serialize because `FOR NO KEY UPDATE` conflicts with itself and with
`FOR UPDATE`. `app/leagues/join/actions.ts` additionally short-circuits genuine re-joins, gated on a new
`hasUnprovisionedCompetition` read so the only `member_competitions` backfill path is preserved.

### Round 3 checkpoint (paused, then cleared — see the final gate below)

Done, and green as of the pause:
1. Both fixes are complete in the tree — migration 000002 (release routine, expiry-first claim ordering,
   scan predicate, PROGRESS INVARIANT comment, section 18d `join_league`, privilege block for both new
   routines) and `app/leagues/join/actions.ts`.
2. New proofs written and passing on their own fresh clusters: `scripts/disposable-db/round3-test.sql`
   → 19 PASS + "ALL ROUND-3 SQL CHECKS PASSED"; `node scripts/disposable-db/round3-proof.mts` → 25 PASS
   / 0 FAIL, including the 4-pass dispatcher run (pass 1 releases all 40, pass 2 settles the dirty pot,
   pass 3 scans 0, pass 4 re-settles a released pot once it has two entrants) and the two-session barrier
   test in both interleavings; part C reproduces `40P01` with Phase 1's `FOR UPDATE` body on the same
   cluster and then runs clean with the shipped body.
3. Gates re-run: `npx vitest run` 288/288 across 23 files (5 new tests in `lib/gameweek-db.test.ts`),
   `npx tsc --noEmit` clean, `git diff --quiet lib/settlement.ts` clean, 000002 applies twice on a
   seeded cluster (only DROP POLICY / "already exists, skipping" output).
4. `rework-test.sql` regression re-run: PASS, ending "ALL REWORK REGRESSION TESTS PASSED". Its path is
   **not** repo-relative — it lives at
   `/private/tmp/claude-501/-Users-ananthmenon-AI-projects-cashford/38c9d2f6-624a-4514-b526-559c5df2cfa6/scratchpad/pg/rework-test.sql`.

Remaining when work resumes (nothing else is outstanding on either finding):
1. On a fresh cluster (`scripts/disposable-db/up.sh`), run `scripts/disposable-db/round2-test.sql`
   (expect 11 PASS) then `node scripts/disposable-db/round2-proof.mts` (expect 24 PASS) — the last
   regression gate, not yet run against the round-3 tree.
2. Send the per-finding raw-data report to `team-lead`.
3. Still out of scope here and release-gated: applying 000002 to the shared Supabase DB and running
   `verify-phase2.mjs` / staging QC.

Nothing is committed, pushed, or applied to the shared Supabase DB.

## Deviations

**Round 3, finding 1 — the fix covers a case the brief did not name.** A pot sitting in `settling`
with all three claim fields null is permitted by `chk_gw_contest_claim_coherent` and was invisible to the
old expiry test (`claim_started_at < now() - interval '10 minutes'` is null-false). Both the scan and the
claim routine now read `claim_started_at is null` as abandoned. Treating it in one place only would have
created exactly the starvation the finding describes.

**Round 3, finding 2 — `join_league` is replaced in 000002 rather than fixed only in the caller.** The
brief preferred a caller-side short-circuit. A caller cannot close the cycle: `consumePendingInvite` and
any future caller can still reach the routine, and the routine is the thing that takes the too-strong
lock. So both were done — the short-circuit removes the pointless write, and 18d removes the deadlock.
000001 is untouched, and the change is one word of lock strength with the body otherwise verbatim, so
nothing in join's semantics or its L9 position moves.

**Round 3 — `round3-test.sql` and `round3-proof.mts` need a fresh cluster, one run each,
`round3-test.sql` first.** Same reason as round 2: exact counts over a globally-scanning dispatcher. The
`.mts` guards on finding exactly 40 abandoned claims and exits 1 otherwise, and it expects 43 audit
releases (40 from its own pass plus the 3 probe rows `round3-test.sql` releases directly).

### Round 3 final gate (resumed 2026-07-30) — everything above is now re-verified

Every suite re-run from scratch after the pause, one fresh disposable cluster per suite:
1. `scripts/disposable-db/round3-test.sql` — **19 PASS**, 0 FAIL, "ALL ROUND-3 SQL CHECKS PASSED". A
   second run on the same cluster refused with the fresh-cluster guard, as designed.
2. `node scripts/disposable-db/round3-proof.mts` — **25 PASS / 0 FAIL**, "ALL ROUND-3 MULTI-SESSION
   PROOFS PASSED". Part A: pass 1 scans 40 and settles nothing, 0 rows left `settling`, 43 audit
   releases, 43 rows back to their prior status; pass 2 settles the dirty pot at `input_version` 4 and
   moves rupees, inside the stated bound of 2; pass 3 scans 0; pass 4 settles a released pot once it has
   two entrants. Part B: both interleavings reach `[true,1,1]` with no 40P01 and no lock timeout. Part C:
   Phase 1's `FOR UPDATE` body reproduces "join: 40P01 deadlock detected", the shipped body runs clean.
3. `scripts/disposable-db/round2-test.sql` — **11 PASS**, "ALL ROUND-2 SQL CHECKS PASSED";
   `node scripts/disposable-db/round2-proof.mts` — **24 PASS / 0 FAIL**, exit 0.
4. `rework-test.sql` (round-1 rework regression) — **38 PASS**, 0 FAIL, "ALL REWORK REGRESSION TESTS
   PASSED", exit 0.
5. Migration 000002 re-applied to an already-seeded cluster: exit 0, zero errors.
6. `npx vitest run` 288/288 across 23 files · `npx tsc --noEmit` clean · `lib/settlement.ts`
   byte-identical to HEAD.

Cluster torn down. Nothing committed, pushed, or applied to the shared Supabase DB. The deployed-schema
and live PostgREST checks remain a release gate (tasks 3 and 4).

# Phase 3 — core UI

Built from `docs/plans/2026-07-27-006-phase3-core-ui-plan.md` v6 and the binding amendments in
orchestrator decisions #21, #23, #29 and #32. Both Phase 1 and Phase 2 migrations were already applied
to the shared database before this work began, and the live PostgREST gate had passed.

## Phase 3 implementation

### Stage 1 — tokens and shared badge

Added the Clean Sheet 2.0 light and dark token sets beside the existing World Cup tokens, wrote the
mockup class map, and added the typed gameweek branch to `StatusBadge`. The legacy badge map and
World Cup call shape remain unchanged. `lib/gw-copy.ts` starts with the gameweek badge copy needed by
this stage; the rest of the copy system lands in Stage 2.

Gate: `npx tsc --noEmit` passed. `npx vitest run` passed 288 tests across 23 files, with no skipped
tests.

### Stage 2 — pure gameweek libraries

Added the ordered CL0–CL10 classifier, VP0–VP5 participation resolver and render precedence; the
copy catalog; fixture-history collapse; dual-boundary eligibility and entered-count rules; live
points projection through `settleGameweek`; IST formatting; the caller-less model-chip mapper; and
the X-P5-1 dirty predicate in `lib/net-balance.ts`. The pure `resolveGameweekView` candidate chooser
and dirty DTO filter also landed because the blind Stage 2 suite imports them without exercising any
database path.

The blind tests appeared during the first gate. I changed only implementation files to meet their
public shapes. A review pass checked the state-tree order, zero-active handling, snapshot-point drop,
eligible denominator, void-fixture inclusion, and the absence of provisional money from the live
projection.

Gate: `npx tsc --noEmit` passed. `npx vitest run` passed 370 tests across 31 files, with no skipped
tests.

### Stage 3 — league shell and read-only gameweek lifecycles

Moved the World Cup league page intact to `_cup/CupLeagueView.tsx` and made the original route choose
the active participation before the archived fallback. Added the league shell, route-backed tab
links, gameweek strip, CL0–CL10 state header, snapshot pot facts, entry summary, current or settled
standings, fixture rows, and the named recalculation and sync-issue notes.

The league-format loader uses the session client for identity and detail reads. It checks every query
error, scopes global reference reads from proved competition and gameweek ids, uses FK hints on
ambiguous entry embeds, asks for other members’ picks only after the contest deadline, drops result
snapshots in dirty states, and uses one service read only for names missing from the current RLS
roster.

Gate: `npx tsc --noEmit` passed. `npx vitest run` passed 468 tests; 12 blind entry-sheet placeholders
were skipped across 40 files.

### Stage 4 — entry sheet and write path

Added the full-height entry route, 0–9 keyboard-accessible score steppers, server-rendered IST
deadline with a client-only relative countdown, completion progress, session-storage crash recovery,
specific deadline and retry copy, and the mirror prompt. A first save sends the full pick set in one
request to `/api/gw/enter`; an edit sends one request to `/api/gw/picks`. The sheet has no form action,
so disabling JavaScript leaves the absolute deadline visible and the money write inert. It performs
no insights query and mounts no score chips.

Gate: `npx tsc --noEmit` passed. `npx vitest run` passed 468 tests; the same 12 blind entry-sheet
placeholders remained skipped across 40 files.

### Stage 5 — Season tab

Added route-backed season history and running-total panes. The loader keeps departed players by ids
already present in scoped entry rows, counts every `locked_in` entry including clean void gameweeks,
and recomputes dirty points through the current gameweek view. A dirty row shows no stored money and
suppresses each member total it feeds; unavailable dirty points are suppressed instead of replaced
with zero or a stored snapshot.

Gate: `npx tsc --noEmit` passed. `npx vitest run` passed 468 tests; the same 12 external placeholders
were skipped across 40 files.

### Stage 6 — home league cards

Rebuilt only the Leagues panel with gameweek-aware cards while leaving Matches and Analytics in
place. Each card now names the competition, derives its badge from the shared lifecycle state,
links the open-entry action to the entry sheet, and uses season totals for league-format money.
When any row feeding that total is dirty, the card shows recalculation copy and no stored amount.
Cup cards keep their prior contest-result net.

Gate: `npx tsc --noEmit` passed. `npx vitest run` passed 468 tests; the same 12 external placeholders
were skipped across 40 files.

### Stage 7 — create and join

Added the active-only competition picker and a zero-active state that blocks league creation. The
create form now uses gameweek ante copy and keeps the existing atomic `create_league` action. Invite
resolution returns the active, latest archived or no-participation union, checks each service read,
and the code-entry preview shows competition identity and ante only where they apply. New create-flow
links point to that preview. A no-participation invite still allows membership; an archived
participation is read-only.

Gate: `npx tsc --noEmit` passed. `npx vitest run` passed 468 tests; the same 12 external placeholders
were skipped across 40 files.

### Stage 8 — edge sweep and release gates

Added the route-backed WC-only Dues view under the new league shell and the planned last-week copy
adapter. The edge pass made membership-history collapse deterministic, let a blank score stepper
select 0, marked rejected fixture rows, retained invalid entries in settled standings, used the real
eligibility boundary for C65, added the 12-hour user-initiated WhatsApp nudge, and kept service-role
name reads to one per league-format surface.

`npx tsc --noEmit` passed. `npm run build` passed and emitted 27 application routes. `npx vitest run`
passed 468 tests; 12 externally owned entry-sheet placeholders were skipped across 40 files.

Browser execution did not run. Both development-server bind attempts were denied by the workspace
sandbox, and the Chrome runtime could not host the compiled app because its process rejected Next’s
native compiler binary. No preview was deployed or database seed written, since neither action was
authorized.

## Deviations

The blind author added Stage 5–7 unit files before the Stage 3 gate. To keep the mandated whole-suite
gate runnable without moving future screen work forward, their pure imports landed early:
`lib/gw-season.ts`, `homeBadgeState`, and the pure invite DTO builder/filter. The Season, home and
create/join screens still follow their planned stages.

The flat Dues route was caught during the Stage 8 route inventory rather than Stage 3. It landed as
the WC-only view the plan calls for, under the shared shell, before the final gates.

The checked-in blind entry-sheet file contains 12 `describe.skip` placeholders and is owned by the
parallel test author, so it was not edited. The suite exits successfully but the plan’s zero-skip
criterion cannot be met from the permitted implementation paths.

The approved file inventory excludes the legacy direct-token page `app/j/[token]/page.tsx` while U33
requires the new competition preview. I kept that legacy page byte-identical and put the preview in
the named `app/leagues/join/page.tsx` route; new invite links use the named route. Old `/j/<token>`
links retain their legacy preview because changing that extra existing file would break the plan’s
explicit six-file rewrite boundary.
