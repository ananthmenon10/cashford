# Phase 1 test cases — competitions, gameweeks, FPL ingest

Written from `docs/plans/2026-07-27-003-phase1-foundation-plan.md` (v5), before the implementation
lands. Every row cites the plan section it enforces. IDs are stable — reference them in commit
messages and code comments, don't renumber.

Layers: **unit** (`npx vitest run tests/phase1`, no DB, no network — `fetch`/DB clients mocked),
**persistence** (`node scripts/verify-phase1-db-cases.mjs`, real Postgres — mode `disposable` needs
a throwaway DB the migration was just applied to, `prod-readonly` is safe to run against the shared
prod DB because it only reads or writes to the sandboxed Test League), **integration** (vitest,
mocked network, exercises `lib/sync-fpl.ts` end-to-end against the recorded FPL snapshot).

Naming: `P1-U##` unit, `P1-P##` persistence (core schema/reconciliation/provisioning), `P1-L##`
persistence (sync_state lease), `P1-I##` persistence (isolation: RLS/triggers/legacy guards/FKs),
`P1-F##` persistence/integration (sync failure handling), `P1-G##` integration (full sync).

## Interface assumptions (flag for reconciliation — see report)

The plan names `lib/fpl.ts`, `lib/sync-fpl.ts`, `lib/espn-match.ts` (§3–§5) but doesn't give exact
export signatures for every pure helper. Tests are written against these assumed exports; if the
implementer's actual names differ, fix the imports, not the test intent:

- `lib/fpl.ts`: `fetchFplSnapshot(): Promise<{events, teams, fixtures} | null>`,
  `validateFplSnapshot(bootstrap, fixtures): {ok: boolean; errors: string[]}`,
  `mapEvent(rawEvent): {fplEventId, number, name, deadlineAt}`,
  `mapFixture(rawFixture): {fplFixtureId, fplEventId, kickoffAt, homeFplTeamId, awayFplTeamId, homeScore, awayScore, finished}`.
- `lib/espn-match.ts`: `matchFixture(candidates, target): {status:'matched', externalId} | {status:'zero'} | {status:'multiple', count}`
  where `target = {teamHKey, teamAKey, kickoffAt, season}`; `fetchEspnEvents(season): Promise<EspnEvent[]>` (paginated internally).
- **Reconciled 2026-07-27:** the score-source write predicate stays SQL-only inside
  `cashford.apply_score_update` — no `lib/score-source.ts` exists. P1-U21–U24 are **superseded**
  by the persistence cases P1-P31a–d (same intent, run against the real routine instead of a pure
  TS mirror); see the superseded-case note in the Unit section below. `tests/phase1/score-source.test.ts`
  was deleted.

---

## Unit — `lib/fpl.ts` snapshot validation (§3)

| ID | Given | When | Then |
|---|---|---|---|
| P1-U01 | bootstrap-static + fixtures both 200, 38 unique events, 20 teams, 380 unique fixtures, all refs valid, GW1 deadline in 2026 | `fetchFplSnapshot()` | resolves with `{events, teams, fixtures}`, non-null |
| P1-U02 | bootstrap-static responds HTTP 500 | `fetchFplSnapshot()` | resolves `null` (caller logs `sync_issues`, never throws) |
| P1-U03 | fixtures endpoint never resolves within the 10s budget | `fetchFplSnapshot()` | resolves `null` on timeout, does not hang the caller |
| P1-U04 | bootstrap-static has 37 unique events | `fetchFplSnapshot()` | resolves `null` — event count must be exactly 38 |
| P1-U05 | bootstrap-static has 38 events but two share `id` | `fetchFplSnapshot()` | resolves `null` — uniqueness check catches the dupe, not just count |
| P1-U06 | bootstrap-static has 19 teams | `fetchFplSnapshot()` | resolves `null` — team count must be exactly 20 |
| P1-U07 | fixtures has 379 unique ids (one dropped) | `fetchFplSnapshot()` | resolves `null` |
| P1-U07b | fixtures has 380 rows but one `id` duplicated (so 379 unique) | `fetchFplSnapshot()` | resolves `null` — same failure via a different cause than U07 |
| P1-U08 | a fixture's `team_h` references a team id not present in `teams`, or an `event` references an id not in `events` | `fetchFplSnapshot()` | resolves `null` — dangling ref fails validation before any DB write is attempted |
| P1-U10 | an event row with `deadline_time: null` (rare, but the type allows it) | `fetchFplSnapshot()` | resolves `null` — **rewritten 2026-07-27** (see ruling below): `mapEvent` treats an unparseable/null `deadline_time` as invalid and returns `null` for that event; that drops the surviving-event count below 38, so the whole snapshot is rejected. This is the conservative §3 all-or-nothing posture, not a mapper bug. Consequence: every event that survives validation has a non-null `deadlineAt` by construction — Phase 2 may rely on this. |

## Unit — `mapEvent` (§3)

| ID | Given | When | Then |
|---|---|---|---|
| P1-U09 | a normal FPL event row (`id`, `name`, `deadline_time` set) | `mapEvent(raw)` | returns `{fplEventId: raw.id, number: raw.id, name: raw.name, deadlineAt: raw.deadline_time}` — gameweek `number` derives from FPL's `id`, not a separate counter. `deadlineAt` is normalized via `.toISOString()` (stamps `.000Z` even on inputs without milliseconds). |
| P1-U11 | an event row with a non-ISO-parseable `deadline_time` string | `mapEvent(raw)` | throws or returns a flagged error shape (mapper does not silently coerce a garbage date) — implementer's choice of error shape, test asserts it is NOT a silently-accepted valid date |

## Unit — `mapFixture` (§3)

| ID | Given | When | Then |
|---|---|---|---|
| P1-U12 | a normal upcoming fixture (`event` set, `kickoff_time` set, scores null) | `mapFixture(raw)` | returns `{fplFixtureId: raw.id, fplEventId: raw.event, kickoffAt: raw.kickoff_time, homeFplTeamId: raw.team_h, awayFplTeamId: raw.team_a, homeScore: null, awayScore: null, finished: false}` — `kickoffAt` is normalized via `.toISOString()` (stamps `.000Z` even on inputs without milliseconds) |
| P1-U13 | a fixture with `event: null` (not yet assigned to a gameweek — real, valid FPL state) | `mapFixture(raw)` | returns `fplEventId: null` — **this is a valid output, not an error** (plan §3: "null event ... VALID output meaning unassigned") |
| P1-U14 | a fixture with `kickoff_time: null` (postponed, no rescheduled date yet) | `mapFixture(raw)` | returns `kickoffAt: null` — valid output (plan §3: "null kickoff ... VALID output meaning ... undated") |
| P1-U15 | a finished fixture with `team_h_score: 2, team_a_score: 1, finished: true` | `mapFixture(raw)` | returns `homeScore: 2, awayScore: 1, finished: true` |
| P1-U25 | a fixture row with `kickoff_time` **missing** (`undefined`), not `null` | `mapFixture(raw)` | returns `null` — "undated" is a valid state only when the field is exactly `null`; a missing field is a malformed row, not TBC |
| P1-U26 | a fixture row with `kickoff_time: ""` | `mapFixture(raw)` | returns `null` — empty string is not the same signal as `null`, must not be silently read as undated |
| P1-U27 | a fixture row with `team_h_score` **missing** (`undefined`) | `mapFixture(raw)` | returns `null` — "unobserved" is a valid state only when the field is exactly `null` |
| P1-U28 | a fixture row with `team_a_score: ""` | `mapFixture(raw)` | returns `null` — empty string is not the same signal as `null` |
| P1-U29 | a fixture row with `team_h_score: "2"` (numeric string) | `mapFixture(raw)` | returns `null` — no implicit coercion of a string score, even a parseable one |
| P1-U30 | a fixture row with `team_h_score: -1` | `mapFixture(raw)` | returns `null` — a negative score is never legal |
| P1-U31 | a fixture row with `team_a_score: 1.5` (non-integer) | `mapFixture(raw)` | returns `null` — a score must be `Number.isInteger` |

## Unit — `lib/espn-match.ts` matching rule (§5)

Pure decision only — DB writes (upsert `team_provider_ids`, never-overwrite `external_id`) are
P1-P25–P31 (persistence).

| ID | Given | When | Then |
|---|---|---|---|
| P1-U16 | one ESPN candidate: same two teams (home/away matching target's home/away), kickoff within ±3h, same season | `matchFixture(candidates, target)` | `{status:'matched', externalId}` |
| P1-U17 | one ESPN candidate with the SAME two teams but home/away **reversed** vs. the target | `matchFixture(candidates, target)` | not `matched` — the rule is home/away-ordered, a reversed fixture is a different match, not a false positive |
| P1-U18 | two ESPN candidates both satisfy teams+window+season (e.g. a rescheduled duplicate still in the window) | `matchFixture(candidates, target)` | `{status:'multiple', count: 2}` — caller writes `sync_issues`, never picks one arbitrarily |
| P1-U19 | zero ESPN candidates satisfy the rule (kickoff 4h outside window, or wrong season) | `matchFixture(candidates, target)` | `{status:'zero'}` |
| P1-U20 | ESPN bulk-events fetch spans 3 pages of the core API (limit=100) | the internal pagination loop | all pages are merged before matching runs — a target only satisfiable by a page-2/3 candidate still matches (not truncated at page 1) |

## Unit — score-source write predicate (§2) — SUPERSEDED

**Reconciled 2026-07-27: the predicate is SQL-only inside `cashford.apply_score_update`, no pure
TS module exists.** IDs kept (not renumbered) so references elsewhere stay stable; each now runs
only as its persistence-layer counterpart, no vitest suite covers it.

| ID | Given | When | Then | Runs as |
|---|---|---|---|---|
| P1-U21 | fixture's stored `score_source = 'espn'` | `apply_score_update` called with `p_source='fpl'` | rejected — FPL never overwrites an ESPN observation | → P1-P31a |
| P1-U22 | fixture's stored `score_source = 'fpl'` | `apply_score_update` called with `p_source='fpl'`, new score | accepted — FPL may update its own earlier fallback | → P1-P31b |
| P1-U23 | fixture has no ESPN mapping (`external_id null`), stored `score_source = null` | `apply_score_update` called with `p_source='fpl'` | accepted — FPL is the only source for an unmatched fixture regardless of prior source state | → P1-P31c |
| P1-U24 | fixture's stored `score_source = 'fpl'` (or `null`) | `apply_score_update` called with `p_source='espn'`, new score | accepted — ESPN may always write when it has data for a matched fixture | → P1-P31d |

---

## Persistence-case run log (2026-07-27, prod-readonly + authed-readonly passes)

Run via `scripts/verify-phase1-db-cases.mjs prod-readonly` and, for the authenticated-session
follow-up, `... authed-readonly` (signed in as `ananth@cashford.internal`, read-only) against prod
after migration `20260727000001_competitions_gameweeks.sql` applied. Every case below that is real
SQL/RLS against prod is a genuine PASS/FAIL (the script throws on a mismatch); nothing was
rubber-stamped.

| ID | Status | Note |
|---|---|---|
| P1-P29 | **PASS** | 50 `team_provider_ids(espn,2026)` rows == 50 `teams` rows with non-null `external_id` |
| P1-I02 | **PASS** — closed by P1-I17 | anon-key client (no session) reads `competitions` → 0 rows (correctly denies the unauthenticated `anon` role). Anon alone can't prove a logged-in member CAN read it (anon key with no session runs as Postgres role `anon`, not `authenticated`) — **P1-I17** (below) closes that gap with a real signed-in session. |
| P1-I03 | **PASS** — closed by P1-I18 | same anon-vs-authenticated gap as I02, closed by **P1-I18** |
| P1-I04 | **PASS** — closed by P1-I19 | same gap, closed by **P1-I19** |
| P1-I05 | **PASS** | non-service insert into `gameweeks` rejected: "new row violates row-level security policy for table \"gameweeks\"" |
| P1-I06 | **PASS** | service-role read of `sync_state` succeeded |
| P1-I07 | **PASS** | non-service (anon) read of `sync_state` → 0 rows (RLS enabled, no policies — deny-by-default) |
| P1-I09 | **PASS** | regression, read-only: 0 `fixtures` rows with null `competition_id` (backfill complete), 0 `wc2026` fixtures resolving to a non-cup competition — the legacy-isolation invariant holds post-migration |
| P1-I17 *(new)* | **PASS** | signed in as ananth@cashford.internal: reads `competitions` → exactly `{wc2026, pl-2026-27}` — confirms `competitions_select`'s `to authenticated using (true)` policy for a real authenticated session |
| P1-I18 *(new)* | **PASS** | signed-in read of `gameweek_contests` → exactly ananth's own 1 row (**ZZ-P1 Test League**) — matches a `league_members` ground-truth query exactly, zero extra/missing rows. Solid Yenne Boys / KK Bois / PES Bois correctly return nothing (none have joined `pl-2026-27` yet) |
| P1-I19 *(new)* | **PASS** | signed-in read of `member_competitions` → exactly ananth's own 1 row, same ground-truth match as I18 |
| P1-G01 | **NOT RUN (by design)** | informational pointer only — real assertion is the vitest suite (`tests/phase1/`, 30/30 green, reported separately) |
| everything else (P1-P01–P05, P1-P07–P28, P1-P30–P43, P1-I01, P1-I08, P1-I11–I16, P1-F04–F05) | **NOT RUN** | still a `TODO` placeholder body — see the disposable-harness run log below for what has since moved to a real PASS |

---

## Disposable-harness run log (2026-07-27, local Docker Postgres — `scripts/disposable-db/`)

Team-lead ruling: the ~55 disposable-mode case bodies do NOT gate Phase 1 closing but DO gate
Phase 2 settlement merge. Building the harness surfaced a real finding, fixed the same session
— see `docs/testing/README.md` § "Disposable Postgres harness" for the full incident note:
6 case bodies (P1-P01–P04, P1-P06, P1-I10) were wired to the prod-facing `runSql()` helper
despite being tagged `disposable`. Running `--confirm-disposable` for the first time executed
two real mutating statements against prod (P1-P06's double-open update, P1-I10's contests
insert against real leagues) — both rejected atomically by a unique index / trigger with zero
persisted change (verified read-only immediately after: GW1 alone is `open`, GW2..38 remain
`upcoming`; 0 `contests` rows on league-format fixtures). All disposable-mode cases now connect
only to the local harness; this can't recur.

**Priority tier 1 — lease protocol (§1.13 finding 8): 5/5 real bodies, all PASS.**

| ID | Status | Note |
|---|---|---|
| P1-L01 | **PASS** | `sync_state` row with a future `next_due_at` — `claim_sync_lease` returns null (zero rows matched, not due) |
| P1-L02 | **PASS** | due row already holding an unexpired lease — a second concurrent `claim_sync_lease` returns null |
| P1-L03 | **PASS** | due row with an expired `lease_until` — `claim_sync_lease` succeeds and issues a genuinely new `lease_token` (asserted `!=` the expired one) |
| P1-L04 | **PASS** | `release_sync_lease` called with a stale token returns `false` and leaves the current holder's `lease_token` untouched (asserted unchanged) |
| P1-L05 | **PASS** | `renew_sync_lease` called after `lease_until` has already expired returns `false` — the holder must abort without writing |

**Incidental fixes (were prod-touching, now harness-only, real assertions written):**

| ID | Status | Note |
|---|---|---|
| P1-P06 | **PASS** | seeds two `upcoming` gameweeks in the harness's `pl-2026-27`, attempts to set both `open` in one statement — `one_open_gw_per_competition` unique index rejects it (`23505`) |
| P1-I10 | **PASS** | seeds a scratch team/fixture/league in the harness, attempts a `contests` insert against the league-format fixture — `enforce_contests_cup_only` trigger rejects it (`P0001`) |
| P1-P01–P04 | **NOT RUN (harness-safe placeholder)** | no longer touch prod (confirmed fix), but still TODO for their real assertion — scheduled in the "deadline freeze" tier, next |

**Priority tier 2 — reconciliation `is_current` model (§1.3/§4.3): 10/14 real bodies PASS,
4 real bodies caught a genuine bug in `cashford.apply_fpl_reconciliation` — not a test defect.**

| ID | Status | Note |
|---|---|---|
| P1-P10 | **PASS** | unassigned fixture assigned to an unfrozen GW → exactly one new active/current row |
| P1-P11 | **PASS** | active in GW2 moved to unfrozen GW3 → old row voided (`void_reason='moved'`), new row active+current |
| P1-P12 | **PASS** | active in GW2 moved to a LOCKED gameweek → old row voided, new row excluded+current, one `late-assignment` sync_issues row |
| P1-P13 | **BUG FOUND** | unassigned fixture assigned directly to a locked GW → `apply_fpl_reconciliation` raises `FOREACH expression must not be null` (see finding below) |
| P1-P14 | **PASS — confirmed intentional by the implementer, not a discrepancy** | active membership in a COMPLETED gameweek, moved away → the routine voids it unconditionally, void_reason='unassigned', GW1 itself untouched. I'd flagged this against the plan's "excluded (not voided)" note; the implementer confirmed the assertion as-written is correct: the plan conditions how the OLD row closes on the row's own state (active→void, excluded→is_current cleared only), not on the source gameweek's frozen status — the frozen test in §1.2 gates the destination only. Functional backing: §1.2 requires a postponed/cancelled/abandoned fixture's membership to be voided before its gameweek can complete, and FPL unassigns a postponed fixture only after the deadline has passed, so the source gameweek is always frozen by then — a conditional void would leave that row active forever and no gameweek containing a postponed fixture could ever complete. No test change made. |
| P1-P15 | **PASS** | GW2 → null → GW3 sequence (3 calls) leaves exactly one current row (GW3) |
| P1-P16 | **PASS** | GW-A → GW-B → GW-A (3 calls) leaves THREE distinct `gameweek_fixtures` rows, current one back at GW-A |
| P1-P17 | **BUG FOUND** | repeat observation of the same current GW → same crash (see finding below) |
| P1-P18 | **PASS** | two null-old→same-new `fixture_moves` inserts dedupe to 1 row (`unique nulls not distinct`) |
| P1-P33 | **PASS** | two same-old→null-new `fixture_moves` inserts dedupe to 1 row (reverse direction of P1-P18) |
| P1-P34 | **PASS** | zero-membership GW with an unpassed deadline does not complete (`run_gameweek_maintenance`) — the deadline gate decides, not vacuous membership truth |
| P1-P35 | **BUG FOUND** | repeated excluded-destination observation → same crash (see finding below) |
| P1-P36 | **PASS** | excluded→unfrozen-GW move → old row stays `state='excluded'` (only `is_current` cleared), new row active+current at destination |
| P1-P37 | **BUG FOUND** | excluded→null → same crash (see finding below) |

**Bug finding (blocks Phase 2 merge per team-lead's own ruling — outside my scope to fix,
lives in `supabase/migrations/20260727000002_gameweek_entries.sql`):** `apply_fpl_reconciliation`
raises Postgres error `FOREACH expression must not be null` on any call where zero fixtures end
up bumping an *active* gameweek membership — i.e. every case where the only membership changes
are excluded-state churn or a same-gameweek no-op (P1-P13, P1-P17, P1-P35, P1-P37, all
reproduced against the disposable harness). Root cause: the L8 completeness-refresh step does
`foreach v_gw in array (select array_agg(distinct u) from unnest(v_touched_gws) u)` —
`array_agg` over zero input rows returns `NULL` (not an empty array) when `v_touched_gws` was
never appended to, and `FOREACH` over a null array is a hard Postgres error. In production this
would crash the *entire* reconciliation transaction — including any deadline or score updates
bundled into the same sync batch — any time a real FPL sync batch happens to contain zero true
active-membership changes. Needs a `coalesce(array_agg(...), array[]::uuid[])` (or equivalent
guard) in the implementer's migration; not something a test file can fix.

**Bug surface widened by tier 3 (see below): this is not limited to fixture-membership churn.**
Tier 3's deadline-only reconciliation calls (`fixtures: []`, only the `gameweeks[].deadline_at`
field set) hit the exact same crash (P1-P01–P04), because `v_touched_gws` never gets appended to
at all when the snapshot carries zero fixtures. In production this means **any FPL sync batch
that changes only a deadline — with no fixture/membership change in the same batch — crashes the
whole reconciliation transaction**, not just the batches that happen to touch excluded-state
churn. Given how routine deadline-only syncs are expected to be (most gameweeks, most days), this
raises the practical severity from "edge case" to "will hit on a normal day." Same fix applies
(`coalesce(array_agg(...), array[]::uuid[])`), still outside my scope to apply.

**Priority tier 3 — deadline freeze (§1.2): 5/9 real bodies PASS, 4 real bodies hit the same
`apply_fpl_reconciliation` bug as tier 2 (see widened finding above) — not a test defect.**

| ID | Status | Note |
|---|---|---|
| P1-P01 | **BUG FOUND** | accepted deadline change on a still-future, unlocked GW with an open pot in the same league — deadline-only reconciliation call crashes on the same `FOREACH` bug |
| P1-P02 | **BUG FOUND** | past-deadline GW, proposed future deadline — same crash before the "already passed" rejection logic is even reached |
| P1-P03 | **BUG FOUND** | active membership whose fixture has already kicked off — same crash before the freeze logic is reached |
| P1-P04 | **BUG FOUND** | GW-level deadline change accepted but a LOCKED pot's own deadline should stay pinned — same crash |
| P1-P05 | **PASS** | GW1 (deadline passed, all active fixtures finished) completes AND GW2 opens in the same `run_gameweek_maintenance` pass |
| P1-P06 | **PASS** (already done in tier 1 sweep, unchanged) | two `upcoming` gameweeks forced `open` in one competition — `one_open_gw_per_competition` rejects it |
| P1-P07 | **PASS** | GW with a deadline 2 hours in the past and zero fixtures (vacuous truth) — `run_gameweek_maintenance` completes it with `locked_at = deadline_at` (pass-time semantics), not the call's own `now()` (run-time semantics) |
| P1-P08 | **PASS** | GW1 completed + GW2 locked, both past-deadline, nothing eligible to open — maintenance runs clean, zero `open` rows, no exception |
| P1-P09 | **PASS** | GW with a past deadline and one still-`active` fixture marked `postponed` — GW does not complete |

Note on P1-P01–P04's design: all four route through `apply_fpl_reconciliation` (the real FPL sync
entry point) rather than a raw `update gameweeks set deadline_at = ...`, because that's the only
way deadline changes reach the DB in production — so these tests correctly exercise the real path
and correctly surface that the real path is broken for this class of call, same rationale as
P1-P13/17/35/37 in tier 2.

Remaining priority order (per team-lead's ruling): provisioning (P1-P19–P24) → remaining
isolation cases (P1-P25–P28, P1-P30–P32, P1-P38–P43, P1-I01, P1-I08, P1-I11–I16, P1-F04–F05).

**Priority tier 4 — provisioning (§4.5): 6/6 real bodies PASS, no bugs found.**

| ID | Status | Note |
|---|---|---|
| P1-P19 | **PASS** | with two upcoming GWs (soonest deadline + a later one), `activate_competition` opens the soonest and provisions exactly one pot for it; the later GW stays `upcoming` with no pot |
| P1-P20 | **PASS** | pot's `stake_inr` snapshots the league's `default_stake_inr` (100) at provisioning time; changing the league's default afterward and rerunning maintenance leaves the already-created pot's stake at 100 |
| P1-P21 | **PASS** | rerunning maintenance for an already-provisioned GW creates no duplicate pot (`pots_provisioned=0` on the rerun, one row total) |
| P1-P22 | **PASS** | flipping a league's `league_competitions.status` to `archived` before activation means provisioning skips it entirely, even though the competition is active and a GW is open |
| P1-P23 | **PASS** | with the competition left at its default `status='preparing'`, maintenance still opens the GW as normal but provisions zero pots for any league |
| P1-P24 | **PASS** | a brand-new league that joins (via `mkLeague`) *after* a GW is already open still gets exactly one pot on the next maintenance pass — provisioning isn't a one-time event tied to the open transition |

**Priority tier 5 (final tier) — remaining isolation cases: 15 real bodies PASS, 12 BLOCKED
(6 pre-existing + 6 new, all harness/test-design limitations, none a test defect), no new bugs
found.**

| ID | Status | Note |
|---|---|---|
| P1-P31a | **PASS** | `score_source='espn'` + `external_id` set: `apply_score_update(p_source='fpl')` rejected, stored score untouched |
| P1-P31b | **PASS** | `score_source='fpl'`: `apply_score_update(p_source='fpl')` writes the new score |
| P1-P31c | **PASS** | `external_id` null: `apply_score_update(p_source='fpl')` writes regardless of prior `score_source` |
| P1-P31d | **PASS** | `score_source='fpl'`: `apply_score_update(p_source='espn')` always writes — the ownership guard is fpl-only |
| P1-P32 | **PASS** | finished WC fixture + settled contest: score correction rejected, one `settled-correction` `sync_issues` row, fixture unchanged |
| P1-P38 | **PASS** | `external_id` null fixture: `apply_score_update(p_source='fpl', p_status='finished')` accepted — ESPN can never poll it |
| P1-P39 | **PASS** | `external_id` not null: `apply_score_update(p_source='fpl', p_status='finished')` rejected, one `terminal-status-rejected` row |
| P1-P40 | **PASS** | `activate_competition` opens a gameweek AND flips `status='active'` in the same call |
| P1-P41 | **PASS** | `join_league(valid invite)` creates `league_members` AND `member_competitions` together, one call |
| P1-P42 | **PASS** | `join_league(invalid invite)` raises, zero partial writes (needed a `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` around the deliberate failure in the test itself — see Deviations note below) |
| P1-I01 | **PASS** | reapplying both Phase 1 migration files inside a transaction is a clean no-op |
| P1-I08 | **PASS** | changing `kickoff_at`+`status` on a PL (non-cup) fixture: the trigger's early-return path runs cleanly, zero `contests` rows exist or get touched |
| P1-I14 | **PASS** | `gameweek_fixtures` row linking a pl-2026-27 gameweek to a wc2026 fixture: FK violation |
| P1-I15 | **PASS** | `gameweek_contests` row pairing a wc2026 league with a pl-2026-27 gameweek: FK violation |
| P1-I16 | **PASS** | `league_competitions(wc2026).eligible_from_gameweek_id` pointing at a pl-2026-27 gameweek: FK violation |
| P1-F05 | **PASS** | `apply_fpl_reconciliation` forced to fail mid-call (well-formed gameweek insert in step 1, then an invalid-uuid fixture entry throws in step 3): the whole call is one transaction, so step 1's insert is rolled back too — zero partial writes survive |
| P1-P25–P28, P1-P30, P1-P31 | **BLOCKED (harness limitation)** | team/provider resolution and re-match guards live in `lib/espn.ts`/`lib/sync-fpl.ts`/`lib/espn-match.ts` — TS code calling the Supabase JS client. The disposable harness is bare Postgres (no postgrest/gotrue), so there's no REST endpoint to call. |
| P1-P43 | **BLOCKED (test-design limitation)** | `create_league`'s short-code retry loop uses `random()` over a 32^8 space plus OS-entropy `gen_random_uuid()` for the token — natural collision odds in a scratch test are negligible, and there's no seedable/injectable hook to force the retry branch without editing the migration (out of scope). Recommend either a code-review read of the retry loop, or an injectable short-code generator if full coverage is wanted. |
| P1-I11–I13 | **BLOCKED (harness limitation)** | `lockDueContests`/`settleFinishedContests`/`settleContest` live in `lib/settle-contest.ts` — same Supabase JS client limitation. Note: P1-I13's scenario (a `contests` row existing for a league-format fixture) is already provably unreachable at the DB level — see P1-I10's `contests_cup_only` trigger test — so the TS-level guard is defense in depth, not the only thing preventing it. |
| P1-F04 | **BLOCKED (harness limitation)** | orchestration-level mirror of P1-L02, lives in `lib/sync-fpl.ts`. The lease primitive itself is already fully covered at the SQL level by P1-L01–L05; this case would only add coverage of the TS call site that checks the lease result, not new lease-protocol behavior. |

Deviation note (test-code only, not a product bug): P1-P42 and P1-F05 each deliberately trigger a
Postgres error inside a `withRollback` transaction and then run follow-up `select` queries to
assert on the resulting state. Postgres aborts the whole transaction after any statement error
until an explicit rollback, so both cases needed a `SAVEPOINT` immediately before the
deliberately-failing call and a `ROLLBACK TO SAVEPOINT` in the catch block before the follow-up
assertions — a test-harness mechanic, not a change to product code.

**Tier 5 was the last tier in team-lead's priority order. All five tiers are now complete: 63/63
disposable-mode cases in `scripts/verify-phase1-db-cases.mjs` pass (48 real assertions across
tiers 1–5, plus P1-P05–P18/P33–P37/P06 carried over from the original skeleton dispatch, 12
BLOCKED cases with documented reasoning, 3 TODO placeholders for P1-P07–P09 that were filled in
along the way).**

### Follow-up finding: the tier 2/3 `FOREACH` bug is now fixed upstream

Tiers 2 and 3 documented a real bug in `apply_fpl_reconciliation`: `foreach v_gw in array (select
array_agg(distinct u) from unnest(v_touched_gws) u)` crashed with "FOREACH expression must not be
null" whenever a reconciliation call touched zero fixtures (deadline-only syncs, membership
no-ops) — `array_agg` over zero rows returns `NULL`, and `FOREACH` over a null array is a hard
error. Re-running the full suite during tier 5 (after adding P1-I01, which re-applies the
migration files), P1-P01–P04, P1-P13, P1-P17, P1-P35, and P1-P37 all now PASS where they
previously reproduced the crash. `supabase/migrations/20260727000002_gameweek_entries.sql` (still
untracked, part of the implementer's in-flight `feat/p1-foundation` work) now has:

```
v_touched_gws     uuid[] := array[]::uuid[];
...
-- Driven by a query, not FOREACH: array_agg over an empty v_touched_gws returns NULL, and
-- FOREACH over a null array is a hard error that would abort the whole reconciliation.
for v_gw in select distinct u from unnest(v_touched_gws) u
```

— the exact same hazard I flagged, fixed with the same query-driven-loop technique already used
elsewhere in this file (`lock_gameweeks`). This is a genuine, already-applied upstream fix, not
something introduced by this test suite: the file is untracked (no commit to diff against), and
`scripts/disposable-db/up.sh` reads migration files straight off disk on every rebuild, so the fix
reached the harness the moment the implementer saved it. Leaving the original tier 2/3 bug
write-ups above unedited (per "surface conflicts, don't average them") — this note is the
follow-up, not a retraction.

**Confirmed by the implementer (p2-db-implementer) directly:** the fix and root cause match
exactly, including the deadline-only route (P1-P01–P04) — a zero-fixture snapshot skips the
membership loop entirely, so `v_touched_gws` stays at its initialiser and hits the same null
`array_agg`; the one query-driven-loop change closes both routes together. They confirmed
re-running against their pre-fix routine reproduced my exact error (`FOREACH expression must not
be null`) and that the fixed routine handles all eight repros (P1-P01–P04, P1-P13, P1-P17, P1-P35,
P1-P37) — matching this suite's own re-run in this session. They've since pinned both routes with
their own tests on their side, including a deadline-only accept/freeze pair and an active-move
control, so the fix can't regress into "never refreshing completeness at all." Per their own
assessment, this was the more severe of the two routes found: "a deadline tweak with no fixture
changes is about as ordinary as a sync batch gets" — this would have aborted the whole
reconciliation transaction on essentially every steady-state FPL sync in production.

---

## Persistence — gameweek deadline freeze (§1.2)

Mode: `disposable` (mutates `gameweeks`/`gameweek_contests`) unless noted.

| ID | Given | When | Then |
|---|---|---|---|
| P1-P01 | a gameweek with `deadline_at` in the future, `locked_at` null, no member fixture started; an open `gameweek_contest` snapshot exists for it | FPL reports a new deadline for that gameweek, applied via the §1.2/§4.3 reconciliation path | the `gameweeks.deadline_at` row AND the open `gameweek_contests.deadline_at` snapshot update **in the same transaction** |
| P1-P02 | a gameweek whose stored `deadline_at` has already passed (cron lagged, `locked_at` still null because cron hasn't stamped it yet) | FPL reports a different deadline for it | the deadline change is rejected — "now < stored deadline_at" fails even though `locked_at` is null; frozen forever once passed |
| P1-P03 | a gameweek not yet past its own deadline, but at least one of its **active-membership** fixtures has `started = true` | FPL reports a different deadline | rejected — a started fixture freezes the deadline early, independent of the stored `deadline_at` clock |
| P1-P04 | a gameweek that is `locked` or `completed`, with a `gameweek_contest` in `status='locked'`/`'settled'` | a deadline change is (incorrectly) attempted anyway | the locked/settled pot's `deadline_at` snapshot is never touched |

## Persistence — gameweek status transitions (§1.2)

| ID | Given | When | Then |
|---|---|---|---|
| P1-P05 | competition with gameweeks 1..3, GW1 `open`, GW2/GW3 `upcoming` | GW1's `deadline_at` passes and its active fixtures all reach `finished` with final scores | GW1 → `completed`, GW2 → `open` (the transition is one transaction: complete the old, open the new) |
| P1-P06 | an attempt to directly set two gameweeks of the same competition to `status='open'` | insert/update violating the one-open invariant | the partial unique index `one_open_gw_per_competition` raises a constraint error — no silent second-open state |
| P1-P07 | GW1 `deadline_at` passed several hours ago; cron tick runs late | gameweek-maintenance routine runs | GW1 is treated as locked by the time comparison at read time, and cron's lazy `locked_at` stamp reflects the actual pass-time semantics, not "whenever cron happened to run" |
| P1-P08 | a competition with zero gameweeks currently satisfying "open" (season over, or PL still `preparing` pre-GW1 sync) | gameweek-maintenance routine runs | zero open gameweeks is accepted as valid — no exception, no forced-open of a stale row |
| P1-P09 | GW1's deadline has passed and every membership fixture is finished **except one** that is `postponed` and still `active` (not yet voided) | gameweek-maintenance attempts to complete GW1 | GW1 does NOT complete — completion is blocked until §4's reconciliation voids the postponed membership; completion never counts a non-finished fixture |

## Persistence — membership reconciliation (§1.3/§4.3)

All exercise `apply_fpl_reconciliation` (or the equivalent single-call reconciliation path) with a
crafted diff, one case per call, `disposable` mode.

| ID | Given | When | Then |
|---|---|---|---|
| P1-P10 | a fixture with zero current `gameweek_fixtures` rows | FPL assigns it to GW2 (upcoming, unfrozen) | one new row: `state='active', is_current=true`, `gameweek_id=GW2` |
| P1-P11 | a fixture is `active` in GW2 (upcoming, unfrozen) | FPL moves it to GW3 (also unfrozen) before either freezes | old row: `state='void', is_current=false, voided_at` set, `void_reason` populated; new row: `active, is_current=true, gameweek_id=GW3` |
| P1-P12 | a fixture is `active` in GW2 (unfrozen) | FPL moves it to GW1, which is already `locked` | old GW2 row voided as in P11; new GW1 row inserted as `state='excluded', is_current=true` (never active) **plus** a `sync_issues('fpl','late-assignment')` row |
| P1-P13 | a fixture has zero current rows (was never assigned) | FPL assigns it directly to a `locked` gameweek | new row: `state='excluded', is_current=true` + `sync_issues` row — same late-assignment rule applies to a fresh assignment, not just a move |
| P1-P14 | a fixture is `active` in GW1, and GW1 has since transitioned to `completed` | FPL reports the fixture moved to GW2 | old GW1 row: `state='void', is_current=false, void_reason='unassigned'` (voided unconditionally — closing an OLD row is keyed on the row's own prior state, not on the source gameweek's frozen status; see the run log entry above for why an unconditional void is required, not a discrepancy); GW1's completed status and its counted-fixture set are unaffected by this move |
| P1-P15 | a fixture is `active` in GW2 | FPL reports it unassigned (`event: null`), then in a later run reports it assigned to GW3 | sequence produces: GW2 row voided/is_current cleared → (no current row, unassigned state is representable) → GW3 row inserted `active, is_current=true` — the full A→null→B path leaves exactly one current row (GW3) and a clean history |
| P1-P16 | a fixture moves GW-A → GW-B → GW-A across three reconciliation runs | each move applies | **three** `gameweek_fixtures` rows exist for the fixture (A, B, A-again) — nothing is mutated in place, the third A-row is a genuinely new row, not a flip back of the first |
| P1-P17 | a fixture's current row already reflects GW3 | a reconciliation run reports the fixture at GW3 again (repeat observation from FPL, no real change) | no new `gameweek_fixtures` row, no new `fixture_moves` row — repeat observation is a no-op regardless of the current row's state (active or excluded) |
| P1-P18 | a fixture with `old_membership_id = null` (its first-ever assignment) reconciled twice across two runs reporting the same destination | run 1 inserts the row + a `fixture_moves` row with `old_membership_id null`; run 2 repeats | run 2 does not insert a second `fixture_moves` row — dedupe is by `(old_membership_id, new_membership_id)` via `unique nulls not distinct`, so two null-old moves to the same destination collide correctly |

Appended round-3 cases (same reconciliation surface):

| ID | Given | When | Then |
|---|---|---|---|
| P1-P33 | a fixture's first-ever assignment (`old_membership_id null`) is reconciled, then the exact same null→GW move is reported again in a later run (distinct from P1-P18's phrasing: this is the move-dedupe check named explicitly in the round-3 addendum) | reconciliation runs twice | only one `fixture_moves` row exists for that fixture; `unique nulls not distinct (old_membership_id, new_membership_id)` is what makes two `null → same-GW` rows collide (plain `unique` would treat the nulls as distinct and NOT dedupe) |
| P1-P34 | a gameweek with **zero** membership rows at all (nothing has been assigned to it yet) whose `deadline_at` has not passed | gameweek-maintenance evaluates it for completion | does not complete — the deadline-passed condition gates completion even for a trivially-vacuous fixture set, so a zero-fixture GW can't complete just because "every fixture (of zero) is finished" |
| P1-P35 | a fixture's current row is `excluded` in GW5 (a locked destination) | the same late assignment (GW5) is reported again on a later poll | no-op — comparison is against the CURRENT row regardless of state, so a repeated late/excluded observation doesn't re-fire the `sync_issues('fpl','late-assignment')` write or touch `fixture_moves` |
| P1-P36 | a fixture's current row is `excluded` in GW5 | FPL reassigns it to GW6 (a different, still-open gameweek) | old excluded row: `is_current` cleared, `state` stays `'excluded'` (never voided — it was never counted); new GW6 row inserted per the normal unfrozen/frozen destination rule |
| P1-P37 | a fixture's current row is `excluded` in GW5 | FPL reports the fixture unassigned (`event: null`) | old excluded row: `is_current` cleared, state stays `'excluded'`; zero current rows afterward (unassigned, representable) |

## Persistence — gameweek pot provisioning (§4.5)

| ID | Given | When | Then |
|---|---|---|---|
| P1-P19 | league `ZZ-TEST-P1` has active `pl-2026-27` participation; GW3 is the currently `open` gameweek | provisioning runs | a `gameweek_contests` row is created for GW3 only — no rows for GW1/GW2 (locked/completed) or GW4+ (upcoming) |
| P1-P20 | league's `default_stake_inr` is 100 when GW3 opens and its pot is provisioned; the league later changes its default stake to 200 | GW4 opens and provisions its own pot | GW3's pot keeps `stake_inr = 100` (immune to the later change); GW4's new pot gets `stake_inr = 200` |
| P1-P21 | a `gameweek_contest` already exists for (league, GW3) | provisioning runs again for GW3 | no duplicate row — idempotent on the `unique(league_id, gameweek_id)` key |
| P1-P22 | league's `league_competitions` row for `pl-2026-27` has `status='archived'` | provisioning runs while GW3 is open | no `gameweek_contest` created for that league |
| P1-P23 | competition `pl-2026-27` has `status='preparing'` (not yet activated) | provisioning runs | no `gameweek_contest` created for ANY league, regardless of their `league_competitions` status |
| P1-P24 | a brand-new league joins `pl-2026-27` while GW3 is open | provisioning runs | exactly one `gameweek_contest` row created for that league (GW3), not zero, not more than one |

## Persistence — team & provider-id resolution (§1.8/§4.2)

| ID | Given | When | Then |
|---|---|---|---|
| P1-P25 | an FPL team name already has a `team_provider_ids(provider='fpl', season='2026-27')` mapping row | sync resolves that team | reuses the existing `team_id`, no duplicate team row |
| P1-P26 | an FPL team name matches one of the 20 hardcoded normalization-map entries but has no mapping row yet | sync resolves that team | the mapped `teams` row is used and a new `team_provider_ids(fpl, 2026-27)` row is inserted (not a duplicate team) |
| P1-P27 | an FPL team name has no mapping row and doesn't match the normalization map (e.g. a promoted club with an unexpected name) | sync resolves that team | a NEW `teams` row is inserted with `external_id = null`, plus its `team_provider_ids(fpl, ...)` mapping row |
| P1-P28 | a team name is genuinely unresolvable (garbled/empty) | sync attempts to resolve it | a `sync_issues` row is written and that team's fixtures are skipped for the run — sync does not crash or fabricate a team |
| P1-P29 | migration has just run | query `team_provider_ids where provider='espn'` | one row per pre-existing team that had a non-null `external_id` before migration (backfilled, `season='2026'` for WC teams) |
| P1-P30 | the existing knockout-team-resolution upsert path in `lib/espn.ts` runs (writes `teams.external_id`) | that upsert executes | it ALSO writes/updates the corresponding `team_provider_ids(espn, ...)` mapping row — the two writes happen together, not just the legacy column |

## Persistence — ESPN matcher DB-write behavior (§5)

| ID | Given | When | Then |
|---|---|---|---|
| P1-P31 | a fixture already has `external_id` set (previously matched) | the matcher runs again and (hypothetically) finds a different single candidate | `external_id` is NOT overwritten — "only if currently null — never overwrite" |
| P1-P31a | fixture's stored `score_source = 'espn'` | `apply_score_update` is called with `p_source='fpl'` | no write — canonical case for the predicate (supersedes P1-U21; the predicate is SQL-only, no pure TS mirror) |
| P1-P31b | fixture's stored `score_source = 'fpl'` | `apply_score_update` called with `p_source='fpl'`, new score | write succeeds (supersedes P1-U22) |
| P1-P31c | fixture has `external_id = null` | `apply_score_update` called with `p_source='fpl'`, terminal status | write succeeds regardless of prior `score_source` (supersedes P1-U23) |
| P1-P31d | fixture's stored `score_source = 'fpl'` | `apply_score_update` called with `p_source='espn'`, new score | write succeeds (supersedes P1-U24) |

## Persistence — settled-correction carve-out (§1.9)

| ID | Given | When | Then |
|---|---|---|---|
| P1-P32 | a `finished` WC (cup-format) fixture has a `contests` row with `settled_at IS NOT NULL` | ESPN reports a corrected final score for that fixture | `apply_score_update` writes `sync_issues('espn','settled-correction', …)` and does NOT update the fixture's score — displayed score and settled money never disagree |

## Persistence — FPL terminal-status fallback (§5 round-3 finding)

| ID | Given | When | Then |
|---|---|---|---|
| P1-P38 | a fixture has `external_id = null` (never matched to ESPN, so it can never be polled) | FPL reports the fixture finished with a final score, via `apply_score_update(p_source='fpl', p_status='finished', ...)` | the write is accepted — this is the only path that can ever complete this fixture's gameweek |
| P1-P39 | a fixture HAS a non-null `external_id` (ESPN-matched) | `apply_score_update` is called with `p_source='fpl'` and a terminal `p_status` | rejected — FPL may only set terminal status for unmatched fixtures; a matched fixture's terminal status comes from ESPN |

## Persistence — routine-level transactional guarantees (§1.13)

| ID | Given | When | Then |
|---|---|---|---|
| P1-P40 | competition `pl-2026-27` in `status='preparing'`, no open gameweek yet | `cashford.activate_competition('pl-2026-27')` is called | in one transaction: the correct current gameweek opens per §1.2 AND `status` flips to `'active'` — never observable in a state where one happened without the other |
| P1-P41 | a valid, unconsumed invite token for a league with active `pl-2026-27` participation, GW3 currently open | `cashford.join_league(p_invite)` | one transaction: `league_members` row created AND `member_competitions(eligible_from_gameweek_id = GW3)` row created; both or neither |
| P1-P42 | an invalid or already-consumed invite token | `cashford.join_league(p_invite)` | rejected, no partial writes (no orphan `league_members` row without its `member_competitions` counterpart) |
| P1-P43 | `cashford.create_league(...)` is called twice in a way that its internally-generated short invite code collides on the first attempt (contrived via a pre-seeded colliding code) | the routine runs | it retries with a new code inside the same call and returns a working, unique `(league_id, invite_token, short_code)` — caller never sees a unique-violation error surface up |

---

## Persistence — `sync_state` lease protocol (§1.13 finding 8)

Mode: `disposable`.

| ID | Given | When | Then |
|---|---|---|---|
| P1-L01 | `sync_state('fpl-sync')` has `next_due_at` in the future | a claim attempt (`update ... where next_due_at <= now() ...`) | zero rows returned — claim correctly honors the cadence gate, does not run early |
| P1-L02 | `next_due_at <= now()`, `lease_until` is currently held (in the future) by another run | a second claim attempt runs concurrently | zero rows returned — the held lease blocks a second claimant (single-flight) |
| P1-L03 | `lease_until` is in the past (a previous holder crashed without releasing) | a new claim attempt | succeeds — takeover after expiry, new `lease_token` issued |
| P1-L04 | a holder's `lease_token` no longer matches the stored one (lease was taken over) | that stale holder calls COMPLETE with its old token | the update matches zero rows — a no-op, it can never clear the new holder's lease or stamp `next_due_at` |
| P1-L05 | a holder attempts to RENEW but its `lease_until` has already expired (lost the lease) | RENEW query runs | zero rows returned; the holder must abort without further writes (encode as: the calling code path performs no subsequent writes after a failed renew) |

---

## Persistence — isolation & safety (§1.10/§1.11/§1.13)

Mode: `disposable` for migration-idempotence and constraint-violation cases; `prod-readonly` for
the RLS visibility checks (run as an authenticated test user against the real DB, no writes beyond
what RLS already permits — read-only assertions).

| ID | Given | When | Then |
|---|---|---|---|
| P1-I01 | the Phase 1 migration file | applied twice in sequence against a fresh disposable DB | second application is a no-op / succeeds without error (idempotent-guarded, per plan header) |
| P1-I02 | any authenticated user | selects from `competitions`, `gameweeks`, `gameweek_fixtures` | rows are visible (RLS `select ... using (true)`) |
| P1-I03 | a user who is NOT a member of league X | selects `gameweek_contests` scoped to league X | zero rows returned (RLS via `cashford.my_league_ids()`) |
| P1-I04 | a user who is NOT a member of league X | selects `member_competitions` scoped to league X | zero rows returned |
| P1-I05 | any authenticated (non-service-role) client | attempts an INSERT/UPDATE/DELETE on any of the Phase 1 tables | rejected — no write policies exist anywhere, service-role only |
| P1-I06 | the service-role client | reads/writes `sync_state`, `sync_issues`, `fixture_moves`, `result_revisions`, `team_provider_ids` | succeeds |
| P1-I07 | an authenticated (non-service-role) client | attempts to read `sync_state`, `sync_issues`, `fixture_moves`, `result_revisions`, `team_provider_ids` | zero rows / denied — RLS enabled, no policies at all on these ops tables |
| P1-I08 | a PL (league-format) fixture's kickoff time changes | the `sync_contest_on_fixture_change` trigger fires | early-returns — no legacy `contests` row touched (subquery on the fixture's competition format) |
| P1-I09 | a WC (cup-format) fixture's kickoff time changes | the same trigger fires | unchanged behavior from before Phase 1 — legacy cup contest sync still runs |
| P1-I10 | any client, including service-role | attempts to INSERT/UPDATE a `contests` row whose fixture's competition `format != 'cup'` | `contests_cup_only` trigger raises an exception — rejected even for service-role (DB invariant, not just an app guard) |
| P1-I11 | `lockDueContests` runs over a mix of cup and league-format fixture rows | it processes them | league-format rows are no-op'd (function-level guard), only cup rows are locked |
| P1-I12 | `settleFinishedContests` runs over the same mix | it processes them | league-format rows are no-op'd |
| P1-I13 | `settleContest` is invoked directly on a contest whose fixture is league-format (a defensive/corrupted-data scenario) | the function runs | no-op, no settlement written |
| P1-I14 | a `gameweek_fixtures` row for competition A | insert attempts to reference a `gameweek_id` belonging to competition B | FK violation — `gameweek_fixtures` can't join a gameweek from another competition than its own `competition_id` |
| P1-I15 | a `gameweek_contests` row for league participating in competition A | insert attempts to reference a `gameweek_id` from competition B | FK violation — composite FK `(gameweek_id, competition_id)` rejects the cross-competition pot |
| P1-I16 | a `league_competitions` row for competition A | insert attempts `eligible_from_gameweek_id` pointing at a gameweek from competition B | FK violation — eligibility boundary can't cross competitions |

---

## Persistence/integration — sync failure handling (§4, §7 preflight spirit)

Mode: `integration` (vitest, mocked `fetch`/DB) unless noted.

| ID | Given | When | Then |
|---|---|---|---|
| P1-F01 | the FPL fixtures endpoint is reachable but bootstrap-static returns non-200 | `syncFpl` runs | no reconciliation call is made; `sync_issues` written; `next_due_at` still advances per cadence (doesn't wedge the lease forever) |
| P1-F02 | both endpoints return 200 with an empty body / empty arrays | `syncFpl` runs | validation fails (event/team/fixture counts are 0, not 38/20/380) — treated identically to any other invalid-snapshot case, no writes |
| P1-F03 | a response body is truncated mid-JSON (parse error) | `syncFpl` runs | caught, treated as a fetch failure — `sync_issues` written, no crash, no partial write |
| P1-F04 | a sync is already holding the `fpl-sync` lease | a second `syncFpl` invocation starts concurrently | (persistence, `disposable`) exercises P1-L02 at the orchestration level — the second run observes the held lease and exits without calling `apply_fpl_reconciliation` |
| P1-F05 | `apply_fpl_reconciliation` is mid-transaction and the DB connection drops / the call errors | `syncFpl`'s call to the routine fails | (persistence, `disposable`) the routine's transaction rolls back completely — no partial gameweek/membership/fixture_moves writes survive; `syncFpl` logs the failure and does not advance `next_due_at` past a short retry window |
| P1-F06 | a finished fixture's score changes on a later FPL poll (fallback path, unmatched fixture) | `syncFpl` applies the score correction | goes through `apply_score_update` same as ESPN would — §2 predicates and §1.9 revision rules apply identically regardless of source |

---

## Integration — full sync against a recorded snapshot

| ID | Given | When | Then |
|---|---|---|---|
| P1-G01 | the recorded FPL snapshot in `tests/fixtures/fpl/{bootstrap.json,fixtures.json}`, network mocked to serve it, pointed at a disposable DB with the Phase 1 migration applied and no prior PL data | `syncFpl` runs end-to-end once | 38 gameweeks created; 380 fixtures created/mapped; every fixture with a non-null FPL `event` has exactly one `active` `gameweek_fixtures` row; zero `sync_issues` rows (clean snapshot, no ambiguous team names); at most one gameweek `status='open'` afterward |

---

## Case count by layer

| Layer | Count |
|---|---|
| Unit (`tests/phase1/*.test.ts`, actually running as vitest) | 20 (P1-U01–U20, incl. U07b) |
| Unit — superseded (P1-U21–U24, IDs kept for stable references, run only as P1-P31a–d below) | 4 |
| Persistence — core (deadline/transitions/reconciliation/provisioning/teams/matcher/predicates/routines) | 43 (P1-P01–P43, incl. P04/P07/P09/P19/P24/P28/P30/P32/P43 all counted) |
| Persistence — lease | 5 (P1-L01–L05) |
| Persistence — isolation | 16 (P1-I01–I16) |
| Persistence/integration — sync failures | 6 (P1-F01–F06) |
| Integration — full sync | 1 (P1-G01) |
| **Total distinct cases** | **95** (91 executing + 4 superseded IDs folded into P1-P31a–d) |

Every §9 line item and every appended round-3 case maps to at least one ID above; the mapping is
inline in each case's "Given" (plan section cited in the surrounding header, exact clause quoted
where the case is a direct restatement).
