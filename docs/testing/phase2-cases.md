# Phase 2 test cases — gameweek engine (points, tiebreak, settlement, lifecycle)

Written from `docs/plans/2026-07-27-005-phase2-engine-plan.md` (v4), before the implementation
lands. Every row cites the plan section it enforces. IDs are stable — reference them in commit
messages and code comments, don't renumber.

Layers: **pure** (`npx vitest run tests/phase2`, no DB — `npm run test:phase2`) exercises the
value objects in plan §1 through the pure engine only. **Persistence** (real Postgres, disposable
mode like Phase 1) exercises schema, RLS, triggers, the claim/finalize state machine, and lifecycle
transitions — these need the §0 migration and are **pending persistence layer**: documented here
with IDs so nothing gets lost, no runners exist yet. **Security** (RLS, `prod-readonly` style)
and **Integration** (`scripts/verify-phase2.mjs`, shared DB, scratch league) are likewise pending.

Naming: `P2-U##` pure engine (this doc's only layer with runnable suites right now), `P2-P##`
persistence/lifecycle, `P2-S##` security/RLS, `P2-G##` integration smoke.

## Interface assumptions (flag for reconciliation — see delegation report)

Plan §1 gives exact value-object shapes (`Pick`, `FixtureResult`, `Entry`, `GwInput`, `UserScore`,
`GwOutcome`) but names no function signature. Every pure test in `tests/phase2/` drives the engine
through one assumed entry point:

- `settleGameweek(input: GwInput): GwOutcome`, imported from `lib/gameweek-settle`.

This is a black-box choice deliberately made to minimize assumption surface — rather than guessing
at a separate per-entry scoring export from `lib/gameweek-points.ts` (also named in the plan
header but with no signature given), every case drives the whole engine and reads results off
`outcome.scores` / `outcome.winners` / `outcome.transfers`. If the real export name or shape
differs, fix the import in `tests/phase2/*.test.ts` and `tests/phase2/helpers.ts` — the case
intent (given/when/then) stays the same.

---

## Pure — points (§2 P1–P4)

| ID | Given | When | Then |
|---|---|---|---|
| P2-U01 | 2 entrants; result home win 2-1; subject predicts 2-1 | `settleGameweek` | subject scores 3pts, verdict `exact` |
| P2-U02 | result draw 1-1; subject predicts 1-1 | `settleGameweek` | subject scores 3pts (exact draw) |
| P2-U03 | result away win 0-2; subject predicts 0-2 | `settleGameweek` | subject scores 3pts (exact away win) |
| P2-U04 | result home win 2-0; subject predicts 3-1 (same sign, not exact) | `settleGameweek` | subject scores 1pt, verdict `result` — never 4, exact implies result |
| P2-U05 | result away win 0-3; subject predicts 1-2 (same sign, not exact) | `settleGameweek` | subject scores 1pt |
| P2-U06 | result draw 1-1; subject predicts 2-2 (same sign, not exact) | `settleGameweek` | subject scores 1pt |
| P2-U07 | result home win 2-0; subject predicts 0-1 (wrong sign) | `settleGameweek` | subject scores 0pt, verdict `miss` |
| P2-U08 | result away win 0-1; subject predicts 2-0 (wrong sign) | `settleGameweek` | subject scores 0pt |
| P2-U09 | result 0-0; subject predicts 0-0 | `settleGameweek` | subject scores 3pts — a scoreless exact is never demoted |
| P2-U10 | result 4-3; subject predicts 4-3 | `settleGameweek` | subject scores 3pts — exact never awards more than 3 |
| P2-U11 | 2 fixtures: f1 void, f2 final (exact for subject) | `settleGameweek` | f1 excluded from points AND exacts AND goalError for every entrant; subject's total = f2 only |
| P2-U12 | subject has an extra pick (f3) with no matching result (stale — fixture left the GW) | `settleGameweek` | scores nothing for f3, no throw, `diagnostics` contains an entry referencing f3 |

## Pure — input validation (§1, throws-never-guesses)

| ID | Given | When | Then |
|---|---|---|---|
| P2-U13 | a locked_in entry missing a pick for a counted final fixture | `settleGameweek` | throws |
| P2-U14 | duplicate `fixtureId` across two rows in `results` | `settleGameweek` | throws |
| P2-U15 | duplicate `userId` across two `entries` | `settleGameweek` | throws |
| P2-U16 | a `final` result missing one score (`home` or `away`) | `settleGameweek` | throws |
| P2-U17 | `stakeInr` is non-integer, zero, or negative | `settleGameweek` (×3 sub-cases) | throws in each case |
| P2-U18 | a prediction is out of `0..99` (high, negative) or non-integer | `settleGameweek` (×3 sub-cases) | throws in each case |
| P2-U18b | one entry has two picks for the same `fixtureId` | `settleGameweek` | throws — uniqueness is per-entry too, not just across `results` |

## Pure — winner + tiebreak (§3 W1–W7)

| ID | Given | When | Then |
|---|---|---|---|
| P2-U19 | 2 entrants, unique max points (3 vs 1) | `settleGameweek` | single winner, `tiebreakUsed: 'none'` (W3) |
| P2-U20 | 2 entrants tied 3pts each; one has 1 exact + 2 miss, other has 3× result-only | `settleGameweek` | exacts (1 vs 0) breaks the tie (W4) |
| P2-U21 | 3 entrants tied 3pts each; two share 1 exact each (0 for the third), the two survivors differ in goalError | `settleGameweek` | third entrant eliminated at W4; goalError (W5) decides between the surviving two |
| P2-U22 | 2 entrants tied on points (2 each) and exacts (0 each), different goalError | `settleGameweek` | goalError (W5) breaks the tie |
| P2-U23 | 2 entrants with different scorelines but identical closeness (goalError), tied through every criterion; a 3rd entrant clearly loses | `settleGameweek` | `tiebreakUsed: 'split'` (W6), 2 winners |
| P2-U24 | 3 entrants with identical picks tie on everything; a 4th clearly loses | `settleGameweek` | `tiebreakUsed: 'split'`, 3 winners |
| P2-U25 | everyone scores 0 points on a fixture; predictions differ in closeness | `settleGameweek` | tiebreak still resolves via goalError (W7 — "everyone scored 0" is not special) |
| P2-U26 | two entrants' picks are literally identical values; a 3rd loses | `settleGameweek` | guaranteed split between the two identical entrants |
| P2-U27 | ALL entrants (3) have identical picks, no losers | `settleGameweek` | everyone wins, `transfers: []` (W6, explicitly legal) |

## Pure — money (§4 M1–M5)

| ID | Given | When | Then |
|---|---|---|---|
| P2-U28 | 2 entrants, one winner one loser, stake 100 | `settleGameweek` | winner pays nothing, loser pays exactly 100; `potInr` = stake × entrantCount = 200 (display only) |
| P2-U29 | 7 entrants, 1 winner, 6 losers, stake 50 | `settleGameweek` | winner receives 50 × 6 = 300 across 6 transfer rows; `potInr` = 350 |
| P2-U30 | 3 tied winners, 1 loser, stake 100 | `settleGameweek` | per-loser split: base 33 + remainder 1 → ascending-userId winner gets 34, others 33; total = stake |
| P2-U31 | 3 tied winners, 1 loser, stake 2 (k > stake) | `settleGameweek` | base 0, only the 2 remainder winners (ascending) are paid 1 each |
| P2-U32 | 4 tied winners, 1 loser, stake 2 | `settleGameweek` | zero-value transfer rows are omitted entirely — only 2 rows exist, not 4 with two `amountInr: 0` |
| P2-U33 | 500 seeded-random valid gameweeks (2-8 entrants, 1-5 fixtures, random stake) | `settleGameweek` each | Σnet = 0; every `amountInr` a positive integer; every loser's total out = stake; total transferred = stake × loserCount |

## Pure — determinism (§1)

| ID | Given | When | Then |
|---|---|---|---|
| P2-U34 | same GW content fed with entries/results in reverse order | `settleGameweek` (twice) | `scores` sorted userId asc, `perFixture` sorted fixtureId asc, and the two outcomes are deep-equal — input order never leaks into output |

## Pure — void precedence (§3 W1-W2)

| ID | Given | When | Then |
|---|---|---|---|
| P2-U35 | 0 entrants | `settleGameweek` | `void('no_entrants')` |
| P2-U36 | exactly 1 locked_in entry | `settleGameweek` | `void('single_entrant')`, no transfers |
| P2-U37 | 2 entrants, all effective fixtures void | `settleGameweek` | `void('all_fixtures_void')` |
| P2-U38 | 0 entrants AND all fixtures void | `settleGameweek` | `no_entrants` wins (precedence over `all_fixtures_void`) |
| P2-U39 | 1 entrant AND all fixtures void | `settleGameweek` | `single_entrant` wins (precedence over `all_fixtures_void`) |
| P2-U40 | 10 fixtures, 9 void, 1 final | `settleGameweek` | settles normally; only the 1 final fixture counts toward points/winner |

---

## Persistence/lifecycle — pending persistence layer (§0, §0b, §0.6, L1–L9)

These need the Phase 2 migration (`gameweek_entries`, `gameweek_picks`, `gameweek_entry_results`,
`gameweek_results`, `gameweek_audit_log`, concurrency columns) applied to a disposable Postgres,
mirroring the Phase 1 `verify-phase1-db-cases.mjs` pattern. No runners exist yet.

| ID | Given | When | Then |
|---|---|---|---|
| P2-P01 | open GW, pre-deadline | enter/edit picks via the enter/edit routine | one transaction: entry + picks row(s); replacing picks pre-deadline works any number of times (L1/L2) |
| P2-P02 | a request that acquires the gameweek advisory lock while `clock_timestamp()` is about to cross the deadline | entry attempt waits on the lock, deadline passes mid-wait | rejected — checked with `clock_timestamp()` after the lock, not `now()` (L1) |
| P2-P03 | a GW with 10 effective-active fixtures, entrant has picks for only 9 | maintenance evaluates completeness at lock | entry flips to `invalid` (L3/L8) — incomplete never becomes `locked_in` |
| P2-P04 | an entrant has a pick for a fixture that is `excluded` in this GW | completeness check | that pick doesn't count toward completeness (it was never active) |
| P2-P05 | an entrant has a pick whose `membership_id` belongs to a different gameweek | completeness / scoring | rejected — pick can't count for a GW it was never made in |
| P2-P06 | a fixture voided after entries exist, its picks stored | effective state flips to void | picks stay stored; scored as void (P2) for everyone (§0b, L4) |
| P2-P07 | a voided fixture returns active pre-deadline (new active membership) | completeness/scoring re-evaluated | original picks count again, matched by `fixture_id`, even though `membership_id` still points at the old (voided) membership row (L4) |
| P2-P08 | a fixture's history is active→void→active, including duplicate history rows | effective-state derivation (§0b) | active wins over older void; the correct single effective state is derived, not double-counted |
| P2-P09 | a fixture's history is active→void→excluded | effective-state derivation | void wins over a later excluded return (§0b ordering rule) |
| P2-P10 | a fixture assigned to the GW post-deadline (state `excluded` per Phase 1 guarantee) | scoring | ignored entirely (L5) |
| P2-P11 | FPL adds an active fixture to an open or upcoming GW after entries exist | reconciliation | every repairable entry gets a 0-0 pick and stays or returns `entered`; each affected pot gets one `fixture_zero_fill` audit row and exactly one `membership_change` input-version bump |
| P2-P11b | an entry is missing a pick for an effective-active fixture through a path outside FPL reconciliation | completeness refresh | the dormant repair state remains reachable: the entry flips to `needs_update`, and an edit that supplies the other missing pick restores `entered` (L8) |
| P2-P12 | an entry stays `needs_update` through the deadline | maintenance runs lock | flips to `invalid`: visible, stakes nothing, wins nothing — not withdrawal (L8) |
| P2-P13 | eligibility grid: null/current/future `eligible_from` at both league and member level | enter routine (L9) | null = not yet eligible (never "eligible from the start"); current/future evaluated by GW **number** comparison, not UUID |
| P2-P14 | a member joins right at a GW's deadline (±ε) | enter routine eligibility check | boundary resolves consistently with the numeric comparison rule, no off-by-one |
| P2-P15 | a member has `left_at` set (departed) | enter routine | rejected for new entries; but their already-locked-in entry from before departure still settles (post-lock departure doesn't remove from settlement) |
| P2-P16 | a league's `league_competitions` row is `archived` | enter routine | rejected |
| P2-P17 | settle trigger check: locked GW, not every effective-active fixture is `finished` with both scores | claim attempt | not claimable — readiness gate fails (L6) |
| P2-P18 | `claim_gameweek_settlement` succeeds, then `finalize_gameweek_settlement` is called with an old/unknown token | finalize | no-op, returns `stale`, changes nothing (L7) |
| P2-P19 | `finalize_gameweek_settlement` called with the correct token but a version that no longer matches current `input_version` (input changed mid-compute) | finalize | releases the claim (restores prior status) and returns a retry result — without raising (L7 round-2 finding) |
| P2-P20 | a `settling` row's `claim_started_at` is older than 10 minutes | expired-claim scan | reclaimed only if ready; otherwise claim cleared and `claim_prior_status` restored (L7) |
| P2-P21 | a contest is already `settling` with a valid, unexpired claim | a second claim attempt | rejected — no double claim |
| P2-P22 | 0 or 1 locked_in entries at lock time | maintenance (not the claim path) | writes the W1 void directly (no claim, no entry-result rows) — atomic, in the same transaction as lock (L3 round-2 finding) |
| P2-P23 | a settled contest is marked dirty by an `input_version` bump (result revision) | re-settle | M5: prior transfers marked `reversed=true`, new transfers inserted, `settled_version` set to the claim's captured version (not `+1` arithmetic) |
| P2-P24 | a re-settle produces the SAME winner as before | re-settle | still writes a fresh transfer set + marks the old reversed — money history is never silently reused |
| P2-P25 | a contest is re-settled twice in sequence (multiple revisions) | each re-settle | audit chain records both, `settled_version` always reflects the version actually consumed |
| P2-P26 | one result revision affects a fixture shared by N leagues' gameweek contests | reconciliation | the bump/dirty/re-settle fan-out touches all N contests, each independently |
| P2-P27 | reconciliation/sync is running for a competition while an entry attempt targets the same gameweek | both paths run concurrently | the §0.6 lock ordering (competition gate → gameweeks asc → fixtures asc → contest/eligibility rows) prevents deadlock; one waits for the other |
| P2-P28 | settlement claim and a live score update target overlapping gameweek advisory locks | both run concurrently | `apply_score_update`'s rewritten lock order (gameweek lock before fixture lock) avoids the inversion that would deadlock against a claim |
| P2-P29 | a gameweek with exactly 4 fixtures ("blank GW") | full entry → lock → settle flow | behaves identically to a normal GW — no special-casing bug for a small fixture count |
| P2-P30 | a gameweek with 12 fixtures where one team appears twice ("double GW") | full entry → lock → settle flow | both fixtures for the repeated team are scored independently, no dedupe-by-team bug |
| P2-P31 | a fixture's status flips `finished → live` (correction) with scores unchanged | bump-rule check (§0.6) | still counts as a version bump (readiness changed even though scores didn't) — a dirty contest becomes unready and waits |
| P2-P32 | one reconciliation run changes both membership AND scores for a contest's fixtures | bump-rule check | exactly one bump, cause `'combined'` — not two separate bumps |
| P2-P33 | a GW has zero effective-active fixtures | entry attempt | rejected at the API/DB layer (distinct from the pure engine, which would trivially require zero picks) |
| P2-P34 | an entry-vs-leave race: a member leaves while their entry is mid-validation | both operations attempt to run concurrently | the shared row-lock ordering (L9) prevents an entry from being validated as eligible while a concurrent leave is interleaving |
| P2-P35 | a mirror-vs-archive race: a league is archived while a mirror targeting it is mid-validation | both operations attempt to run concurrently | same lock-ordering guarantee prevents a mirror landing in an archived league |
| P2-P36 | a mirror request's `acceptedStakeInr` doesn't match the target contest's stored `stake_inr` (stale UI) | mirror routine | writes NOTHING for that target; per-target error list returned; other targets in the same request are unaffected only if the routine is genuinely per-target atomic (verify) |

## Security — pending persistence layer (§0.7 RLS)

| ID | Given | When | Then |
|---|---|---|---|
| P2-S01 | an authenticated user querying `gameweek_picks` for a contest whose deadline hasn't passed, picks not their own | direct authenticated Supabase query (no API layer) | zero rows — the reveal rule lives in RLS itself, not just the API |
| P2-S02 | the same query at/after the contest's deadline | direct authenticated query | rows visible — reveal happens exactly at deadline |
| P2-S03 | a user queries `gameweek_entries`/`gameweek_picks`/`gameweek_entry_results` for a league they are not a member of | direct authenticated query | zero rows |
| P2-S04 | an insert attempts a `gameweek_picks` row whose `membership_id` points at a fixture from a DIFFERENT gameweek or competition than the entry | insert (any client) | rejected — full-scope composite FK (§0.1) |
| P2-S05 | an insert attempts a `gameweek_entry_results` row whose `gameweek_contest_id` doesn't match its `entry_id`'s actual contest | insert | rejected — coupled composite FK (§0.3) |
| P2-S06 | the anon role | attempts to call any of the claim/finalize/abort/enter/edit/mirror routines | rejected — REVOKE from public/anon, GRANT authenticated only for user-facing ones |
| P2-S07 | `gameweek_picks`, `gameweek_entries`, etc. | checked against the realtime publication list | new tables are NOT present — picks especially must never leak via realtime |
| P2-S08 | an authenticated (non-service-role) client | attempts to call `claim_gameweek_settlement` / `finalize_gameweek_settlement` / `abort_gameweek_settlement` directly | rejected — settlement routines are service-only |

## Integration — pending persistence layer (§6 Integration, §8 step 5)

| ID | Given | When | Then |
|---|---|---|---|
| P2-G01 | scratch league `ZZ-TEST-*`, 5 users; 5 enter via routines, one skips entirely, one is harness-forced to `needs_update` then resolves via edit | scripted ESPN-style scores land, contest reaches ready, claim/finalize runs | transfers land correctly; Dues aggregation (legacy `contest_results` UNION `gameweek_entry_results.net_inr`) reflects the settled net; a later result revision flips the winner → re-settle runs with the M5 reversal rule; Σ non-reversed net = 0 and visibility end-state (who sees what, pre/post deadline) is correct throughout — ordered teardown, no browser step (that's Phase 3) |

---

## Case count by layer

| Layer | Count |
|---|---|
| Pure — points | 12 (P2-U01–U12) |
| Pure — input validation | 7 (P2-U13–U18b) |
| Pure — winner/tiebreak | 9 (P2-U19–U27) |
| Pure — money | 6 (P2-U28–U33, U33 is the 500-iteration property test) |
| Pure — determinism | 1 (P2-U34) |
| Pure — void precedence | 6 (P2-U35–U40) |
| **Pure total (runnable now, `npm run test:phase2`)** | **41** |
| Persistence/lifecycle — pending | 36 (P2-P01–P36) |
| Security — pending | 8 (P2-S01–S08) |
| Integration — pending | 1 (P2-G01) |
| **Grand total** | **86** |

Every §6 case-matrix bullet maps to at least one ID above; the mapping is inline in each case's
"Given" (plan section cited in the surrounding header).
