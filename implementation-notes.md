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

**Demo-seed kit (2026-08-03, untracked scripts/demo-seed/).** Two live-run failures after four
review rounds. (1) `one_open_gw_per_competition` partial index forbids more than one open gameweek —
the kit seeded GW4/5/6 all open; Luna round 4 reseeded GW5/6 as `upcoming` (maintenance opens them
live, a truer demo) and found `round='demo-history'` would break a fixtures check constraint
(`'group'` now). (2) seed.mjs's post-seed audit expected `>= 4` payment_confirmation rows;
`respond_to_payment` writes one row per response action, so the designed flows produce exactly 3.
Orchestrator fixed that threshold directly (one token) instead of a Luna round — the wrapper agent
was failing on API errors and the change is an audit expectation, not logic. Third seed ran clean:
16/16 verify PASS, then torn down same evening (testing pushed to next morning). Lesson: replay
status-write sequences against partial unique indexes; reviewers read the routines but nobody
diffed the audit's expected counts against what the routines actually write.

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

## Phase 3 review round 1 fixes

### Blockers

- B1 — `lib/gw-fixtures.ts:27-55`: `collapseGameweekFixtures` now matches
  `cashford.gameweek_effective_fixtures`. An active history row wins regardless of row order; void
  wins only when no active row exists; excluded-only history disappears.
- B2 — `app/leagues/[slug]/_cup/CupLeagueView.tsx:27-42,177-187`: the cup view reads and totals only
  `contest_results`. It does not read `gameweek_entry_results`, so the cup screen remains a cup-only
  money surface.
- B3 — `components/gw/SeasonTable.tsx:84-93`: the totals pane renders C60 when points have the
  `suppressed` union value. The raw union can no longer reach the page.
- B4 — `components/gw/EntrySheet.tsx:104-117,202-224`: deadline rejection is keyed from the
  routine message, not HTTP 409. A deadline or closed-gameweek message shows C55 and makes the sheet
  read-only.
- B5 — no production change. This finding is the test author's vacuous copy scan and lives in the
  forbidden `tests/phase3` or `docs/testing` paths.
- B6 — no production change. The manifest placeholder and stale count are test-owned files in the
  forbidden paths.

### Majors

- M1 — `lib/net-balance.ts:1-27`, `lib/gw-season.ts:1-50,171-214`,
  `lib/gw-home.ts:84-93`: `isGameweekResultDirty` is the one dirty predicate.
  `netBalance` hides PL money before it can be summed, and the season and home loaders call it.
- M2 — `app/leagues/[slug]/page.tsx:66-107`: CL9 renders only the sync-issue note. It no longer
  renders fixtures, entry progress, picks, standings or the nudge.
- M3 — `lib/gw-home.ts:84-93`: a gameweek-format home card adds the cup ledger to the gameweek
  ledger only when all gameweek results in scope are clean. One dirty row suppresses the whole
  combined figure.
- M4 — canonical names and shapes now stand alone in `lib/gw-copy.ts:248`,
  `lib/gw-fixtures.ts:27`, `lib/gw-state.ts:21-33,84-96`,
  `lib/gw-participation.ts:1-62`, `lib/net-balance.ts:1-27`, `lib/ist.ts:25-32`, and
  `lib/model-chips.ts:1-24`. The test-only aliases, overloads and lifecycle snake-case mirrors are
  gone.
- M5 — `app/leagues/join/actions.ts:1-12,115-117,156-164` has its file-level server boundary back.
  Pure invite work moved to `lib/gw-invites.ts:1-91`; production and tests have distinct entry
  points.
- M6 — `lib/gw-eligibility.ts:24-55` owns the pot rule: accepted entrants times the contest stake.
  `lib/gw-view.ts:513-518` calls it. `lib/gw-live.ts:80-104` calls `buildLiveOutcome`, and
  `lib/gw-view.ts:546-551` calls `buildGameweekViewDTO`. `activeCompetitions` is called by both the
  invite resolver and `app/leagues/new/actions.ts:38-53`. `lib/copy-last-week.ts` was deleted
  because the Phase 3 plan has no screen slot for it.
- M7 — `components/gw/EntrySheet.tsx:99-134,202-216`: 400 responses show the routine's message.
  A missing-prediction response offers a page reload; rejected rows are marked only when the
  response names a fixture by index or id.
- M8 — `components/gw/MirrorPrompt.tsx:39-56,83-96`: a 409 response shows every per-league failure
  from `targets`, with the league name and returned reason.
- M9 — `components/gw/MirrorPrompt.tsx:98-111`: “Not now” always calls `onDone`, including when no
  target is selected. Deselecting all targets no longer traps the prompt.

### Minors

- `components/gw/EntrySheet.tsx:51-52,114-117,221-224`: a 401 shows session-expired copy, locks the
  sheet and offers sign-in; it does not start a blind retry loop.
- `app/leagues/new/actions.ts:9-22,38-53`: `checkSlug` and `listCreatableCompetitions` authenticate
  before creating a service-role client, closing the anonymous enumeration path.
- `components/ui.tsx:1-3` uses the original `@/` imports. `vitest.config.ts:4-19` supplies the test
  alias, automatic JSX transform, DOM matchers and the entry-sheet DOM environment.
- `package.json:25-33` declares `@testing-library/jest-dom`, `@testing-library/react` and `jsdom` as
  development dependencies.

### Canonical exports for the test author

- `lib/gw-fixtures.ts` → `collapseGameweekFixtures<T>(rows: readonly
  GameweekFixtureMembership<T>[]): EffectiveGameweekFixture<T>[]`
- `lib/net-balance.ts` → `isGameweekResultDirty(versions: VersionPair): boolean`;
  `netBalance(input: NetBalanceInput): number | "suppressed"`
- `lib/gw-state.ts` → `resolveViewerParticipation(input: { eligible: boolean; entryStatus?:
  "entered" | "needs_update" | "locked_in" | "invalid" | null }): ViewerParticipation`.
  `LifecycleContest` and `LifecycleResult` use `deadlineAt`, `inputVersion` and `settledVersion`.
- `lib/gw-participation.ts` → `resolveLeagueParticipation(rows: readonly
  LeagueParticipationRow[]): ResolvedLeagueParticipation`. Rows use the injected database shape:
  `competition_id`, `joined_at`, `eligible_from_gameweek_id`, and `competitions`.
- `lib/gw-eligibility.ts` → `resolveEntryCounts(entries: readonly { status: EntryStatus }[],
  eligibleMemberCount: number, options: { preDeadline: boolean; stakeInr: number })`;
  `entryPotNumbers(input: { entries; eligibleMembers; stakeInr; deadlinePassed })`
- `lib/gw-live.ts` → `provisionalGameweek(input: { entries; fixtures; stakeInr }):
  ProvisionalGameweek`; `buildLiveOutcome(input: LiveOutcomeInput): LiveOutcome`
- `lib/gw-view.ts` → `buildGameweekViewDTO<T extends { cl: ContestLifecycle;
  snapshotEntryResults?: unknown }>(input: T): Omit<T, "snapshotEntryResults"> & {
  entryResults?: unknown }`
- `lib/gw-copy.ts` → `correctionCopy(cause: SettleCause): string | null`
- `lib/ist.ts` → `formatIstDeadline(value: DateInput): string`;
  `formatIstCompact(value: DateInput): string`
- `lib/model-chips.ts` → `chipsForFixture(topScores: readonly ScoreProb[]): ScoreChip[]`, where
  `ScoreProb` is `{ h: number; a: number; p: number }`
- `lib/gw-invites.ts` → `activeCompetitions<T extends { status: string }>(competitions: readonly
  T[]): T[]`; `resolveInvite(source: InviteSource): InviteDTO`
- `app/leagues/join/actions.ts` → `resolveInvite(raw: string): Promise<InviteDTO>`;
  `joinLeagueForUser(raw: string, userId: string): Promise<{ ok: boolean; slug?: string; error?:
  string; already?: boolean }>`
- `lib/copy-last-week.ts` → deleted; there is no canonical export.

### Gates

- `npx tsc --noEmit` passed with no output.
- `npx vitest run` loaded 40 files: 32 passed, seven failed and one was skipped. Of 471 tests, 430
  passed, 29 failed and the test author's 12 entry-sheet placeholders remained skipped. Every
  failure is a stale test interface allowed by R-D:
  - `tests/phase3/gw-fixtures.test.ts`: five calls import `collapseFixtures`; import
    `collapseGameweekFixtures` and change the active-then-void expectation to active under R-A.
  - `tests/phase3/gw-copy.test.ts`: four calls use `settleCauseNote`; use `correctionCopy`.
  - `tests/phase3/ist.test.ts`: three calls use `formatIst`; use `formatIstDeadline`.
  - `tests/phase3/invite-dto.test.ts`: the suite imports pure helpers through the server action and
    hits `server-only`; import `activeCompetitions` and pure `resolveInvite` from
    `lib/gw-invites.ts`.
  - `tests/phase3/participation.test.ts`: four calls use the old two-argument and camel-row shapes;
    pass one array of `LeagueParticipationRow`.
  - `tests/phase3/gw-state.test.ts`: eleven calls use lifecycle snake-case fields or the old
    two-argument viewer call; use camel lifecycle fields and the object argument.
  - `tests/phase3/gw-eligibility.test.ts`: two calls omit `stakeInr`; pass the contest stake in the
    third argument.
  `tests/phase3/model-chips.test.ts` happened to pass but should replace `{ home, away, prob }` with
  `{ h, a, p }`.
- `npm run build` passed. Next 15.5.19 compiled, checked types, generated all 13 static pages and
  emitted 27 application routes.
- `git diff --quiet -- lib/settlement.ts` returned 0. The protected settlement file is unchanged.
- `git diff --check` returned 0.
- A disposable component probe passed, then was deleted. It observed active winning over later void
  and excluded history, a ₹200 pot from two locked entrants at ₹100, dirty money suppression, C60
  instead of the raw season union, and the mirror decline callback.
- Five focused suites passed 32 of 32 tests: net balance, live outcome, status badge, season and
  gameweek view.
- Browser execution did not run: the sandbox rejected the local Next listener with `EPERM`.

## Deviations

`npm install` could not finish in the restricted sandbox. The normal run stopped making progress
and was ended; the offline retry failed with `ENOTCACHED`. `package.json` has the three required
development dependencies, but `package-lock.json` could not be refreshed. Local test execution used
copies or links from an existing sibling project's package store; those untracked `node_modules`
changes are not part of the patch.

`tsconfig.json:22` excludes `tests/phase3` until the separate test author updates the canonical
imports and call shapes above. This keeps the production type gate honest without masking stale
test interfaces inside that gate. Remove the exclusion after test reconciliation.

B5 and B6 remain test-author work because this task forbids edits under `tests/phase3` and
`docs/testing`. The 12 skipped entry-sheet placeholders remain for the same reason.

## Phase 3 review round 2 fixes

The home card now reads one league-wide balance across cup results and every gameweek competition.
`leagueNetByUser` checks each league’s real contest and result versions before returning money, and
its return type forces callers to handle the `suppressed` marker. Season rows also carry the real
version pair; no money call turns a prior dirty boolean into made-up versions.

Live progress counts active fixtures in both parts of C14. Void fixtures no longer expand its
denominator. The league page shows the locked-in pot for CL2–CL4 as well as the open pot for CL1, and
keeps terminal layouts unchanged.

Entry and mirror errors now pass through the copy map in `lib/gw-copy.ts`. Entry deadline errors map
to C55 for an existing entry and C55b for a first save. The three stale-fixture errors map to C74 and
offer reload. Mirror failures branch on whether the response contains `targets`; a wholesale C79
line sits above any target lines. Both clients map 401 to C73 and carry the entry route through
`/login?next=…`. The login action accepts only a same-site path. A read-only entry sheet links back
to its league.

The message map covers these server sources:

- Entry auth: `not signed in`, `not authenticated` → C73.
- Entry deadline: `this gameweek is closed`, `the deadline has passed` → C55b on first save, C55 on
  edit.
- Entry stale fixtures: `this gameweek has no fixtures to predict`, `a prediction is missing for N
  of M fixtures`, `a prediction refers to a fixture that is not in this gameweek` → C74.
- Entry league or eligibility: `no pot for this league and gameweek`, gameweek/competition
  mismatch, inactive competition, archived league, not a member, left league, league not yet
  eligible, joined after the gameweek began → C76.
- Entry missing prior row: `you have not entered this gameweek yet` → C75.
- Entry validation: invalid JSON; missing or wrong Zod fields; bad UUIDs; array bounds; unknown
  keys; number type, integer or range errors; duplicate fixture messages; invalid score range;
  missing league/gameweek; non-array picks → C77.
- Entry route write-count failures: `entry was not written`, `picks were not written` → C56.
- Mirror auth: `not signed in`, `not authenticated` → C73.
- Mirror wholesale response: `nothing was copied` → C79.
- Mirror stale or missing gameweek: `unknown gameweek`, no fixtures → C74.
- Mirror source row: not entered in source, unfinished source picks → C78.
- Mirror validation: invalid JSON; missing or wrong Zod fields; bad UUIDs; array bounds; unknown
  keys; number type, integer or positive-range errors; empty targets; duplicate target; source also
  a target → C56.
- Mirror route/write failures: `mirror did not run`, pass-two write-count mismatch → C56.
- Mirror target pot missing → C80; closed or past deadline → C81; stake mismatch → C54; inactive or
  archived league, not a member, left league, league not yet eligible, joined after the gameweek
  began → C82; stale source picks → C83.
- Any server message outside the enumerated set falls back to C56. Raw server prose is never
  rendered.

### Gates

`npm run build` passed and emitted 27 routes. A production-only TypeScript check passed. The required
`npx tsc --noEmit` command exits 1 only because `tests/phase3/gw-season.test.ts` still builds
`SeasonInputRow` from the removed `dirty` boolean and omits `inputVersion` and `settledVersion` at ten
call sites.

`npx vitest run` loaded 40 files: 37 passed and three test-author files failed. Of 513 tests, 506
passed, seven failed, and none were skipped. `tests/phase3/copy-scan.test.ts` has three B5 scan
failures; `tests/phase3/gw-season.test.ts` has two stale dirty-boolean expectations; and
`tests/phase3/entry-sheet.test.tsx` has two stale expectations for first-save C55 and raw server
prose. `tests/phase3/gw-copy.test.ts`, including its new map-builder calls, passed 14 of 14.

`git diff --check` passed. `git diff --quiet -- lib/settlement.ts`,
`git diff --quiet -- supabase/migrations`, and `git diff --quiet -- app/api/gw` all returned 0.
Disposable production probes were removed after observing a two-competition combined balance of ₹0,
dirty-league suppression, and the enumerated C-ID mappings with C56 as the unknown-message fallback.

### Deviations

B5, B6, F10 and all test edits remain with the test author. This production pass did not edit any
file under `tests/phase3` or `docs/testing`. The first whole-suite run found stale test-side expectations
for version pairs, first-save C55b, mapped error copy, the new C-ID builders, and the required login
files in the copy manifest.

## Phase 3 review round 3 fixes

`safeReturnPath` is exported for a unit test and parses each leading-slash value against a fixed
local origin. Cross-origin parses, malformed values and values without a leading slash return `/`.

Pot counting now changes from `entered`/`needs_update` to `locked_in` only after the contest leaves
`open`, which is the lock transaction boundary. The pot stays visible during a delayed lock and does
not fall to zero just because the clock passed the deadline. Its locked-set copy is C5b:
`Pot ₹1,400 · 7 locked in of 10`.

A page-load absence no longer proves that the player still has no entry when a save fails. On a
deadline-family failure after a first-save attempt, the entry client now reads `/api/gw/contest`
once and uses its live `myEntry` state: `null` gets C55b, an entry gets C55, and a failed or malformed
check stays on neutral C55. A page-load entry skips the check and gets C55 directly. Mirror failures
now map the route's real top-level `error`, keep C79 above the returned target list, and show the
reload control when either the top-level or a target mapping asks for it.

The Phase 2 verifier now throws if either settled dues read is `suppressed` before it indexes the
per-user map.

### Gates

`npx tsc --noEmit` passed with no output. `npm run build` passed, generated 13 static pages and
listed 27 routes.

`npx vitest run` loaded 40 files: 39 passed and `tests/phase3/entry-sheet.test.tsx` failed. Of 525
tests, 524 passed and one failed. The first-save B4/F8 case mocks only the rejected save POST, so the
new contest GET has no response and correctly falls back to C55. The test author must queue a second
successful response with `{ myEntry: null }` for that GET before asserting C55b.

A disposable probe was removed after it ran the three hostile return paths through the exported
helper source, checked C55 for an unknown save-time entry state and C55b for proven absence, checked
the C5b string, and rendered a real 409 mirror body with C79, its target error and the reload
control. The local production server could not bind its port in this sandbox (`EPERM`), so no
signed-in browser check ran.

## Phase 3 review round 4 fixes

R4-5 sets C55 and makes the entry sheet read-only before the first-save verification GET begins.
That GET carries a three-second abort signal. A failed, malformed or timed-out check leaves C55 in
place; only a confirmed no-stake state upgrades the copy to C55b.

R4-6 suppresses the pot while the contest remains `open` at or after its deadline. The league page
captures one timestamp and passes it to both the lifecycle loader and `PotSummary`; both decisions
use the contest deadline. Once the contest status changes, the existing `locked_in` numerator and
C5b copy render.

R4-7 treats a verified `myEntry.status` of `invalid` like `myEntry: null`, because neither state
staked money. Both states select C55b.

MINOR-1 and MINOR-2 move `safeReturnPath` into `lib/safe-return-path.ts`. The helper keeps the
leading-slash and parsed-origin checks from SEC-1, then returns the parser's normalized pathname,
query and hash. The server action imports it and exports only the login action at runtime.

MINOR-3 gives the mirror stake-mismatch mapping its reload flag, matching its reload-and-retry
message and the existing mirror reload control.

### Gates

`npx tsc --noEmit` passed with no output. `npm run build` passed, generated 13 static pages and
listed 27 routes. `npx vitest run` passed all 40 files and all 527 tests. The focused EntrySheet and
copy suites passed all 39 tests, so this round broke no existing test.

A disposable four-case production probe was removed after it observed the normalized local return
path and blocked hostile origins; no pot in the open post-deadline window and C5b after lock; C55
plus disabled steppers before a never-settling verification GET; C55b for a verified invalid entry;
and the mirror stake reload flag.

`git diff --check` passed. `lib/settlement.ts`, `supabase/migrations`, and `app/api/gw` have no diff.
This round did not edit `tests/phase3` or `docs/testing`.

## Decision #42 zero-fill slice

Migration `20260727000003_zero_fill_added_fixtures.sql` replaces only
`apply_fpl_reconciliation`. One transaction-time decision sends an added fixture to either the
active-and-fill path or the excluded path. Open and upcoming gameweeks qualify before their deadline,
and a null deadline also qualifies; a fixture at or past kickoff is excluded and logged. The active
path inserts a 0-0 pick for each existing `entered` or legacy `needs_update` entry. `locked_in` and
`invalid` stay untouched as terminal defensive states. The insert uses the new active
`gameweek_fixtures.id`, matching entry and mirror provenance, and conflicts on the entry/fixture pair
do nothing so later observations cannot replace a player edit. The return payload reports the total
as `picks_filled`.

The existing membership-change path still owns the input-version bump. Zero-filling does not call
the bump helper, so the fixture addition increments each affected pot once and the existing dirty
predicate sees the canonical fixture change without a second pick-driven increment. Each affected
pot gets one `fixture_zero_fill` audit row with the fixture, membership, 0-0 value, filled-entry
count and post-bump version.

The migration keeps the competition gate, ascending gameweek advisory locks, query-driven loops,
score predicates, security-definer boundary and pinned search path from `000002`. It restates the
revoke for public, anon and authenticated and the service-role grant after replacement.

The Phase 3 riders key the entry sheet by gameweek ID and announce its error text through a polite
live region.

## Deviations

**Departed-member stake delta.** A member who leaves after entering but before a late fixture is
added now gets the same 0-0 fill as every other saved entry, so that entry can still lock and stake.
Before Decision #42, the missing pick made the entry invalid and removed its stake. This follows the
existing soft-delete rule, but it changes the money path.

**`now()`-window residual.** Reconciliation can start just before the deadline and finish just after
it. In that narrow window, it fills a pick that the member can no longer edit. The gap lasts
milliseconds to seconds and is strictly better than invalidating the entry.

**Ananth accepted both deviations as-is ("both fine", 2026-07-30). Logged as decision #47.**

### Gates

`npm run typecheck` passed with no errors. `npm run build` passed, generated 13 static pages and
listed 27 routes. `npm test` passed all 41 files and all 564 tests.

The prover agents ran every recorded database proof on a fresh disposable cluster.
`zerofill-test.sql` passed 72 of 72 assertions before this cleanup; it now contains 74 assertions
for the separate Docker rerun and still applies the migration file twice. The migration chain was
idempotent. Round 2 passed its 11-assertion and 22-assertion proofs; Round 3 passed its 19-assertion
and 26-assertion proofs; the rework proof passed all 38 assertions.

`zerofill-test.sql` covers the deadline straddle, final same-event past-kickoff exclusion,
different-event recovery, upcoming and null-deadline states, edited-pick return, cross-pot fan-out,
and an entry missing a different pick.

Static inspection found no Decision #42 conflict in `round2-test.sql`, `round2-proof.mts`,
`round3-test.sql`, `round3-proof.mts` or the scratchpad `pg/rework-test.sql`. Two older descriptions
outside those named rerun suites had stated the overturned rule. `docs/testing/phase2-cases.md` was
updated at P2-P11, P2-P11b and P2-G01. The direct-membership defensive scenario in
`scripts/verify-phase2.mjs` still exercises the dormant completeness path because it bypasses FPL
reconciliation; its description does not represent a normal FPL fixture add.

## Phase 3 closed (2026-07-30)

Staging browser pass: 8/8 PASS on cashford-staging.vercel.app (deployment dpl_7RxFSAiSUvVKZJfSNvzALqDTK4sB, after migration 000003). Covered: login + open-redirect vectors (both dead on the live site), Test League home (pot line + IST deadline), entry write via real UI (steppers clamp 0–9, save, reload, persist), pick edit + persist, dues page, Solid Yenne Boys read-only render, bogus-slug 404. Screenshots: scratchpad/p3-browser/. Writes touched only ZZ-P1 Test League; its GW1 now holds one QA entry (₹500 pot, test data).

Backlog notes from the pass: stepper increment drops same-tick rapid clicks (likely missing functional state updater) — non-blocking, revisit before/during Phase 4; ZZ-P1 Test League uses real PL teams, not Gamma/Delta as older docs said.

## Phase 4 code + proofs closed (2026-07-31)
Adversarial review rounds 1–5 all closed (decision #52). Disposable-Postgres proofs 5/5 PASS
(migration chain + M11 stamp idempotency, lease concurrency 20-way, single insights writer across
arm/revert, remap rollback atomicity, 9 dark keys) — report + privilege-audit addendum at
scratchpad/p4-prover-report.md. Prover finding fixed: sync_state/sync_issues anon/authenticated
grants revoked in the unapplied migration (line ~277), re-proven green.
Backlog: phase4-persistence.sql re-seed is not idempotent in an unreset DB (fixed-slug competitions
insert without on conflict) — harness-only, fix with the Phase 6 hardening pass.
Suite: 646/646 · tsc clean · build + safety green. Migration 20260728000001 remains UNAPPLIED.
Awaiting: RO contract review → Ananth: migration apply, commit/push, arming decisions (D7 FotMob, D6 mockups).

## Phase 4 arming ceremony — EXECUTED (2026-07-31)

Terra's 9-step checklist ran end-to-end in one window. Record:
- Contract flipped to `Status: APPROVED` (commit 989c49e); merged to main; prod deploy v94,
  commit 6df15d7a1bf9822a8c6cc3d0f6b5a72252df875e (verified via Vercel API; all reviewed
  surfaces confirmed contained in that commit).
- Migration 20260728000001_match_data_v2.sql APPLIED to prod. Nine keys born at infinity;
  claim_insights_writer + replace_provider_fixture_id verified present.
- Approval row in cashford.sync_issues: contract SHA
  1de84d7f0a6675f57423ba613a23ade9865963e09d779ff160bb7acee783f2fa + deployed SHA above;
  exactly one unresolved row confirmed.
- Baseline observation: 8 keys PASS (prod provably dark pre-arming).
- Armed + observed one-at-a-time, all PASS, every changed row owned, zero ownership failures:
  espn_insights, espn_match_data, espn_commentary, espn_standings, derived_standings,
  espn_reconcile, team_news, understat_xg.
- fotmob_slow stays at infinity — deferred by Ananth (D7), logged as future improvement.
- Evidence: scratchpad ceremony/ dir (baseline-*.json, observe-*.json, arm-*.log per key).

### Deviations (ceremony)
1. fotmob_slow baseline skipped: FOTMOB_ENABLED unset in prod makes its required
   fotmobEnabled:true assertion unpassable; key stays dark, so nothing to prove. Run its
   baseline + arm as part of the future FotMob enablement.
2. Approval row initially included optional deployed_app_version=94; the logged-out page hides
   the version pill so the automated check failed closed. Removed the optional field from the
   row (both required hashes untouched) — the contract's attested source-SHA check remains the
   build check.
3. Observation needed a quiet window the checklist under-specified: prod pg_cron (cashford-tick,
   every minute) raced the observer's tick for leases. Ananth paused cron.job id 1 for the
   ceremony; re-enabled after. Also: the legacy knockout resolver runs on :00/:15/:30/:45
   minutes, so observation ticks avoided those minutes to keep legacy writers quiet.
4. Observer DB access: PHASE4_RO_DATABASE_URL added to .env.local (session pooler,
   aws-1-ap-south-1, DB password reset by Ananth via dashboard; nothing else used the old one).

## Phase 5 implementation notes (2026-07-31)

The Phase 5 surface is implemented in the new Dues, archive, table, adoption, competition-sheet,
payment, and transition modules. The migration is written but was not applied, as required by the
Phase 5 handoff.

## Deviations

**Migration filename follows the hard fence.** The plan names
`20260729000001_dues_archive_transition.sql`; the task requires Phase 5 migration files to be
`2026073100000N_*.sql` with N at least 2. The implementation uses
`supabase/migrations/20260731000002_dues_archive_transition.sql`.

**The fixed Phase 3 copy manifest could not be updated.** The plan requires new Phase 5 routes and
components, while the task forbids edits under `tests/phase1..phase4`. The existing copy-governance
test therefore reports the new Phase 5 files as uncovered. Its direct copy checks still pass; the
candidate-set assertion is the two-test gate failure reported for this handoff.

**Database and network verification were deferred by instruction.** No migration, SQL query,
shared-database smoke, disposable database run, staging browser pass, or external request was made.
The SQL was checked by review and the application was checked by typecheck and build.

**Archive data reads are staged around the current schema boundary.** The archive routes use the
existing WC contest, fixture, and prediction rows and mark members with unfinished results as
unavailable. Captain adoption reads the league stake and next open PL gameweek when those rows
exist; the UI keeps a 500 INR fallback only for a missing stake row.

**Payment matching cards are wired to the direct payment route.** The database routine returns the
matching row and the API exposes its ID, but the main Dues card still needs the final inline
matching-payment presentation and logger name copy from PC19.

## PAUSED (2026-07-31, Ananth's instruction) — Phase 5 state at pause
Code review APPROVED (Terra rounds 1-4). Blind tests 30/30. Full suite 718/718, tsc + build green.
DB proofs: 80 assertions PASS, 2 FAIL — one open migration bug: adopt_league_competition's
ON CONFLICT (league_id, gameweek_id) target is ambiguous against the function's OUT parameter
(fires on ordinary first-time adoption with an open gameweek; deterministic, single connection).
Same class as the fix-4 bug, one line later. Full evidence: scratchpad p5-prover-report.md.

## RESUMED (2026-08-03, "proceed with the fix and finish phase 5") — Phase 5 closed out
Decision-57 routing ran as ordered: Luna (xhigh) coded, Opus reviewed, Sonnet proved.
- Bug 1 (the pause blocker): ON CONFLICT target ambiguity in adopt_league_competition. Fix:
  `on conflict on constraint gameweek_contests_league_id_gameweek_id_key` (arbiter verified in
  source AND live pg_constraint by the Opus seat; no later migration touches the name). Luna
  audited every ON CONFLICT / ORDER BY / GROUP BY / USING / RETURNING site in all 14 routines.
- Bug 2 (NEW, found by Opus re-deriving the audit): `v_gw := null` at the gameweek-lock handoff
  DE-ASSIGNS the plpgsql record, so an adoption that blocked on lock_gameweeks and woke to a
  closed gameweek crashed with `record "v_gw" is not assigned yet` instead of degrading to the
  null-eligibility path. Fix: v_gw_id/v_gw_deadline plain vars; record never assigned null; pot
  keeps the re-read deadline. Opus re-review: APPROVE on all checks.
- Proof coverage gap closed: T-P29 (no-open-GW adoption + maintenance backfill) and T-P40
  (multi-connection adoption races incl. a deterministic advisory-lock handoff proof for Bug 2)
  were named in db-proofs-needed.md but never implemented by the first prover. Now implemented.
- Final proofs: 90/90 assertions PASS on a fresh disposable container. Full suite 718/718,
  tsc clean, next build green. Two harness-only edits (date drift in log_payment calls; a stale
  cleanup delete that hit a now-real FK) — proof scripts only, no product code.
Deviations: none beyond the two fixes above; both went through the full pipeline.
Lesson (again): four review rounds missed Bug 1; a live-DB seat found Bug 1 and an Opus seat
with a distrust-the-audit brief found Bug 2. Keep both seats for money code.

- **2026-08-05, feedback-r1 reference file**: Luna's sticky first column (League screen table standard, Option B) did not hold — two causes found by isolation testing: (1) sticky cells were grid items, and a grid item's containing block is its own grid area, so `position: sticky` never engages; (2) row-level horizontal padding shrinks the sticky cell's containing block and kills the pin. Fixed directly in `docs/design/2026-08-05-feedback-r1-reference.html` (rows switched to flex with fixed column bases; horizontal padding moved from rows to first/last cells) instead of a Luna re-dispatch — two-line CSS fix, verified holding on both tables (head + data rows). The same two rules must carry into the real implementation of the app-wide table standard.

- **2026-08-05, step 1 (#12 route smoke pass) deviations**: (1) Pages now fail loud
  where they used to swallow query errors — both `payments/[paymentId]` routes 500
  instead of 404 on a query error, `requireCaptain` throws instead of redirecting on
  a failed lookup, `/dev/gameweeks` no longer swallows errors. Deliberate: hiding
  PostgREST errors is the exact behavior that masked v101/v102. (2) RLS coverage in
  the smoke pass is scoped to ZZ-P1 (signs in as ananth@cashford.internal via
  CASHFORD_ANANTH_PASSWORD); the three real leagues run service-role because no
  member credentials exist for them. Policies are league-generic, so ZZ-P1 exercises
  the same policies; a policy behaving differently per league is a residual blind
  spot, noted in the harness header. (3) Payment-detail cases currently report
  "not applicable" — no payment rows in the DB snapshot; the loader was exercised
  in round 1 before the skip logic landed.

- **2026-08-05, Foundations review rulings**: (1) Analytics visibility is based on settled history,
  not on the current gameweek being live: show the home tab when any gameweek contest in a viewer
  league has a result, or when the existing archived-World-Cup analytics view has settled/entered
  history. This keeps cup-only and between-season viewers from losing useful history while keeping
  the tab hidden when there is nothing to show. (2) The KnockoutBanner was removed from home because
  its archived-World-Cup "NEW · LIVE" CTA conflicts with the locked home navigation rule; `/bracket`
  and archive links remain. (3) Match and home-analytics day groups now carry raw ISO instants and
  group in the browser's resolved timezone, so a late-night IST kickoff cannot cross into a wrong
  UTC bucket or inherit a mismatched header. (4) The corrected-result note deliberately shows the
  local date and time through `LocalTime`, rather than only a date. (5) `components/AnalyticsTab.tsx`
  remains in the copy-scan manifest's excluded list because it is a pre-existing Phase 4 surface
  with a large in-place copy set outside the Phase 3 catalogue; the manifest `_excludedNote` records
  this ruling and Phase 6 owns routing that copy into a dedicated module.
