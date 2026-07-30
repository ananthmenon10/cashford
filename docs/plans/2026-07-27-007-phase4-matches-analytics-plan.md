# Phase 4 — Matches, Analytics, match detail + insights pipeline. Deep implementation plan v11 (FINAL)

**Status: APPROVED-WITH-CARVE-OUT.** The review loop closes here, after ten rounds. Everything in this
document is contract **except the RO-1 / RO-2 rollout-assertion cluster in §12 and §13 step 4**, which is
carved out and becomes an **implementation-time contract under decision #34**. Round 11 returned three
findings, all inside that cluster and two of them defects in v11's own new text — the plan had started
generating its own defects, so the tail moves to where it can be written against real code instead of
more plan prose. **No key may be armed until the carved-out contract is written and passes review.** The
carve-out box sits above §12's RO-1 and states the three findings and the binding requirement; it
supersedes the RO-1/RO-2 prose wherever they disagree, and that prose is left unedited on purpose, as the
starting point implementation revises rather than a specification to follow.

v11 after Sol review round 10 (REWORK, 5 blocking findings and 3 should-fixes; round 9's caller-shapes item
confirmed resolved, the claim routine and the RO-1/RO-2 pair partial). All 8 round-10 fixes folded in, on
top of rounds 1–9. Ten mapping tables at the bottom, round 1 → … → round 10. Orchestrator rulings are marked
**[R1]**–**[R5]** (round 1), **[S1]**–**[S4]** (round 2), **[T1]**–**[T8]** (round 3),
**[V1]**–**[V8]** (round 4), **[W1]**–**[W6]** (round 5), **[X1]**–**[X4]** (round 6),
**[Y1]**–**[Y8]** (round 7), **[Z1]**–**[Z4]** (round 8), **[Z5]**–**[Z7]** (round 9) and **[Z8]**
(round 10) where they land.
v1 preserved at `2026-07-27-007-phase4-matches-analytics-plan.v1.md.bak`, v4 at `…v4.md.bak`,
v5 at `…v5.md.bak`, v6 at `…v6.md.bak`, v7 at `…v7.md.bak`, v8 at `…v8.md.bak`, v9 at `…v9.md.bak`,
v10 at `…v10.md.bak`.

**The three round-10 corrections that change behaviour** — the other five are bookkeeping:

1. **Every Phase 4 poller claims through `claim_phase4_lease`, not Phase 1's `claim_sync_lease` [Z8].**
   v10 added the routine but left §4.6's instruction pointing at the Phase 1 one, which E1 now rejects for
   any Phase 4 file — an implementer following the text would have written code its own scanner fails.
   Only the claim changes hands; renew and release stay Phase 1's routines.
2. **The claim routine reads `clock_timestamp()` after the lock, not `now()` [Z8].** `now()` is
   transaction-stable, so a caller that waited two seconds behind another transaction still classified
   against its own start time and could return `leased` for a lease that expired while it waited. One
   `clock_timestamp()` taken after `for update` drives both comparisons and both written timestamps.
3. **RO-2 attributes protected-table changes to the poller, not to the tick [Z8].** The same real tick runs
   reconciliation, score polling, locking and settlement first, all of which legitimately write protected
   tables, so v10's whole-tick checksum bracket would have forced `--revert` on correct behaviour. The
   window is now the target poller's own, with the attribution mechanism stated (§12 RO-2).

**The two round-9 corrections that change the shape of the phase**, both decided by Ananth after
escalation:

1. **Phase 4 gets its own atomic claim routine, `claim_phase4_lease` (new §1.7c) [Z5].** v9's reason-bearing
   lease result was computed by reading the row back after Phase 1's `claim_sync_lease` returned null — a
   race, so `leased` could report as `not_due` and vice versa. The new routine locks the row (`for update`),
   classifies and claims in **one transaction**, returns `(outcome, token)`, carries the same hard-coded
   nine-key allowlist and the full Phase 1 privilege pattern, and leaves Phase 1's routine untouched. E2's
   approved-routine list grows to three names; P-30…P-36 test the three outcomes including under
   concurrency and the exact interleavings that broke v9.
2. **RO-1 splits across two environments, and prod truth moves to RO-2 [Z6].** Making a poller due means
   writing `fixtures`, a shared reference table — so the **positive** half of every RO-1 cell moves to a
   disposable backend wired to the same deployed artifact, the **negative** (dark) half stays on the shared
   prod DB where it needs no seeding, and the scratch-rows-only rule stays absolute. New **RO-2** recovers
   the prod evidence immediately after each arming: one real tick, assert that key's `sync_state` row
   advanced and no protected row moved — scoped in v11 to that poller's own window rather than the whole
   tick (§12 RO-2) **[Z8]**.

**The two round-8 corrections that change the shape of the phase**

1. **A failed lease claim says *which* failure it was.** `claim_sync_lease` returns null both when a key
   is not due and when a due key is already leased; v8 reported both as `not_due`, which is false for the
   second and contradicts the `{skipped:'leased'}` case Phase 4's own contract defines **[Z7]**. `claimPhase4Lease` now returns
   **`claimed | not_due | leased`**, threaded through §4.6, P-18b, RO-1 and the cron response union
   together **[Z1]**.
2. **RO-1 is per key, and never at the shared DB's expense.** One recipe — seed a fixture, expect a fetch
   — cannot run for `deriveStandings` (settlement-driven, no fetch), `reconcileMatchCache` (cache-only) or
   `pollStandings` (competition-scoped). Each key now states its own due setup and positive signal, the
   scratch-rows-only rule is **absolute**, and **all nine positive halves run on the disposable harness
   (round-10 finding, corrected in v11) [Z8]** — v9 sent only two keys there; v10 moved every positive
   cell, because making *any* poller due means writing a shared reference table. Only the dark negative
   half stays on the shared prod DB **[Z2][Z6]**.

**The three round-7 corrections that change the shape of the phase**, each one reversing something v7
asserted (the other five — U-2c's unsatisfiable assertion, U-19's stale strip count, the `latestSettledGw`
ordering rationale, the reveal-rule wording and one wrong routine name — are folded in place and mapped at
the bottom):

1. **A rollout gate must assert reported evidence, not absence.** v7 had RO-1 read a failed claim out of
   `sync_state`, which has five columns and records no claim attempt at all — and a direct caller with
   nothing due would have passed the same assertion. Every Phase 4 poller now returns
   **`{ lease, fetches, writes }`** in the cron response, and RO-1 runs against state **guaranteed to be
   due**, with a paired positive case after arming (§12 RO-1, §13 step 4) **[Y1]**. Round 8 widened
   `lease` to three values and made RO-1's setup per key — see **[Z1]**/**[Z2]** above.
2. **The dirty predicate has one owner, and it is Phase 3's.** v7 said `isGwClean` in
   `lib/analytics-math.ts` owns the dirty test for all of Phase 4; Phase 3 §5.3 PR3b already owns and
   exports it from **`lib/net-balance.ts`** (T-U8) precisely so Phases 3–5 share one implementation.
   `isGwClean` becomes a thin per-gameweek aggregator over that export with **no version comparison of its
   own**, and U-14g asserts the delegation (§6.6 rule 1) **[Y5]**.
3. **One overlap gate governs every surface.** §6.1 rule 5 said `overlapAlert` suppresses cumulative
   figures while §6.6 and U-14d suppress only the lead card — so a CL10 gameweek overlapping another
   unsettled one would keep or hide the cumulative cards depending on which section got implemented. Rule 5
   now says **lead card**, and the CL10-plus-overlap case is asserted (§6.1 rule 5, U-14d/U-14f) **[Y4]**.

**The three round-6 corrections that changed the shape of the phase**, each one reversing something v6
asserted (the fourth — the single-dirty-predicate claim and the drifting schema anchors — is folded in
place and mapped at the bottom):

1. **CL10 is a waiting state on *every* surface, not just the resolver.** v6 fixed §6.1 and left the row
   builder calling CL10 "terminal and clean" while `AnalyticsTabView` had no state for it at all. The
   `all-called-off` arm now carries **`waiting: true`** and the settlement-pending caption, Analytics
   gains **`state: 'awaiting_settlement'`** plus the two `awaiting_void_*` strips, and **U-2c / U-14f**
   drive the CL10 → CL7 transition through both (§6.3a, §6.6, §9.1) **[X1]**.
2. **A dark-launch key controls nothing until its caller goes through the lease — v6's false claim.**
   v6 said seeding `espn_insights = 'infinity'` makes the existing insights poller dark from the moment
   the migration lands. It does not: `app/api/cron/tick/route.ts` calls `pollInsights` directly and
   `lib/espn-insights.ts` never reads `sync_state`. The old poller stays live until the lease-gated
   rewrite deploys, keys are armed only after that deploy, and **RO-1** proves the deployed caller honours
   `'infinity'` before any arming (§1.7b, §13 step 4) **[X2]**.
3. **The match-detail lock deadline is league-scoped and nullable — v6's second false claim.**
   `gameweek_contests.deadline_at NOT NULL` guarantees a value only where a contest row exists, and one
   per league. The neutral deep link (`room: null`) has no contest at all, and a multi-league viewer can
   hold divergent snapshots. `header.deadlineAt` becomes `string | null` (the selected room's value),
   `room.deadlineAt` and `yourCalls[].deadlineAt` carry the scoped values, the neutral case renders no
   lock line, and **U-18e / U-18f** cover both callers (§6.5, §8) **[X3]**.

**The three round-5 corrections that changed the shape of the phase**, each one reversing something v5
asserted (the other three — E2's self-rejecting scan rule, the nullable `header.kickoffAt`, and §1's
cascade claim — are folded in place and mapped at the bottom):

1. **CL10 is a waiting state, not a terminal one — v5's one false claim.** v5 said no result row will ever
   be written over a wholly called-off gameweek and treated CL10 as clean. Phase 2 does write one: a
   ≥2-entrant all-void contest becomes ready trivially and settles through claim/finalize as
   `all_fixtures_void` (Phase 2 plan §L3, §3 W2). So CL10 now counts as **unresolved and stays
   `currentGw`** until Phase 2's void lands and it reclassifies CL7 (§6.1 rules 2–3, R-13/R-13b) **[W2]**.
2. **Reconciliation acknowledges the kickoff it reconciled against, including null.** A fixture postponed
   to no date is never in a due window, so nothing would ever write `source_kickoff_at = null` and the
   mismatch fired every tick forever. The invalidating statement now writes the current value itself
   (§4.7, I-6h) **[W3]**.
3. **Rule 2 reads Phase 3's classification instead of restating Phase 2's dirty predicate.** Clean means
   `cl ∈ {CL5, CL7}`; the comparison is **removed from resolver rule 2** and is not restated there
   (§6.1 rule 2) **[W2]**. It is not gone from the phase — Analytics still needs a per-gameweek
   cleanliness test, and it gets one by calling **Phase 3's exported predicate in `lib/net-balance.ts`**
   through the thin per-gameweek aggregator **`isGwClean(gw)`** in `lib/analytics-math.ts`, which holds no
   version comparison of its own (§6.6 rule 1, round-6 finding 4 and round-7 finding 5) **[X4]** **[Y5]**.

**The four round-4 corrections that changed the shape of the phase**, because each one reverses something
v4 asserted (the other four — P-20's whole-table `sync_state` check, the missing `pollInsights` rollout
step, the double-consumed team-stats pair and B-11's advancing rivalry — are folded in place and mapped
at the bottom):

1. **Two schema references in v4 were false, and one of them stopped the reconciliation query
   compiling.** `result_revisions` has **`observed_at`**, not `created_at`
   (the `result_revisions` table in `20260727000001_competitions_gameweeks.sql`), and **`fixture_moves` records gameweek-membership
   moves, not kickoff changes** (the `fixture_moves` table in the same file — its columns are `old_membership_id` /
   `new_membership_id`), so an in-place reschedule writes no row there and nothing invalidated the model
   chips. Both are corrected against the migration (§4.7, §13 step 7) **[V5]** **[V7]**.
2. **Kickoff comparison must use `IS DISTINCT FROM`.** `kickoff_at <> source_kickoff_at` returns null
   when either side is null, so a postponement that clears the kickoff — the exact case reconciliation
   exists for — was invisible. The same rework makes the revision comparison use the **greatest**
   score-sensitive stamp rather than `key_events_fetched_at` alone, and sets `source_kickoff_at` on
   **every** accepted cache write instead of only at freeze (§4.7, §1.3) **[V5]**.
3. **The row builder returns `LeagueRowView | null`.** CL0 produces no row (PR4), which contradicted a
   66-cell proof demanding 66 arms. The proof now asserts **six CL0 nulls and 60 rendered cells**. CL1 +
   VP4 (`locked_in`) also loses its CTA — Phase 3 PR6 permits CTAs only for VP1–VP3 — so `open-entered`
   splits into a VP2 arm with a CTA and a VP4 arm without one: **fourteen arms** (§6.3a) **[V4]**.
4. **The app resolver is fed lifecycle classifications, not asked to invent them.** v4's input had no
   fixtures, so it could not call `resolveContestLifecycle(contest, gw, fixtures, results, now)` at all,
   and a past-deadline contest over a **true blank** gameweek read as `currentGw` instead of CL0. The
   loader now precomputes CL per contest with Phase 3's own function and passes it in; gameweek deadlines
   are nullable; and an already-locked in-scope gameweek is excluded from `nextOpenGw`, so R-8's GW3
   cannot be both `currentGw` and `nextOpenGw` (§6.1) **[V3]**.

Carried from round 2, still true: Phase 4 owns its **own app-level resolver** (v3's import target does
not exist and was league-scoped); the entry-sheet chips are **wired here explicitly**; and launch-enabled
pollers need an explicit **arming operation** to leave `infinity`.

DRAFT for the orchestrator to edit and own. Not signed off by Ananth.
Author: Fable 5 planning agent. Format follows `docs/plans/2026-07-27-005-phase2-engine-plan.md`.

Sources folded in: `docs/plans/2026-07-26-003-matches-analytics-spec.md` (product spec),
`docs/plans/2026-07-27-002-data-content-plan.md` (source map + cadence),
`docs/research/2026-07-27-datasource-report-sol.md` (live-verified endpoints),
`docs/plans/2026-07-27-001-design-review-round-1.md`, mockups `docs/design/cleansheet2/06-match-detail.html`
and `08-matches-tab.html`, existing `lib/espn-insights.ts` + `lib/odds-model.ts` + `fixture_insights`,
Phase 1 as-built (`supabase/migrations/20260727000001_competitions_gameweeks.sql`), Phase 2 §0.6,
Phase 3 §0.

**What Phase 4 is.** Everything the player looks at that is not their own league race: the app-level
Matches tab (Fixtures & results | Table), the Analytics tab (all 7 modules), the per-fixture match
detail page in its three states, and the data pipeline that feeds all of it and lights up the Phase 3
entry-sheet model chips for the Premier League.

**What Phase 4 is not.** It writes no money and no picks. It changes no file in the settlement path.
It adds no mutation route. Everything it writes is on the allowlist in §0.1.

---

## §0 Invariants that bind all of Phase 4

### 0.1 X-1 — the write allowlist (replaces v1's "cache-only" prose) **[R2]**

v1 said "Phase 4 writes only derived cache tables" and then wrote `sync_state` and `sync_issues`. The
invariant is now an enumerated allowlist, and it is the whole of what Phase 4 may write:

| Allowed write target | Kind |
|---|---|
| `fixture_insights` | product cache (existing) |
| `competition_standings` | product cache |
| `fixture_match_data` | product cache |
| `fixture_provider_data` | product cache |
| `fixture_provider_ids` | product cache |
| `provider_samples` | operational |
| `sync_issues` | operational |
| `sync_state` — **Phase 4's own nine keys only**, never another poller's row | operational, row-scoped |

Nothing else. The **protected set is derived, not handwritten** (round-2 finding 1), and it excludes
`sync_state` explicitly (round-3 finding 1):

```
FULLY_ALLOWED   = the seven fully-allowed tables above
protectedTables = allBaseTables(cashford) − FULLY_ALLOWED − { 'sync_state' }
```

`allBaseTables` comes from `information_schema.tables` at check time, so a table added by a later
migration is protected the day it exists. A handwritten list rots — v2's omitted `league_competitions`
and Phase 2's `gameweek_audit_log` (both declared in `20260727000002_gameweek_entries.sql`) prove it.

**Why `sync_state` is subtracted rather than protected wholesale.** v3 defined the protected set as
"everything minus the seven", which necessarily *included* `sync_state` — and then every normal lease
claim and release would change a protected table's checksum and fail E3. The harness would have failed on
correct behaviour. So `sync_state` is checked **row-wise instead**: E3 snapshots and asserts only the rows
whose key is **not** in `PHASE4_SYNC_KEYS`. Phase 4's own nine rows are expected to move; nobody else's
may. **The same subtraction is written into P-20 explicitly (round-4 finding 1) [V1]** — v4 stated the
derivation here and then let P-20 describe a whole-table check, so the test as written would have failed
on every valid poller run and no later row-scoped assertion could undo it.

Phase 4's nine `sync_state` keys, and the whole of what it may touch there: `espn_insights`,
`espn_match_data`, `espn_commentary`, `espn_standings`, `derived_standings`, `espn_reconcile`,
`team_news` (§4.9), `understat_xg`, `fotmob_slow`. **`espn_insights` is new in v4**: `pollInsights` is a
Phase 4-driven summary consumer sharing the §2.2 fetcher, so it needs its own lease key like every other
poller rather than running unleased inside another poller's claim (round-3 finding 1.6). The constant
`PHASE4_SYNC_KEYS` in `lib/poll-keys.ts` is the single source of truth; the runtime helpers, the arming
routine and the scanner all read it, so the list cannot drift between the code and its proof.

**All `sync_state` writes go through four helpers** in `lib/poll-lease.ts`, each rejecting a key outside
`PHASE4_SYNC_KEYS` before issuing any RPC:

| Helper | Wraps | Notes |
|---|---|---|
| `claimPhase4Lease(key)` | **`claim_phase4_lease` (§1.7c) [Z5]** | Gated on `next_due_at <= now()` and a free lease, **classified and claimed under one row lock**. **Returns a reason-bearing result** — `outcome` is `'claimed'` (with a token), `'not_due'` or `'leased'`, per §4.6 (round-8 finding 1) **[Z1]**. v9 got this by reading the row back after Phase 1's `claim_sync_lease` returned null, which races (round-9 finding 1); the routine now classifies under `for update` and the helper does no comparison of its own **[Z5]**. |
| `renewPhase4Lease(key, token)` | `renew_sync_lease` | **New in v4.** §4.6 requires a renew path on long runs and v3 shipped no helper for it, so the contract was unsatisfiable |
| `releasePhase4Lease(key, token, …)` | `release_sync_lease` / `release_sync_lease_jittered` | Token-conditioned |
| `armPhase4Key(key, dueAt)` | `arm_sync_key` (§1.7a) | The only way to move a row off `infinity` |

No Phase 4 file calls the lease RPCs directly. This is what makes "Phase 4 cannot disable `fpl-sync`" a
checkable claim rather than a promise — v2's table-wide allowlist permitted exactly that bug.

Phase 4 introduces **no user-scoped write of any kind** and therefore no new mutation route. (The
"opened once" acknowledgement for the Analytics lead card is client-side — §6.6 and D8.)

**Four-part enforcement.** v1's four-file hash check proved almost nothing (finding 1): it read no
migration targets, no RPCs, no existing files such as the cron route, and no runtime writes; and "no
new grant" is vacuous because the service role already has broad rights.

- **E1 static scan.** `scripts/phase4-write-scan.mjs` parses every file Phase 4 changes **plus
  `app/api/cron/tick/route.ts`**, and fails on:
  - any `.from("<table>").insert|update|upsert|delete` whose table is not fully allowed;
  - **any `.from(…)` or `.rpc(…)` whose argument is not a string literal** — a computed or
    variable table name defeats the whole scan, so it is a hard failure rather than a gap
    (round-2 finding 1);
  - any `.rpc("<name>")` outside the approved set (**`claim_phase4_lease` [Z5]**, `renew_sync_lease`,
    `release_sync_lease`, `release_sync_lease_jittered`, `arm_sync_key`) **called anywhere but
    `lib/poll-lease.ts`** — every other file must go through the key-constrained helpers. Phase 1's
    `claim_sync_lease` leaves the set: no Phase 4 file calls it any more (§1.7c), so a Phase 4 call to it
    is now itself a scan failure;
  - any `.from("sync_state")` write at all, since those must go through the helpers too.

  Runs in CI and as tests P-19a…P-19d (one planted violation per bullet).
- **E2 migration-target inspection.** The same script parses `20260728000001_match_data_v2.sql` and
  fails on any `insert|update|delete|alter table|drop|truncate` whose target is off the allowlist —
  the only exceptions being the enumerated `alter table cashford.fixture_insights add column …`
  statements and the `sync_state` seed inserts. This catches a stray DDL on a money table that no
  TypeScript scan would see.

  **Two holes v3 left, both closed (round-3 finding 1.2).** First, E2 allowed only seed *inserts* into
  `sync_state`, while the same migration defines routines whose bodies contain `update
  cashford.sync_state` — so the scanner would either reject its own migration or, if it skipped routine
  bodies, leave a hole big enough to hide any `sync_state` write. Resolution: E2 **parses routine bodies
  too**, and permits a `sync_state` write inside one **only** when the enclosing routine is one of the
  **three named approved routines** — `release_sync_lease_jittered`, `arm_sync_key` and
  **`claim_phase4_lease` (§1.7c, round-9 finding 1) [Z5]**, and no others (round-4 finding 1: v4 called
  this a "three-name list" while naming two, so the scanner's own cardinality was ambiguous — the count is
  now genuinely three and the names are enumerated here) **[V1]** — *and* the body matches the exact text
  in this plan, compared after whitespace normalization. A fourth routine, or an edit to an approved one,
  fails the scan and has to come back through review. Second, **the scanner compares the `sync_state` keys the migration names against
  `PHASE4_SYNC_KEYS` imported from `lib/poll-keys.ts`**, in both directions, so a key added to the
  migration without the constant, or to the constant without the migration, is a scan failure rather than
  drift.

  **Two places name keys, and only those two are scanned for literals (round-5 finding 1) [W1].** v5 banned
  every non-literal key expression everywhere in the migration — which rejected both approved routines,
  since `release_sync_lease_jittered` and `arm_sync_key` each write `where key = p_key` (§1.7b:591,
  §1.7a:525). A scanner that cannot pass the migration it was written for is not a gate, it is a
  build break. So the literal requirement applies to **key-naming sites only**:
  1. **The seed inserts** — every seeded key must be a string literal and a member of `PHASE4_SYNC_KEYS`.
  2. **`arm_sync_key`'s hard-coded `p_key not in (…)` allowlist** — the nine literals in that list must
     equal `PHASE4_SYNC_KEYS` exactly, as a set. This is the check that matters most: the allowlist is
     what stops a buggy caller arming `fpl-sync`, and it is written out longhand in SQL, so it is
     exactly the kind of list that drifts from the TypeScript constant.
  3. **`claim_phase4_lease`'s identical allowlist (§1.7c) [Z5]** — same nine literals, same set
     comparison, same reason. Two longhand copies of one list is two chances to drift, so both are
     compared against `PHASE4_SYNC_KEYS` and against **each other**; a key present in one routine's list
     and absent from the other fails the scan.

  Everywhere else, a `sync_state` write is judged by **which routine encloses it**, not by how it spells
  its key. `where key = p_key` inside an approved routine whose body matches this plan is **permitted and
  expected**; the parameter is bound by the caller, which is `lib/poll-lease.ts`, which the E1 TypeScript
  scan already covers. A parameterised key **outside** the three approved routines still fails — on the
  enclosing-routine rule, which is the stronger check anyway.
  Planted cases: P-19e an `insert into cashford.sync_state` seeding `'fpl-sync'`; P-19f an
  `update cashford.sync_state … where key = 'fpl-sync'` inside a routine body; **P-19g** an approved
  routine reproduced verbatim, which must **pass** (v5's rule failed it); **P-19h** `arm_sync_key` with one
  key dropped from its `not in` list, which must fail the set comparison.
- **E3 quiescent before/after diff.** `scripts/phase4-quiescent-check.mjs` enumerates `protectedTables`
  **from `information_schema.tables` at run time** (all of `cashford` minus the seven fully-allowed
  tables **minus `sync_state`**), snapshots each one's row count and a content checksum, and separately
  snapshots **only the `sync_state` rows whose key is not in `PHASE4_SYNC_KEYS`**. It then runs all
  Phase 4 pollers alone against a quiescent scratch data set and re-snapshots. Any difference fails.
  Phase 4's own nine `sync_state` rows are deliberately outside the comparison, because a poller that
  claims and releases its lease *must* change them — v3's set included `sync_state` wholesale and would
  have failed on correct behaviour. Runs in disposable Postgres **[R5]**.
- **E4 golden-file hashes.** `lib/settlement.ts`, `lib/settle-contest.ts`, `lib/gameweek-points.ts`,
  `lib/gameweek-settle.ts` byte-identical to their pre-Phase-4 hashes. **[R1]** — v1's D4 export
  refactor is withdrawn, so this is unconditional.

**The locking claim, reworded exactly as Sol requires.** Phase 4 takes **no explicit money-path locks
and creates no lock cycle**. It does not claim to take no locks at all: inserting a cache row with a
`fixtures(id)` foreign key takes a `KEY SHARE` lock on the parent fixture row, which is real. That
lock is compatible with everything `apply_score_update` does short of changing `fixtures.id` (which
never happens), and because Phase 4 always acquires in one order — parent fixture row, then its own
cache row — and never holds one while acquiring a money-path lock, no cycle with the Phase 2 §0.6
ordering is possible. Proved by P-22: `apply_score_update` and a `pollMatchData` upsert on the same
fixture, both interleavings, no deadlock, correct results.

**If a later reviewer wants Phase 4 to write a money-path row, that reverses this invariant and the
§0.6 lock ordering must be adopted first.**

### 0.2 The other invariants

- **X-2 — absent beats empty, enforced by constructors.** A module whose data is missing does not
  render: no skeleton, no zero, no "data unavailable" row. Optional TypeScript properties are not
  enough — `[]` satisfies `shots?: ShotMapEntry[]` (finding 7). So every provider-fed block is built
  by a constructor in `lib/match-blocks.ts` that **returns `undefined` for a semantically empty
  block** (empty array, all-null scalars, zero-length series). A view therefore cannot carry an empty
  block, and U-18 asserts it recursively: no key present in a `MatchDetailView` holds a semantically
  empty value. Verbatim from mockup 06: *"If a poll returns nothing or the shape changes, the module
  does not render."*
- **X-3 — every rendered module names its source and the age of its data**, from a per-block stamp
  (§1.3). A block with no stamp cannot render (follows from X-2).
- **X-4 — provisional numbers are labelled once, and points are never averaged across leagues.** One
  provisional footer per card, not one per row. **Every league row always carries its own points**;
  only the card's `headerPoints` goes null when rows differ. **[R1]**
- **X-5 — friend data comes through the session client so RLS gates it.** Entrant picks, names and
  results are read with the request-scoped client only. Service-role reads are enumerated in §6.8. The
  Phase 2 pick-reveal rule — mine **OR** that league's **`gameweek_contests.deadline_at`** has passed — is
  the only gate on scorelines; Phase 4 adds no second copy of it in TypeScript. **The deadline in that rule
  is the contest's, not the gameweek's (round-7 should-fix 1) [Y7].** v7 said "the GW deadline" here and in
  §8, which reads as `gameweeks.deadline_at` and would reveal one league's picks on another league's clock:
  with league A locked at 20:00 and league B at 22:00, a viewer switching to B at 21:00 must still see
  placeholders for B. RLS enforces the scoped column, so the guarantee is structural — but the prose now
  names it so no component re-derives the loose version.
- **X-6 — one xG provider per view, chosen at read time.** Storage separation is necessary but not
  sufficient: a composite key does not stop a query summing two rows (finding 11). So (a) the schema
  requires home and away xG **both null or both present** and constrains the `(provider, xg_model)`
  pair to a known set, and (b) **all reads go through one pure selector**,
  `selectXg(rows) → { home, away, provider, model, … } | undefined`, which returns exactly one tagged
  row and is the only function in the codebase that touches more than one provider's xG. No caller
  sums, averages, or back-fills across providers.

  **The staleness rule `selectXg` implements**, which v2 named in a test but never defined (round-2
  finding 11), so the test could not be written deterministically:

  ```ts
  selectXg(rows, now) → { home, away, provider, model, fetchedAt, age } | undefined
  ```
  1. Discard any row whose `xg_ok` is false, whose xG pair is absent, or whose `xg_fetched_at` is null.
  2. Discard any row that is **stale**: `xg_fetched_at` older than the fixture's kickoff. xG describes
     one match, so a row fetched before that match started cannot be about it — this is a correctness
     rule, not a freshness preference, and it is what catches a row left over from a postponed-then-
     rescheduled fixture.
  3. Of what survives, prefer `fotmob`; fall back to `understat`.
  4. If nothing survives, return `undefined` and the module does not render (X-2).

  So "stale FotMob" has a decidable meaning and an expected outcome: a FotMob row stamped before
  kickoff loses to a valid Understat row, even though FotMob wins on precedence. Tests X-6a…X-6e cover
  both providers valid, a partial row, stale FotMob with valid Understat, Understat-only fallback, and
  both stale (nothing renders).
- **X-7 — FotMob rails.** FotMob's terms forbid automated, systematic or regular use, and its
  robots.txt disallows `/api/*`. Therefore: we never mint or forge the `x-mas` signature header and
  never run a browser to obtain one; we call at most the two endpoints in §2.4, at a jittered interval
  that is never fixed; we parse only through the exact-typed whitelist, which cannot represent a
  score, a status, an event, a commentary line or any FotMob-authored sentence; the kill switch is
  checked **before the URL is constructed**; and the adapter **ships dark** (D7). Volume target: dozens
  of requests a day.

---

## §1 Schema — migration `20260728000001_match_data_v2.sql`

Additive only. Every table is derived cache, rebuildable from the providers — but they do not all hang off
the same parent, and v5's blanket "`on delete cascade` from `fixtures`" was not true of two of them
(round-5 finding 6) **[W6]**:

- **Per-fixture caches** — `fixture_match_data`, `fixture_provider_data`, `fixture_provider_ids` — have a
  `fixture_id references cashford.fixtures(id) on delete cascade`. One row (or one row per provider) per
  fixture; deleting the fixture deletes the cache, and nothing else needs saying.
- **`competition_standings`** cascades from **`competitions`**: its key is
  `competition_id … references cashford.competitions(id) on delete cascade` (§1.2). A league table is a
  property of the competition, not of any one match, and there is no fixture column to cascade on.
  Retention is by primary key rather than by pruning — at most two rows per competition, `(competition_id,
  source)` for `'espn'` and `'derived'`, each overwritten in place. No history accumulates.
- **`provider_samples`** has **no parent key at all** (§1.6): it is keyed by `(provider, endpoint)` with a
  free-text `ref`, so a stored sample of a broken payload outlives whatever prompted the fetch, which is
  the only reason to keep it. Nothing will ever cascade it away, so its bound is its own retention rule —
  **the latest 5 samples per `(provider, endpoint)`, trimmed in the same statement that inserts** (§1.6) —
  and that is what keeps a provider looping on a bad shape from growing the table without bound. It is
  never read by a loader (§6.8).

**RLS posture, per table (finding 10, ruling [R4]).** v1's blanket "authenticated read on everything"
was wrong. Two postures, matching Phase 1's own split:

- **Rendered reference caches** — `competition_standings`, `fixture_match_data`,
  `fixture_provider_data`, `fixture_provider_ids` — copy `20260620000005_match_insights.sql`:
  `enable row level security`; one `select … to authenticated using (true)`;
  `grant all … to service_role`; `grant select … to authenticated`; then
  `revoke insert, update, delete … from anon, authenticated` (the schema's blanket grant would
  otherwise permit DML).
- **Operational tables** — `provider_samples` (and the existing `sync_state`, `sync_issues`) —
  **RLS enabled with no policies at all**, exactly as Phase 1 does for `team_provider_ids`,
  `sync_state`, `sync_issues`, `fixture_moves`, `result_revisions`
  (the RLS-posture comment block in `20260727000001_competitions_gameweeks.sql` — *"RLS enabled with NO policies → deny-all to
  anon/authenticated; service_role bypasses"*). No grant to `authenticated`. Raw provider payloads and
  monitoring records are not product data.

### 1.1 Extend `fixture_insights` — one stamp and one flag per *visible module*

v1 had one `espn_shape_ok`, which cannot express "odds broke but form is fine". v2 fixed that but only
down to a `context_ok` covering form, H2H and the table window together, and claimed a model flag it
never defined (round-2 finding 6). **The granularity rule is now explicit: validity and freshness are
stored at exactly the granularity at which modules render.** If the UI can show it alone, it can fail
alone.

The data columns keep the **last good value**; the flag decides whether it may render. Keeping the two
separate is what lets a shape change lose the module without losing the data.

| Column | Type | Why |
|---|---|---|
| `odds_fetched_at` / `odds_ok` | timestamptz / boolean not null default true | Odds tighten to 10 minutes near kickoff while context stays hourly; one stamp cannot express two ages (X-3). |
| `model_fetched_at` / `model_ok` | timestamptz / boolean not null default true | Top scores, BTTS, clean sheets and `pOver` come from `lib/odds-model.ts` over the odds. The model row can be valid while raw odds are withdrawn, and can be invalid (de-vig failure) while odds parse fine — so v2's prose about "its own flag" now has one. |
| `model_source_kickoff_at` | timestamptz | **New in v5 (round-4 finding 7) [V7].** The `fixtures.kickoff_at` the stored model was built against, written in the same statement as `model_fetched_at`. `modelUsable` (§13 step 7) requires it to **equal** the fixture's current kickoff exactly, which is how an in-place reschedule invalidates the chips. There is no other record of a kickoff change: `fixture_moves` tracks gameweek **membership**, not kickoff time. |
| `form_fetched_at` / `form_ok` | timestamptz / boolean not null default true | `lastFiveGames` is its own module. |
| `h2h_fetched_at` / `h2h_ok` | timestamptz / boolean not null default true | `headToHeadGames` is its own module. |
| `table_fetched_at` / `table_ok` | timestamptz / boolean not null default true | The 3-row standings window is its own module, and is the one most likely to be group-scoped-wrong. |
| `team_news` | jsonb | `{home:[{player,reason,status}],away:[…]}` from FPL availability (§2.7), written by the runner in §4.9. |
| `team_news_fetched_at` / `team_news_source` / `team_news_ok` | timestamptz / text / boolean | Own fetch stamp and source (`'FPL'`), rendered in the module footer. |

Backfill: `set odds_fetched_at = fetched_at, model_fetched_at = fetched_at, form_fetched_at =
fetched_at, h2h_fetched_at = fetched_at, table_fetched_at = fetched_at`. `fetched_at` stays as the
whole-row stamp so nothing existing breaks; §4.2 replaces the *guard* that reads it. No column removed,
no value edited. **`model_source_kickoff_at` is deliberately not backfilled**: it stays null on existing
rows, so `modelUsable` fails until the next refresh writes it. Chips absent for one cycle is the correct
outcome; back-dating a kickoff onto a model nobody re-checked would assert a freshness the data does not
have.

### 1.2 `competition_standings` — the real league table

```
competition_id uuid not null references cashford.competitions(id) on delete cascade
source         text not null check (source in ('espn','derived'))
rows           jsonb not null   -- [{rank,club,club_id,played,won,drawn,lost,gd,points,form:['W','D',…]}]
note           text             -- games-in-hand line; null when there is nothing to say
fetched_at     timestamptz not null
primary key (competition_id, source)
```

At most two rows per competition: ESPN's table and ours recomputed from stored results. Both kept so
the fallback can be compared against the authority when ESPN returns. The reader prefers `espn` inside
its staleness window, else `derived`, and always labels which it showed.

### 1.3 `fixture_match_data` — ESPN summary, per block

```
fixture_id      uuid primary key references cashford.fixtures(id) on delete cascade

key_events      jsonb  -- [{minute,clock,type:'goal'|'own_goal'|'pen'|'miss_pen'|'yellow'|'red'|'sub'|'var',
                       --   team:'home'|'away', player, assist, detail}]
scorers         jsonb  -- [{team,player,minutes:[12,78]}]
team_stats      jsonb  -- {shots:{h,a}, onTarget:{h,a}, corners:{h,a}, possession:{h,a}, xg:{h,a}|null, …}
player_stats    jsonb
commentary      jsonb  -- [{minute,text}]
lineups         jsonb  -- confirmed XI + formation (D1: parsed and stored, UI gated)

key_events_fetched_at   timestamptz   key_events_ok   boolean not null default true
scorers_fetched_at      timestamptz   scorers_ok      boolean not null default true
team_stats_fetched_at   timestamptz   team_stats_ok   boolean not null default true
player_stats_fetched_at timestamptz   player_stats_ok boolean not null default true
commentary_fetched_at   timestamptz   commentary_ok   boolean not null default true
lineups_fetched_at      timestamptz   lineups_ok      boolean not null default true

stale_result_reads int not null default 0   -- consecutive stale-header reads; reset on a matching write
stale_retry_at     timestamptz              -- per-fixture backoff floor; null means retry on the next tick

freeze_reason     text check (freeze_reason in ('final','postponed','abandoned'))
frozen_at         timestamptz
source_status     text        -- the provider status string that caused the freeze
source_version    int         -- monotonic; bumped on every accepted write
source_kickoff_at timestamptz -- the fixtures.kickoff_at the cached blocks describe; written on EVERY
                              -- accepted write, not only at freeze (round-4 finding 5)
result_fingerprint text       -- '<home>-<away>@<revision_count>' the score-sensitive blocks describe
```

**One flag per data column, and the names are the column names (round-3 finding 5) [T5].** v3's schema
declared a shared `events_ok` and `stats_ok` while §4.7's correction algorithm wrote `key_events_ok`,
`scorers_ok`, `team_stats_ok` and `player_stats_ok` — four names that did not exist, so the algorithm
could not compile. The grouped pair also broke §1.1's own granularity rule: the scorers strip and the
full events timeline render independently, as do the team-stat bars and the player table. Resolved in
favour of the algorithm's names, one flag and one stamp per data column, so `<column>_ok` and
`<column>_fetched_at` are mechanical from the column name and cannot drift again. **Every mention of
`events_ok` or `stats_ok` elsewhere in this plan is replaced by the four specific flags.**

**`result_fingerprint` is the fix for the correction race** (round-2 finding 6). v2 could invalidate
events and stats on a correction and then immediately refill them from an ESPN summary still carrying
the old score, re-marking them valid — the exact failure it claimed to prevent. So:

- **Score-sensitive blocks** are `key_events`, `scorers`, `team_stats`, `player_stats` and
  `commentary`. `lineups` is not (a corrected score does not change who started).
- A score-sensitive block may be marked `*_ok = true` **only when the summary header's score matches
  the current `fixtures` score**, i.e. the fingerprint computed from the payload equals the fingerprint
  computed from the fixture row (home, away, and the count of `result_revisions` rows). A summary that
  still shows the old score is a **stale read, not a shape failure**: nothing is written and the blocks
  stay invalid.
- **The stale-read state lives in the row, not in memory (round-3 finding 5) [T5].** v3 promised an issue
  after three consecutive stale reads and a 30-minute per-fixture backoff, but a cron tick is a fresh
  serverless invocation with no memory of the last one, so there was nowhere to count. Hence
  `stale_result_reads` and `stale_retry_at`:
  - On a stale read: `update … set stale_result_reads = stale_result_reads + 1, stale_retry_at = now() +
    interval '30 minutes' where fixture_id = $1` — **one statement**, so two concurrent ticks cannot both
    read 2 and both write 3.
  - The poller **skips a fixture whose `stale_retry_at > now()`**, which is the backoff, expressed as a
    row the next invocation can see.
  - On the third increment (`stale_result_reads = 3`) it opens a `sync_issues` row of kind
    `'provider_stale_result'` — once, keyed on the fixture, not one per tick.
  - **On any accepted write** (fingerprint matched) it resets both: `stale_result_reads = 0,
    stale_retry_at = null`. A single good read clears the whole condition, so a transient ESPN cache miss
    never leaves a permanent backoff behind.
- **Score-sensitive blocks are re-enabled atomically**: one statement flips all of them plus
  `result_fingerprint` together, so the page can never show corrected events beside stale stats.
- `source_version` is bumped on every accepted write and is therefore a write counter, not a result
  identity — which is why the fingerprint exists separately. v2 conflated the two.

**Partial patches only.** A poller writes a block's data column, its stamp and its flag — never the
whole row. A failed block leaves its neighbours untouched, which is what makes per-module degradation
real rather than aspirational. Tests D-1…D-4: each ESPN block disappears alone while the others stay
visible.

**`source_kickoff_at` is written on every accepted write (round-4 finding 5) [V5].** v4 described it as
"the kickoff the **frozen** data belongs to" and set it in the freeze pass, which leaves it **null for every
unfrozen row** — and §4.7's reconciliation predicate compares `fixtures.kickoff_at` against it on **all**
rows, frozen or not, since round 3 removed the freeze precondition. Against a null, `is distinct from` is
true for every fixture with a kickoff, so every unfrozen cached row would have been invalidated on every
tick: a refill loop that never converges and a match page that never renders a block. So the partial patch a
poller writes **always includes `source_kickoff_at = <the fixtures.kickoff_at it fetched against>`**,
alongside the block's data, stamp and flag. Freeze no longer owns the column; it only reads it. Test **P-13b**
asserts a single-block patch leaves `source_kickoff_at` equal to the fixture's current kickoff on an
unfrozen row, and **I-6i** (§4.7) proves successive ticks do not re-invalidate it.

**Freeze is reasoned and re-armable (finding 8).** v1's bare `frozen_at` stranded a postponed fixture
forever and could leave a corrected header above stale events. Now:

- `freeze_reason='final'` after the FT+30m pass; `'postponed'` / `'abandoned'` when the provider says
  so. `source_kickoff_at` is **not** a freeze field — it is maintained on every accepted write (above), and
  freeze only reads it.
- A new **cache-only reconciliation step**, `reconcileMatchCache` (§4.7), runs each tick, observes
  (a) a `fixtures.kickoff_at` that **`is distinct from`** `source_kickoff_at` and (b) `result_revisions` rows
  whose `observed_at` is newer than the row's `frozen_at` or, unfrozen, its latest score-sensitive stamp,
  and on either sets the affected blocks' `*_ok = false`, clears `frozen_at`
  and `freeze_reason`, and re-arms the poller. **It reads `result_revisions`; it never writes it.** No
  Phase 2 routine is modified and no Phase 2 writer is coupled to Phase 4 state.
- Tests: postpone → reschedule → play (I-5), and final → corrected result (I-6), where header, events
  and stats move together with a dated note.

### 1.4 `fixture_provider_data` — the slow, non-ESPN enrichment

```
fixture_id  uuid not null references cashford.fixtures(id) on delete cascade
provider    text not null check (provider in ('fotmob','understat'))

xg_home     numeric
xg_away     numeric
xg_model    text
xg_detail   jsonb   -- exact-typed subtree (§2.4), never an opaque blob
shots       jsonb   -- [{team,player,minute,x,y,xg,result}]
ratings     jsonb   -- [{player,team,rating,note}]
ratings_provider  text
potm        jsonb
momentum    jsonb   -- post-match only
momentum_provider text
insight_facts jsonb -- [{key, args:[number,…]}] — closed key vocabulary (§2.4), never prose
predicted_xi  jsonb

-- one stamp and one flag per visible module (round-2 finding 6): v2 gave the five slow-provider
-- modules a single `fetched_at`, so a fresh xG and a two-day-old predicted XI were indistinguishable
xg_fetched_at        timestamptz    xg_ok        boolean not null default true
shots_fetched_at     timestamptz    shots_ok     boolean not null default true
ratings_fetched_at   timestamptz    ratings_ok   boolean not null default true
momentum_fetched_at  timestamptz    momentum_ok  boolean not null default true
facts_fetched_at     timestamptz    facts_ok     boolean not null default true
predicted_xi_fetched_at timestamptz predicted_xi_ok boolean not null default true

fetched_at  timestamptz not null   -- whole-row stamp; the per-module stamps drive rendering
attempts    int not null default 0
last_error  text check (last_error in ('disabled','http','timeout','invalid_json','shape'))
last_status int      -- HTTP status when last_error='http'
tried_at    timestamptz

primary key (fixture_id, provider)

constraint chk_xg_pair check (
  (xg_home is null and xg_away is null) or
  (xg_home is not null and xg_away is not null and xg_model is not null))
constraint chk_provider_model check (
  xg_model is null or (provider, xg_model) in
    (('fotmob','fotmob-2026'), ('understat','understat-2026')))
```

`chk_xg_pair` closes v1's one-sided-xG hole; `chk_provider_model` stops an Understat number being
stored under a FotMob model label (finding 11). `last_error` is the tagged transport taxonomy from
§2.4, so disabled / 403 / shape-change are distinguishable **in the data**, not collapsed into one null.

A row with `attempts > 0` and all data columns null is valid and meaningful: it records "we tried and
there is nothing", which is what stops the retry loop. Readers treat it as absent (X-2).

### 1.5 `fixture_provider_ids` — the join key for non-ESPN providers

```
fixture_id  uuid not null references cashford.fixtures(id) on delete cascade
provider    text not null check (provider in ('fotmob','understat'))
external_id text not null
confidence  text not null check (confidence in ('exact','matched','manual'))
matched_on  jsonb  -- {date, homeNorm, awayNorm} — the evidence, for debugging a bad match
created_at  timestamptz not null default now()
primary key (fixture_id, provider)
unique (provider, external_id)
```

Mirrors Phase 1's `team_provider_ids` deliberately. `fixtures.external_id` is the ESPN event id and
needs no mapping; FotMob and Understat each need one. `unique (provider, external_id)` prevents two
Cashford fixtures both claiming one provider match (the double-gameweek / postponement mis-match).
Matching rule in §2.6; discovery sources in §2.4 and §2.5.

### 1.6 `provider_samples` — raw retention, service-only

```
id uuid primary key default gen_random_uuid()
provider text not null      endpoint text not null      ref text
status int      bytes int      body jsonb
fetched_at timestamptz not null default now()
```

Retention: the latest **5 samples per `(provider, endpoint)`**, trimmed in the same statement that
inserts. This is the missing-field monitoring the research report insists on: a >40% swing in `bytes`
against the median of the retained samples, or a parse newly returning null for a previously non-null
block, writes a `sync_issues` row with `kind='provider_shape'`. **For FotMob, `body` stores only the
whitelisted parsed subtree** (X-7) — never their full payload. RLS: no policies, no `authenticated`
grant.

### 1.7 `sync_state` seeds and the jitter routine

Insert with `next_due_at='infinity'` (Phase 1's dark-launch pattern, and the emergency off switch that
needs no deploy): `espn_insights`, `espn_match_data`, `espn_commentary`, `espn_standings`,
`derived_standings`, `espn_reconcile`, **`team_news`**, **`understat_xg`**, `fotmob_slow`.

### 1.7a `arm_sync_key` — the routine v3 needed and did not have **[T1]**

**v3's rollout could not run.** It said the script arms keys "through the §0.1 helpers", but the applied
`claim_sync_lease` requires `next_due_at <= now()` (its body in `20260727000001_competitions_gameweeks.sql`) —
and an `infinity` row can never satisfy that. The claim/release pair is therefore structurally incapable
of arming anything; a row seeded dark would have stayed dark forever (round-3 finding 1.4). Arming needs
its own routine that does not claim first:

```sql
create or replace function cashford.arm_sync_key(p_key text, p_due_at timestamptz)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok int;
begin
  if p_key is null or p_key not in (
       'espn_insights','espn_match_data','espn_commentary','espn_standings','derived_standings',
       'espn_reconcile','team_news','understat_xg','fotmob_slow') then
    raise exception 'arm_sync_key: % is not a Phase 4 key', p_key;
  end if;
  if p_due_at is null then
    raise exception 'arm_sync_key: due_at is required (use ''infinity'' to disarm)';
  end if;
  update cashford.sync_state
     set next_due_at = p_due_at
   where key = p_key
     and lease_token is null;          -- never yank a row out from under a running poller
  get diagnostics v_ok = row_count; return v_ok = 1;
end; $$;

revoke all on function cashford.arm_sync_key(text, timestamptz) from public, anon, authenticated;
grant execute on function cashford.arm_sync_key(text, timestamptz) to service_role;
```

The key list is **hard-coded in the routine body**, not passed in and not read from a table. That is the
point: even a service-role caller with a bug cannot arm, disarm or reschedule `fpl-sync` through this
routine, because the database itself refuses the key. It sets only `next_due_at`, never a lease field, and
skips a row whose lease is held so it cannot disturb a poller mid-run. Privileges follow the same Phase 1
pattern as the jitter routine (decision #28) for the same reason — a `security definer` routine left
executable by `authenticated` is a scheduling primitive handed to every logged-in user.

Tests: P-26 arming `'fpl-sync'` raises and leaves the row untouched; P-27 `authenticated` and `anon`
cannot execute it while `service_role` can; P-28 a leased row is not rescheduled; P-29 arming then
disarming a Phase 4 key round-trips.

### 1.7c `claim_phase4_lease` — one atomic claim that classifies its own failure **[Z5]**

**Why v9's helper was wrong (round-9 finding 1).** v9 got the *contract* right — a failed claim must say
whether the key was not due or already leased — and the *mechanism* wrong: it ran Phase 1's
`claim_sync_lease`, and when that returned null, read the row back to work out why. Two statements, no
lock between them, so the answer describes a later state than the failure. Concretely: the key is due and
held, the claim fails, the holder releases and advances `next_due_at` before the read — the helper reports
`not_due` for a claim that failed because it was `leased`. The reverse happens too, if a not-due key is
armed and claimed by someone else between the two statements. v9 called this advisory, which is another
way of saying the reason field can lie, and a reason field that can lie is worse than no reason field:
during a rollout `not_due` is read as "the switch is off". So the classification moves into the database,
where the lock lives:

```sql
create or replace function cashford.claim_phase4_lease(p_key text, p_lease_seconds int)
returns table (outcome text, token uuid) language plpgsql security definer set search_path = '' as $$
declare v_next timestamptz; v_lease timestamptz; v_token uuid; v_now timestamptz;
begin
  if p_key is null or p_key not in (
       'espn_insights','espn_match_data','espn_commentary','espn_standings','derived_standings',
       'espn_reconcile','team_news','understat_xg','fotmob_slow') then
    raise exception 'claim_phase4_lease: % is not a Phase 4 key', p_key;
  end if;
  if p_lease_seconds is null or p_lease_seconds <= 0 then
    raise exception 'claim_phase4_lease: lease_seconds must be positive';
  end if;

  select s.next_due_at, s.lease_until into v_next, v_lease
    from cashford.sync_state s
   where s.key = p_key
     for update;                        -- classification and claim are one transaction
  if not found then
    raise exception 'claim_phase4_lease: no sync_state row for %', p_key;
  end if;

  v_now := clock_timestamp();            -- AFTER the lock: now() is transaction-stable and
                                         -- would still mean "before I started waiting" [Z8]

  if v_next > v_now then                          -- includes 'infinity', i.e. dark
    return query select 'not_due'::text, null::uuid; return;
  end if;
  if v_lease is not null and v_lease >= v_now then
    return query select 'leased'::text, null::uuid; return;
  end if;

  v_token := gen_random_uuid();
  update cashford.sync_state
     set lease_until = v_now + make_interval(secs => p_lease_seconds),
         lease_token = v_token,
         last_run_at = v_now
   where key = p_key;
  return query select 'claimed'::text, v_token;
end; $$;

revoke all on function cashford.claim_phase4_lease(text, int) from public, anon, authenticated;
grant execute on function cashford.claim_phase4_lease(text, int) to service_role;
```

Four things about it, each load-bearing:

1. **`for update` plus `clock_timestamp()` is the whole fix.** The row is locked before it is read, so no
   interleaving can occur between classifying and claiming. A second claimer arriving mid-transaction
   blocks, then reads the winner's `lease_until` and returns `leased`. **The clock is read after the lock,
   and that detail is load-bearing (round-10 finding 2) [Z8]:** `now()` is transaction-stable, so a caller
   that waited two seconds behind another transaction would still be comparing against its own start time
   and would call a lease that expired one second ago `leased`. v10 claimed the outcome was "true at the
   moment it is returned" while using `now()`, which was false. `clock_timestamp()` captured once after
   `for update` is used for **both comparisons and both written timestamps**, so the classification and
   the lease it grants share one instant, and that instant is after the wait. There is no read-back and
   nothing advisory left in the contract.
2. **`not_due` is tested before `leased`,** so a dark key reports `not_due` whatever else is true of the
   row. That is the answer a rollout operator needs: the switch being off dominates.
3. **Phase 1's `claim_sync_lease` is untouched.** This is a new Phase-4-only routine over the same five
   columns, restricted by the same hard-coded nine-key allowlist as `arm_sync_key` (§1.7a), so it cannot
   claim `fpl-sync` even from service-role code with a bug. Phase 1's pollers keep using theirs; nothing
   about their behaviour changes. `renew_sync_lease` and the release pair are also unchanged — only the
   claim needed atomic classification.
4. **Privileges follow the Phase 1 pattern** (decision #28), same as the jitter and arming routines:
   `security definer`, `search_path` pinned to `''` so every reference is schema-qualified, EXECUTE
   revoked from `public`, `anon` and `authenticated`, granted to `service_role` only. A `security definer`
   routine that any logged-in user can execute is a lease primitive handed to the internet.

`claimPhase4Lease(key)` (§0.1) is now a thin wrapper: it rejects a key outside `PHASE4_SYNC_KEYS`, calls
this routine, and maps the `(outcome, token)` row to the three-way result. It contains no comparison and no
second query. **E2's approved-routine list grows from two names to three** (§0.1) — this routine's body is
compared verbatim against the text above, so an edit to it has to come back through review.

Tests (persistence, disposable Postgres): **P-30** a due unleased key returns `claimed` with a token and
sets `lease_until`/`lease_token`/`last_run_at`; **P-31** a key at `'infinity'` returns `not_due` and leaves
the row byte-identical; **P-32** a due key holding a live `lease_until` returns `leased` and leaves the row
byte-identical; **P-33 concurrency** — two sessions claim the same due key at once and exactly one gets
`claimed` while the other gets `leased`, never two `claimed` and never a `not_due`;

**P-34 lock ordering, one assertion per order (round-10 finding 3) [Z8].** v10 asserted a single outcome
for each interleaving, which forbids orders that are correct: the routine serialises on the row, so *which*
transaction takes the lock first decides the answer, and both answers are right. P-34 therefore uses
**barriers to force each order explicitly** and asserts the outcome that order entails:

| Order | Expected |
|---|---|
| claim first, arm second (key starts dark) | `not_due` — the claim saw `'infinity'`; the arming lands after |
| arm first, claim second | `claimed` |
| claim first, release second (key due and held) | `leased` — the holder still had it when the claim classified |
| release first, claim second (release advances `next_due_at`) | `not_due` |
| claim against a due key whose `lease_until` has expired | `claimed` |
| two claims racing, no other actor | exactly one `claimed`, the other `leased` |

The last row is P-33's assertion restated as an ordering case. What must never happen in **any** order is
two `claimed`, or a token issued to a session that did not win the lock. **P-34b** covers the
`clock_timestamp()` case directly: session A holds a lease expiring in one second, session B claims and is
made to wait two seconds for the lock, and B must return `claimed` — with `now()` it would return
`leased`;
**P-35** `claim_phase4_lease('fpl-sync', …)` raises and writes nothing; **P-36** `PUBLIC`, `anon` and
`authenticated` all have no EXECUTE while `service_role` does, read from
`information_schema.routine_privileges` — **`PUBLIC` is asserted explicitly (round-10 should-fix 1)
[Z8]**, because a `security definer` routine's default grant is to `PUBLIC` and revoking only the two named
roles would leave it executable by everyone through that default.

### 1.7b `scripts/phase4-rollout.mjs` — the launch operation **[S3]**

**Seeding everything dark is only safe if something arms it** — v2 seeded at infinity and never said what
flipped it, so Understat and team news would have shipped inert (round-2 finding 4).

- Service-role script under `scripts/`, run by hand at Phase 4 launch, documented in the deployment log
  next to the migration checksum. Not a route, not a cron step, not automatic.
- Arms through `armPhase4Key` → `arm_sync_key` (§1.7a). It never touches `sync_state` directly and cannot
  name a non-Phase-4 key even by accident, because the routine rejects it.
- **`--key <name>`** arms exactly one key, which is what makes §13's "one poller at a time, observed for
  a full cycle" an executable instruction rather than a wish. With no `--key`, it arms every
  **launch-enabled** key — the eight above except `fotmob_slow` — and **asserts `fotmob_slow` is still
  `infinity`** afterwards, so a mistake here cannot silently turn FotMob on (X-7, D7).
- `--dry-run` prints the intended transitions and writes nothing; `--revert` (with or without `--key`)
  returns keys to `infinity`, the panic switch that needs no deploy.
- **A key is only a switch for a caller that goes through the lease (round-6 finding 2) [X2].**
  `espn_insights` is the live example: today's `pollInsights` is called straight from
  `app/api/cron/tick/route.ts` and never reads `sync_state`, so until the lease-gated rewrite deploys,
  both arming and `--revert` are no-ops against it. §13 step 4 therefore arms each key **only after** its
  caller ships behind `claimPhase4Lease`, and rollout assertion **RO-1** proves that on the deployed
  build before the arming is allowed.
- **There is no "staging-only" safety story here, and v3's claim of one is removed (round-3 finding 1.7).**
  Staging and production share **one database** — repo `CLAUDE.md`: *"There is one shared DB (no separate
  staging DB)"*. Arming a key arms it for whatever code is currently deployed against that database,
  including prod's. Safety comes from three real properties instead: the routine's hard-coded key list,
  `--key` one-at-a-time arming, and `--revert` as an instant rollback that needs no deploy. Where this
  plan previously said "staging only" as a mitigation, it now says nothing, because it was never true.
- Tested by P-23: after `--dry-run` nothing changed; after a real run every launch-enabled key is due and
  `fotmob_slow` is still `infinity`; after `--revert` all are `infinity` again; `--key understat_xg` arms
  that key and **no other**.

### 1.7d The jitter routine (renumbered in v11 — the claim routine took §1.7c) **[Z8]**

Phase 1's `release_sync_lease(key, token, next_due timestamptz)` takes the next-due time as a
parameter, so a TypeScript caller would draw the jitter client-side. Add one routine so the draw
happens **in SQL**:

```sql
create or replace function cashford.release_sync_lease_jittered(
  p_key text, p_token uuid, p_min_secs int, p_max_secs int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_ok int;
begin
  if p_min_secs is null or p_max_secs is null or p_min_secs <= 0 or p_min_secs >= p_max_secs then
    raise exception 'release_sync_lease_jittered: require 0 < min_secs < max_secs (got %, %)',
      p_min_secs, p_max_secs;
  end if;
  update cashford.sync_state
     set last_run_at = now(),
         next_due_at = now() + make_interval(
           secs => p_min_secs + floor(random() * (p_max_secs - p_min_secs))::int),
         lease_until = null, lease_token = null
   where key = p_key and lease_token = p_token;
  get diagnostics v_ok = row_count; return v_ok = 1;
end; $$;

revoke all on function cashford.release_sync_lease_jittered(text, uuid, int, int)
  from public, anon, authenticated;
grant execute on function cashford.release_sync_lease_jittered(text, uuid, int, int)
  to service_role;
```

Token-conditioned like the original. Drawing in SQL at release means a redeploy or a crashed run cannot
collapse the schedule onto a fixed grid.

**The revoke is not optional and v2 omitted it** (round-2 finding 7) **[S4]**. Phase 1's migration says
so in as many words in its function-privileges header comment: *"the schema's DEFAULT
PRIVILEGES grant everything to anon/authenticated, and Postgres grants EXECUTE to PUBLIC on new
functions — so every routine here needs an explicit revoke"*, and then revokes each of its seven
routines before granting `service_role`. A `security definer` routine left executable by
`authenticated` would let any logged-in user reschedule any poller — including `fpl-sync`, whose key
this routine does not restrict. The bounds check exists for the same reason: `(0, 0)` would set
`next_due_at = now()` forever (a hot loop) and reversed bounds would make `random()` negative, pulling
`next_due_at` into the past. Tests P-24 (privileges: `authenticated` and `anon` cannot execute;
`service_role` can) and P-25 (each of null, zero, negative and reversed bounds raises).

### 1.8 Migration safety

One shared DB. Every statement is `create table if not exists` / `add column if not exists` /
`insert … on conflict do nothing` / `create or replace function`. No destructive statement. E2 (§0.1)
scans this file's own DML/DDL targets. Checksum the file and record it in the deployment log, per
Phase 1 §7.2 — and assume the same **human gate on prod DDL** (decisions-log #16).

---

## §2 Adapters — one file per source, exact types, no I/O in the parse layer

The contract to mirror is `lib/fpl.ts`: exported `map*`/`parse*` functions taking `unknown` and
returning a typed object or `null`; a whole-payload validator that rejects rather than persist a
half-parse; one `fetch*` function as the only thing that touches the network. No adapter throws.

### 2.1 `lib/espn-summary.ts`

Endpoint (verified): `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event=<id>`.

Exports `validateSummary(summary, expectedEventId)`, `parseKeyEvents`, `parseScorers`,
`parseTeamStats`, `parsePlayerStats`, `parseCommentary`, `parseLineups`,
`buildMatchDataPatch(fixtureId, summary, blocks)`.

- **`validateSummary` takes the requested event id explicitly** (finding 6) and rejects a payload that
  is not an object, has no `header`, or whose `header.id` ≠ `expectedEventId` — the guard against a
  cached wrong-match response.
- `buildMatchDataPatch` returns **only the requested blocks** plus their stamps and flags, so writes
  are partial patches (§1.3).
- Odds/form/H2H parsing stays in `lib/espn-insights.ts`. Neither module fetches — see §2.2.
- **Never trust `hasOdds`; check the arrays** (restated so the new poller cannot reintroduce it).

### 2.2 `lib/espn-summary-fetch.ts` — one fetch per fixture per tick (finding 6)

v1 claimed insights and match-data would "share the fetched summary" while both owning their fetch,
which cannot both be true. A per-tick coordinator now owns the network call:

```ts
export function createSummaryFetcher(opts: { signal?: AbortSignal }): {
  get(fx: { id: string; external_id: number; espn_slug: string | null }): Promise<unknown | null>;
  stats(): { requests: number; hits: number };
};
```

One in-memory memo per tick keyed by `external_id`. **Every ESPN-summary consumer without exception
takes the fetcher as an argument**: `pollInsights`, `pollMatchData` (events, stats and the lineup pass)
and **`pollCommentary`**. v2 omitted commentary from both this list and the cron sharing statement,
which made the one-request acceptance criterion false at FT+10 where commentary and the FT stats pass
both come due (round-2 finding 5). The signature enforces it — the pollers have no other way to reach a
summary, because none of them imports `fetch` or `fetchSummary` directly.

`refreshInsights`'s on-page cold fill keeps its own single call (a different request, unchanged
behaviour for the WC path).

Test C-2 places commentary, events and stats **all due on the same fixture in the same tick** and
asserts exactly one network request; C-2b asserts the same across a 10-fixture gameweek (10 requests,
not 30).

### 2.3 `lib/espn-standings.ts`

Endpoint (verified): `https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings`. **Only this
route** — `/apis/site/v2/.../standings` returns `{}`, and a parser pointed at it would silently produce
an empty table forever (A-9 asserts that string does not appear in the module).

Hard rule **P-1**: the league table is never taken from a match summary's embedded table. A summary
carries the *current* season's table even on an old match, so using it would show today's table on an
archived fixture. `espn-insights.parseStandings` keeps its job for the 3-row *window* only; the Table
view reads `competition_standings` exclusively.

### 2.4 `lib/fotmob.ts` — exact-typed whitelist, tagged transport (finding 5)

Two endpoints, and only these: `https://www.fotmob.com/api/data/matchDetails?matchId=<id>`
(enrichment) and `https://www.fotmob.com/api/data/matches?date=YYYYMMDD` (id discovery). The old
`/api/*` base is dead.

v1's `xg.detail?: unknown` could retain any subtree, and `insightFactKeys?: string[]` could not carry
the numbers needed for safe restatement. Both replaced with exact types, and **the discovery endpoint
gets its own narrower parser** because its raw payload contains scores and statuses:

```ts
// enrichment — every field a scalar or an array of scalars-in-a-record. No `unknown`, no passthrough.
export interface FotMobXg { home: number; away: number; model: 'fotmob-2026';
  firstHalf?: { home: number; away: number }; secondHalf?: { home: number; away: number };
  openPlay?: { home: number; away: number }; setPlay?: { home: number; away: number };
  xgot?: { home: number; away: number } }
export interface FotMobShot { team: 'home'|'away'; player: string; minute: number;
  x: number; y: number; xg: number; result: 'goal'|'saved'|'blocked'|'off_target'|'post' }
export interface FotMobRating { player: string; team: 'home'|'away'; rating: number; goals?: number }
export interface FotMobMomentumPoint { minute: number; value: number }
// facts — a CLOSED key vocabulary. `key: string` (v2) still admitted an authored sentence as a key,
// which is the prose leak the whitelist exists to prevent (round-2 finding 8).
export type FotMobFactKey =
  | 'shots_on_target' | 'possession_pct' | 'big_chances' | 'corners'
  | 'saves' | 'fouls' | 'offsides' | 'passes_completed_pct';
export interface FotMobFact { key: FotMobFactKey; args: number[] }
export interface FotMobXi { formation: string; rows: Array<{ label: string; players: string[] }> }

export interface FotMobFields {
  xg?: FotMobXg; shots?: FotMobShot[]; ratings?: FotMobRating[]; potm?: FotMobRating;
  momentum?: FotMobMomentumPoint[]; facts?: FotMobFact[];
  predictedXi?: { home: FotMobXi; away: FotMobXi };
}
export function parseFotMob(raw: unknown, opts: { terminal: boolean }): FotMobFields | null;

// discovery — three fields, nothing else can come back
export interface FotMobCandidate { id: string; date: string; homeName: string; awayName: string }
export function parseFotMobCandidates(raw: unknown): FotMobCandidate[] | null;

// tagged transport result — 'disabled' | 'http' | 'timeout' | 'invalid_json' | 'shape' | 'ok'
export type FetchResult<T> =
  | { kind: 'ok'; value: T } | { kind: 'disabled' } | { kind: 'http'; status: number }
  | { kind: 'timeout' } | { kind: 'invalid_json' } | { kind: 'shape' };
export function fetchFotMobMatch(id: string): Promise<FetchResult<FotMobFields>>;
export function fetchFotMobCandidates(date: string): Promise<FetchResult<FotMobCandidate[]>>;
```

`facts` carries a **closed key vocabulary** plus numeric arguments. The parser drops any fact whose
`key` is not a member of `FotMobFactKey` — it does not store it, does not pass it through, and does not
fail the whole payload (an added FotMob stat should not blank the module). Rendering goes through an
**exhaustive Cashford-owned map** in `lib/fotmob-copy.ts`:

```ts
const FACT_COPY: Record<FotMobFactKey, (args: number[]) => string> = { … };
```

`Record<FotMobFactKey, …>` makes the map exhaustive at compile time, and because the type is a closed
union, a key that is not in the map cannot exist. FotMob prose is never stored or displayed (P-3).
Test **F-1c** puts a full sentence in `key` (`"Haaland has scored in five straight home games"`) with
well-formed `args` and asserts the fact is absent from the parse result and that the sentence appears
nowhere in the row written to `fixture_provider_data`. F-1d asserts an unrecognised but harmless key
(`'aerials_won'`) is dropped while the sibling facts still render.

`momentum` is parsed only when `opts.terminal`, so the post-match-only rule cannot be broken by a
mis-scheduled tick.

Guards: `FOTMOB_ENABLED` (default off) is checked **before the URL is constructed** — the function
returns `{kind:'disabled'}` with no string building and no network call. Plain `fetch`, ordinary
`User-Agent`, **no `x-mas` header**; if FotMob starts requiring the signature we get
`{kind:'http',status:403}`, the breaker opens, the modules disappear, and we stop (X-7).

Whitelist tests F-1a/F-1b run **recursively over both full raw payloads** with forbidden sentinels
injected into the score, status, event, commentary and prose fields, and assert no sentinel appears
anywhere in the parsed result at any depth. F-3 asserts the kill switch precedes URL construction.

### 2.5 `lib/understat.ts` — a real, independently runnable fallback (finding 3) **[R3]**

v1 named an `understat_xg` lease that nothing drove and gave no way to obtain an Understat match id.
Both fixed:

- **Discovery:** `GET https://understat.com/getLeagueData/EPL/<season>/` with
  `X-Requested-With: XMLHttpRequest` and a page referer (plain requests 404). The response carries all
  380 matches with date and both club names → `parseUnderstatCandidates(raw)` →
  `{ id, date, homeName, awayName }[]`, matched by §2.6 and written to `fixture_provider_ids`. Fetched
  once a week and once after any fixture reschedule.
- **Season conversion (round-2 finding 4).** `<season>` is **not** the stored season string. Phase 1
  seeds `competitions.season = '2026-27'`
  (`20260727000001_competitions_gameweeks.sql`), while Understat's path segment is the **starting year
  only**: `2026`. Passing the stored value produces `getLeagueData/EPL/2026-27/`, which 404s — a silent
  permanent xG outage at launch, since the poller would only ever log `{kind:'http',status:404}`.
  A pure exported helper owns the conversion:

  ```ts
  // lib/understat.ts
  export function understatSeason(season: string): string   // '2026-27' → '2026'
  ```

  It accepts only `YYYY-YY` where the second pair is the first pair's next year mod 100, returns the
  four-digit start year, and **throws** on anything else rather than guessing — a malformed season is a
  bug in the competition row, not a runtime condition to paper over. Tests A-10a `'2026-27' → '2026'`,
  A-10b `'2099-00' → '2099'` (century rollover), A-10c rejects `'2026'`, A-10d rejects `'2026-28'`, and
  A-10e asserts the URL built by `fetchUnderstatCandidates` for the seeded `pl-2026-27` row ends
  `/EPL/2026/`.
- **Enrichment:** `GET https://understat.com/getMatchData/<id>/` with the same headers →
  `parseUnderstatMatch` → xG + shots, `xg_model='understat-2026'`. Post-match only.
- Same tagged `FetchResult` taxonomy as FotMob.
- **Driven by its own poller, `pollUnderstat`, on the `understat_xg` lease, active independently of
  FotMob and armed at launch.** This is what makes "Understat is the xG fallback" true when FotMob is
  dark — which is the launch state.

### 2.6 `lib/provider-match.ts`

Pure: `matchFixture(fixture, candidates) → { externalId, confidence, matchedOn } | null`.

Rule: same kickoff date (competition-local) **and** both club names normalized-equal. Reuses
`lib/fpl.ts::normalizeClubName` and its `ALIASES` map — it already encodes the Cashford spelling of
every PL club and a second normalizer would drift. Date plus **one** club is **not** a match (returns
null): a wrong id poisons a cache row with another match's xG, which is worse than a hidden module.
`confidence:'manual'` exists for an operator-inserted row and is never written by code. Unmatched
fixtures are expected and fine (E-1/E-2).

### 2.7 `lib/fpl-availability.ts` — the team-news source adapter (finding 9)

v1 had a `team_news` column and a UI card with no adapter. `lib/fpl.ts` validates events, teams and
fixtures — not availability.

```ts
export interface FplAvailability { playerId: number; fplTeamId: number; name: string;
  status: 'a'|'d'|'i'|'s'|'u'|'n'; newsText: string; chanceOfPlaying: number | null }
export function parseAvailability(bootstrap: unknown): FplAvailability[] | null;
export function teamNewsForFixture(rows: FplAvailability[],
  homeFplTeamId: number, awayFplTeamId: number): TeamNews | null;
```

- Whole-payload rejection: a bootstrap whose `elements` is missing, or whose team ids do not resolve
  against Phase 1's FPL team mapping, returns null. **Null means "the fetch or parse failed", and the
  caller writes `team_news_ok = false` while leaving the `team_news` value alone** (§4.9).
- Join: `fplTeamId` → Cashford club through the Phase 1 FPL team mapping (read-only).
- **Success with nothing to say returns `null`, not an empty structure (round-3 finding 6) [T6].**
  `teamNewsForFixture` returns `TeamNews | null` where `TeamNews` is `{home, away}`; a successful pass over
  a fixture with no injuries and no doubts returns `null`. v3 wrote `'[]'::jsonb` for that case — a JSON
  **array** into a column typed as an object, so any reader doing `row.team_news.home` would have thrown.
  The two outcomes are told apart by the flag, not the value: **success-and-empty is `team_news = null`
  with `team_news_ok = true`**; **failure is `team_news_ok = false` with the previous value retained**.
  Both hide the card, but only the second one is a fault, and only the second one shows the module footer's
  stale note. Because the adapter returns `null` for both, the **runner** decides which of the two writes
  to make, from whether `parseAvailability` itself succeeded.
- Freshness: written with `team_news_fetched_at` and `team_news_source='FPL'`; **a successful pass replaces
  the value wholesale**, never merges, so a recovered player disappears instead of lingering.
- Recorded snapshot `tests/fixtures/fpl/bootstrap-availability.json`; tests cover malformed player ids,
  malformed team ids, and a fixture with no news at all (card hides, X-2).

### 2.8 Recorded fixtures

`tests/fixtures/espn-summary/{pre,live,ft}.json`, `tests/fixtures/espn-standings/table.json`,
`tests/fixtures/fotmob/matchdetails-ft.json`, `tests/fixtures/fotmob/matchdetails-shapechange.json`
(xG subtree renamed — the regression proving the parser degrades to `{kind:'shape'}` instead of
throwing), `tests/fixtures/fotmob/matches-date.json`,
`tests/fixtures/understat/{league,match}.json`, `tests/fixtures/fpl/bootstrap-availability.json`.
Captured live during implementation and committed, exactly as `tests/fixtures/fpl` was.

---

## §3 Field ownership and precedence

One column, one owner. A second source fills a field only where the table says so.

| Field | Owner | Second source | Rule |
|---|---|---|---|
| Score, status, minute | ESPN scoreboard (`lib/espn.ts`) | FPL (score/status, unmatched fixtures only) | Phase 1's provenance rule stands: FPL never overwrites an ESPN score. Phase 4 adds no writer here. |
| Key events, scorers | ESPN summary | — | Absent → the scorer line is omitted. |
| Team / player match stats | ESPN summary | — | 5 stats live, full set at FT. |
| Commentary | ESPN summary | — | Post-match only in the UI. |
| Confirmed lineups | ESPN summary | — | Parsed and stored; UI gated on D1. |
| Odds, form, H2H, table window | ESPN summary (`espn-insights.ts`) | our Poisson model for top scores | Unchanged. Never trust `hasOdds`. |
| League table | ESPN standings endpoint | `derived` row from stored results | **P-1**: never from a summary. Prefer `espn` inside its window, else `derived`, labelled as ours. |
| Match xG + shot map | FotMob | Understat | **P-2** precedence FotMob → Understat, applied only by `selectXg` (X-6). Never averaged. |
| Player ratings, PotM | FotMob | none | Module hides. `ratings_provider` stored and displayed. |
| Momentum | FotMob, post-match only | none | Never fetched live, never shown live. `momentum_provider` stored. |
| Insight facts | FotMob keys + numbers | none | **P-3** Cashford writes the sentence. No FotMob prose stored or shown. |
| Predicted XI | FotMob, opportunistic | none | Shown only when present and fresh; replaced outright by ESPN's confirmed XI ~T−75m. |
| Team news | FPL availability (§2.7) | none | Stamped and sourced; stale rows replaced wholesale. |
| Fixtures, GWs, deadlines | FPL (Phase 1) | — | Phase 4 reads only. |

---

## §4 Cadence, TTL, and the cron

### 4.1 The table

`pg_cron` fires the existing one-minute tick. Each poller has its own `sync_state` row and decides
per-fixture from a state-dependent, **injected-clock** due function (§4.2). Nothing calls everything
every minute.

| Poller | Fixture state | Cadence | Window | Notes |
|---|---|---|---|---|
| `pollInsights` (existing, extended) | open | 6h → hourly at T−24h → 10m at T−2h | stop at kickoff | Ladder reads `odds_fetched_at`; context blocks read their own stamp. |
| `pollMatchData` | pre | once at T−90m, then 5m until an XI appears, then freeze that block | T−90m → kickoff | Lineups block only (D1). |
| `pollMatchData` | live | 60s events, 120s stats | T−5m → FT+10m | Summary comes from the §2.2 fetcher. |
| `pollMatchData` | post | FT+5m, FT+30m, then `freeze_reason='final'` | — | Final events and stats. |
| `pollCommentary` | post | once, FT+10m | — | 96 entries is a big payload; no live cadence. |
| `pollStandings` | — | 10m while any fixture is live, hourly otherwise | — | One call per competition, not per fixture. |
| `deriveStandings` | — | after each settlement pass, and hourly | — | Writes the `derived` fallback row. |
| **`pollUnderstat`** | post | first pass FT+2h, retry 6h, freeze on success | until found or breaker | **Armed at launch.** Weekly league-data pass for id discovery. |
| `pollSlowProviders` (FotMob) | post | first jittered tick after FT, freeze on found | until found or breaker | xG, shots, ratings, PotM, momentum. **Dark at launch.** |
| `pollSlowProviders` (FotMob) | open | at most one tick around T−24h | — | Facts, predicted XI, opportunistic. |
| **`pollTeamNews`** | open | 30m from T−48h, 10m from T−3h, stop at kickoff | T−48h → kickoff | **Armed at launch.** Owns the `team_news` lease. §4.9. |
| `reconcileMatchCache` | any | every tick, cheap | — | §4.7. Cache-only. |

### 4.2 Due functions, not a flat TTL (finding 6)

The live guard in `refreshInsights` is a flat `INSIGHTS_TTL_MS = 3h` read off `fetched_at`
(`lib/espn-insights.ts:17,276`) — v1 both claimed a new ladder and claimed that guard was unchanged.
Resolution: a new pure module `lib/poll-due.ts` exports per-block due functions with an **injected
clock**:

```ts
export function oddsDueAt(fx: FixtureTiming, lastFetchedAt: Date | null, now: Date): boolean;
export function contextDueAt(…): boolean;   export function eventsDueAt(…): boolean;
export function statsDueAt(…): boolean;     export function commentaryDueAt(…): boolean;
export function lineupsDueAt(…): boolean;
```

`refreshInsights` keeps its `opts.ttlMs` escape hatch for the on-page cold fill (unchanged for the WC
path), but the **cron** path calls the due functions. Boundary tests C-1 at T−24h, T−2h, kickoff, FT+5,
FT+10 and FT+30, each asserted on both sides of the boundary.

### 4.3 Jitter — never a fixed interval

`fotmob_slow` releases through `release_sync_lease_jittered(key, token, 10800, 18000)` — uniform in
[3h, 5h], drawn in SQL (§1.7). Test F-4: 1000 draws all inside the band, no suspicious mode.

### 4.4 Request budgets

`MAX_FOTMOB_CALLS_PER_RUN = 12`, `MAX_UNDERSTAT_CALLS_PER_RUN = 12`. Fixtures ordered
oldest-unfilled-first so a backlog drains deterministically instead of starving. With ~10 PL fixtures a
GW and a [3h,5h] cadence, FotMob is dozens of requests a day, matching the data plan's commitment.
C-3/C-4 assert the caps with a 30-fixture backlog.

### 4.5 Circuit breaker

Per `(fixture_id, provider)`: 3 consecutive failures → `tried_at` pushed 24h out. Per provider: 5
consecutive failures across fixtures in one run → set that poller's `sync_state.next_due_at='infinity'`
and write a `sync_issues` row. **It does not re-arm itself.** A provider that has started 403ing is a
policy signal, not a transient error, and must not be retried by a robot.

### 4.6 Lease discipline

Every poller **claims through `claim_phase4_lease` (§1.7c), never Phase 1's `claim_sync_lease`
(round-10 finding 1) [Z8]** — v10 left this sentence pointing at the Phase 1 routine, which E1 now rejects
for any Phase 4 file, so an implementer following it literally would write code the scanner fails and a
caller that cannot produce the three-way outcome. **Only the claim changes hands.** `renew_sync_lease` on
long runs — **false ⇒ abort without writing** — and the token-conditioned `release_sync_lease` /
`release_sync_lease_jittered` are Phase 1's routines, used unchanged, exactly as §1.9 defines them. Each
poller owns exactly one key; no poller touches another's row.

**A failed claim reports which failure it was (round-8 finding 1) [Z1].** `claim_sync_lease` returns
null for two different reachable states — the key is not yet due, and the key is due but another holder
owns the lease — and v8 reported both as `not_due`, which is false for the second and contradicts the
`{skipped:'leased'}` case Phase 4's own contract defines **[Z7]**. `claimPhase4Lease` therefore returns a
**three-way result**:

| Result | Cause | Poller behaviour |
|---|---|---|
| `{ outcome: 'claimed'; token }` | the update took the row | run, renew, release with the token |
| `{ outcome: 'not_due' }` | `next_due_at > now()` (including `'infinity'`, i.e. dark) | return without fetching or writing |
| `{ outcome: 'leased' }` | due, but `lease_until > now()` | return without fetching or writing — the existing `{skipped:'leased'}` case |

Both non-claimed outcomes take the identical code path: **no provider request, no write, no retry inside
the tick.** The distinction exists for the operator, not the poller — during a rollout `not_due` means the
switch is off and `leased` means the switch is on and something else is already running, and confusing the
two would read a live poller as dark.

**The classification happens inside the claim, not after it (round-9 finding 1) [Z5].** v9 ran Phase 1's
`claim_sync_lease` and, on null, read the row back to decide which failure it was — two statements with no
lock between them, so the label described a later state than the failure and could be wrong in both
directions. Phase 4 therefore has its own `claim_phase4_lease` (§1.7c): one routine, `select … for update`
then classify then claim, all in one transaction, returning `(outcome, token)`. Nothing about the contract
is advisory any more, and Phase 1's routine is untouched. `claimPhase4Lease` is a thin mapper over it.

The lease outcome and the fetch/write counters travel together in the cron response (§12 RO-1). **That
response shape is what Phase 4 proposes, not what exists today (round-9 should-fix) [Z7]:** the working
tree has `syncFpl` returning `{ran: false, reason: 'not due or leased'}` (`lib/sync-fpl.ts`) and
`pollInsights` returning `{checked, updated}` with no lease call at all (`lib/espn-insights.ts`), which the
cron route passes through unchanged. `{skipped:'leased'}` is the Phase 4 shape those callers move to when
they are rewritten behind the lease — the deployed code has no lease outcome to report until then, which is
exactly what RO-1's first assertion detects.

### 4.7 `reconcileMatchCache`

Cache-only, every tick. **The scan is over every cached row, frozen or not (round-3 finding 5) [T5].**
v3 examined only rows with `frozen_at` set, which left a real hole: a correction landing between full time
and the FT+30m freeze pass finds `frozen_at` still null, so reconciliation skipped it and the old events
and stats stayed on screen — up to half an hour of a corrected header sitting above a wrong timeline, in
the window where people are actually looking. So the predicate is the mismatch itself, not the freeze:

```sql
select d.fixture_id
  from cashford.fixture_match_data d
  join cashford.fixtures f on f.id = d.fixture_id
 where f.kickoff_at is distinct from d.source_kickoff_at
    or exists (select 1 from cashford.result_revisions r
                where r.fixture_id = d.fixture_id
                  and r.observed_at > coalesce(
                        d.frozen_at,
                        greatest(d.key_events_fetched_at, d.scorers_fetched_at,
                                 d.team_stats_fetched_at, d.player_stats_fetched_at,
                                 d.commentary_fetched_at),
                        'epoch'::timestamptz))
```

**Three corrections against the applied schema (round-4 finding 5) [V5].** v4's query could not run and
would have missed two real cases:

1. **`result_revisions.observed_at`, not `created_at`.** The column is `observed_at`
   (the `result_revisions` declaration in `20260727000001_competitions_gameweeks.sql`); `created_at` does not exist on that table, so v4's
   predicate was a syntax-level failure — the plan's most concrete false schema claim.
2. **`is distinct from`, not `<>`.** A postponement that clears `fixtures.kickoff_at` makes
   `kickoff_at <> source_kickoff_at` evaluate to **null**, which `where` treats as false, so the exact
   event reconciliation exists to catch — a fixture pulled off the calendar with cached blocks still on
   screen — was silently skipped. `is distinct from` is null-safe in both directions and also catches
   null→non-null (a rescheduled fixture regaining a kickoff).
3. **The greatest score-sensitive stamp, not `key_events_fetched_at` alone.** v4 said "latest block stamp"
   in prose and wrote one stamp in SQL. Blocks are written by partial patches (§1.3), so the stamps
   genuinely differ: a fixture whose events failed but whose stats refilled has a null
   `key_events_fetched_at` and a recent `team_stats_fetched_at`, and comparing against the null one made
   `coalesce` fall through to `'epoch'` and re-invalidate on every tick — a permanent invalidation loop.
   `greatest` ignores nulls and returns null only when every stamp is null, where `coalesce` correctly
   falls through to `'epoch'`. `lineups_fetched_at` is deliberately **not** in the list: lineups are not
   score-sensitive, so a lineup refresh must not make a pending correction look already-seen.

On either condition: invalidate the affected blocks (`*_ok=false`), clear `frozen_at`/`freeze_reason`
**if set** (a no-op when they are already null), and let the normal poller refill. Reads `fixtures` and
`result_revisions`; writes only `fixture_match_data`.

**The kickoff branch also acknowledges the new value, including null (round-5 finding 3) [W3].** When the
row is invalidated because `f.kickoff_at is distinct from d.source_kickoff_at`, the same `update` sets
`source_kickoff_at = f.kickoff_at`:

```sql
update cashford.fixture_match_data d
   set source_kickoff_at = f.kickoff_at,   -- acknowledge, even when null
       …invalidation…
  from cashford.fixtures f
 where f.id = d.fixture_id and d.fixture_id = any($1)
```

v5 left this to "the normal poller refill", which works for a rescheduled fixture — it still has a kickoff,
so it comes due and `pollMatchData` writes the current value on its next accepted write (§1.3). It does
**not** work for a fixture postponed to no date at all. A null-kickoff fixture is never in a due window,
so nothing writes `source_kickoff_at = null`, so the mismatch is still true on the next tick, and
reconciliation invalidates and re-arms the same row **every tick, forever** — the same non-convergence
§1.3's every-write rule was added to prevent, arriving through the other door. Acknowledging the value in
the invalidating statement is what makes the pass idempotent: it fires **once** per kickoff change, which
is the whole point of storing the kickoff.

The acknowledgement is deliberately **not** conditional on the refill succeeding. Invalidation is already
recorded in the `*_ok` flags, which are the state that gates rendering; `source_kickoff_at` records only
*which* kickoff the cache was last reconciled against. Coupling the two would recreate the loop.

Tests **I-6h** (a postponement setting `fixtures.kickoff_at` to null is reconciled — the case `<>` missed —
**and, on a second tick with nothing else changed, is not reconciled again**, then a later reschedule from
null back to a timestamp invalidates exactly once more, proving the pass converges in both directions
(round-5 finding 3) **[W3]**) and **I-6i** (a fixture with a null `key_events_fetched_at` and a fresh
`team_stats_fetched_at` and no new revision is **not** re-invalidated on successive ticks, proving the
`greatest` fix closed the loop) **[V5]**.

**Refill is gated on the fingerprint, not just on the invalidation (round-2 finding 6).** v2's loop
could invalidate a corrected fixture's blocks on tick *n* and refill them on tick *n+1* from an ESPN
summary that still carried the old score, leaving `*_ok = true` over stale data — the exact state the
correction path exists to prevent, now silently marked valid. So:

1. On invalidation, `reconcileMatchCache` recomputes `result_fingerprint` from the **current** fixture
   score and revision count (§1.3) and writes it alongside the `*_ok=false` flags.
2. `pollMatchData` may set any **score-sensitive** flag (`key_events_ok`, `scorers_ok`,
   `team_stats_ok`, `player_stats_ok`, `commentary_ok`) to true **only when the fingerprint derived from
   the fetched summary header equals the stored `result_fingerprint`**. A mismatch is a stale read, not
   a shape failure: nothing is written, the flags stay false, and the fixture is retried next tick.
   `lineups_ok` is exempt — a lineup is not a function of the score.
3. Re-enabling is **atomic**: the flags plus values plus `result_fingerprint` plus `source_version` go
   in one `update`, so no reader can observe a half-refilled correction.
4. Counting and backing off happen **in the row** (§1.3): each stale read does one atomic
   `stale_result_reads = stale_result_reads + 1, stale_retry_at = now() + interval '30 minutes'`; the
   poller skips fixtures whose `stale_retry_at > now()`; the third increment writes one `sync_issues` row
   of kind `'provider_stale_result'`; and any accepted write resets both to `0` / `null`. ESPN lagging a
   correction by hours is normal; lagging it for a day is an operator's problem.

Tests I-6a (final → corrected → ESPN still stale: blocks stay hidden, nothing marked valid), I-6b (the
next tick's summary carries the corrected score: all blocks re-enable in one write), I-6c (three stale
reads raise `provider_stale_result` — asserted on the `sync_issues` row, and only one row after five
stale reads), **I-6d** (a correction arriving after FT but **before** the FT+30 freeze, with `frozen_at`
still null, is reconciled: the blocks go invalid on the same tick and the stale events are not rendered),
**I-6e** (`stale_result_reads` persists across three separate `reconcileMatchCache`/`pollMatchData`
invocations against the same disposable database, proving nothing is counted in memory), **I-6f**
(`stale_retry_at` in the future makes the next tick skip that fixture and leave the counter alone), and
**I-6g** (one matching write resets `stale_result_reads` to 0 and `stale_retry_at` to null).

### 4.8 Cron order — `app/api/cron/tick/route.ts` **[T2]**

**v3's order was wrong, and wrong on the money path.** It claimed to preserve the existing order while
omitting `dispatchGameweekSettlements`, the step that actually settles gameweek pots. A plan that drops a
settlement dispatch from the tick would, if implemented literally, stop every gameweek settling. The real
order, verbatim from `app/api/cron/tick/route.ts:26–42`, with Phase 4 **appended and nothing reordered**:

```
syncFpl → pollScores → resolveKnockoutBracket → lockDueContests → settleFinishedContests
  → gameweekMaintenance → dispatchGameweekSettlements → pollInsights
  → reconcileMatchCache → pollMatchData → pollCommentary → pollStandings → deriveStandings
  → pollTeamNews → pollUnderstat → pollSlowProviders
```

`dispatchGameweekSettlements` runs **immediately after** `gameweekMaintenance` and this pairing is
load-bearing: maintenance is what marks pots ready (locked, entries resolved) and what voids the
sub-two-entrant ones, so settlement has nothing to act on until it has run. The route's own comment says
as much. Phase 4 must not insert anything between them, and does not.

All Phase 4 steps run **after both settlement dispatches**: they are cosmetic, and a slow or flapping
provider must never delay or fail a settlement pass. `pollInsights` keeps its existing position ahead of
them, unchanged.

**I-1 and acceptance F compare both settlement outputs, not just one.** A tick with Phase 4 armed must
produce `settles` (legacy cup) **and** `gwSettles` (gameweek) byte-identical to a tick with Phase 4 dark.
v3 asserted this over "settlement output" without naming which — and would have passed while gameweek
settlement was missing entirely. Each is individually wrapped so a thrown error is captured into the
response body rather than aborting the handler, and each returns a small summary object for
observability. **`pollInsights`, `pollMatchData` and `pollCommentary` all share the §2.2 fetcher, created
once per tick and passed to each** — v2 named only the first two here, which is what let FT+10 make two
summary calls for one fixture (round-2 finding 5).

### 4.9 `pollTeamNews` — the runner v2 never wrote (round-2 finding 4)

v2 shipped the `lib/fpl-availability.ts` adapter (§2.7), the `team_news` column and the UI card, and
nothing that connected them: no poller, no lease claim, no cron step. The card would have been dead at
launch. The runner:

- **Lease:** owns `team_news` in `sync_state` (one of the nine Phase 4 keys, §0.1), claimed and released
  through `claimPhase4Lease` / `releasePhase4Lease` like every other poller. Own key, no sharing.
- **Cadence:** one FPL `bootstrap-static` call per *tick that is due* — availability is league-wide, not
  per-fixture, so the payload is fetched **once** and applied to every open fixture in the window. Due
  every 30 minutes while any fixture is inside T−48h, tightening to 10 minutes inside T−3h, where late
  team news actually lands. Stops at kickoff; ESPN's confirmed XI takes over from there (§3).
- **Mapping read:** `parseAvailability(bootstrap)` → group by `fplTeamId` → resolve to Cashford clubs
  through **Phase 1's FPL team mapping**, read-only. An unresolvable team id fails the whole payload
  (§2.7) rather than writing partial news attributed to the wrong club.
- **Write:** `teamNewsForFixture(rows, homeFplTeamId, awayFplTeamId)` → a **partial patch** to
  `fixture_insights` touching only `team_news`, `team_news_fetched_at`, `team_news_source`,
  `team_news_ok` (§1.1). It never writes an odds, model, form, H2H or table column, so a team-news pass
  cannot disturb the insights ladder. Rows are **replaced wholesale**, never merged.
- **No news is a valid answer, and it is stored as `null` (round-3 finding 6) [T6]:** a fixture whose two
  clubs have no flagged players gets **`team_news = null` with `team_news_ok = true`** and a fresh
  `team_news_fetched_at`. v3 wrote `'[]'::jsonb`, an array into a column the type declares as
  `{home, away}` (§2.7). The card hides on emptiness either way (X-2), but only `null` is readable.
- **Failure retains the last good value and changes only the flag:** on a fetch error, a non-JSON body or
  a `parseAvailability` null, the runner writes **`team_news_ok = false` and nothing else** — not the
  value, not the stamp. v3's §2.7 said a malformed payload "writes nothing" while the §5 table said it set
  `team_news_ok = false`; those contradict, and the first one is the bug, because without the flag change
  an injury list from two days ago keeps rendering as current. Failures use the same tagged transport and
  breaker as every other poller (§4.5).

The three states, stated once so no other section has to infer them:

| Outcome | `team_news` | `team_news_ok` | `team_news_fetched_at` | Card |
|---|---|---|---|---|
| News found | `{home, away}` | `true` | bumped | renders |
| Success, nothing to report | `null` | `true` | bumped | absent |
| Fetch or parse failed | **unchanged** | `false` | **unchanged** | absent |

Tests: C-5 cadence boundaries at T−48h, T−3h and kickoff, both sides; C-6 one bootstrap call for a
10-fixture gameweek, not ten. Integration **I-8**: seed an injured player, run a tick, assert the card
renders the injury; flip the FPL snapshot to `status:'a'` with empty `newsText`, run another tick, assert
the player is **gone from the card** and, when they were the only entry, the card itself is absent —
proving the wholesale replacement rather than a merge that would leave recovered players lingering. **I-8b**
pins the empty case at both ends: the stored value is SQL `null` (not `'[]'`), `team_news_ok` is `true`, and
the rendered page has no team-news card. **I-8c** pins the failure case: with a good value already stored,
a malformed bootstrap leaves `team_news` and `team_news_fetched_at` byte-identical, flips `team_news_ok`
to `false`, and the card disappears rather than showing two-day-old injuries.

---

## §5 Failure modes — what fails, what the user sees

| Failure | Detected by | Persistence effect | UI effect |
|---|---|---|---|
| ESPN summary 404 / non-JSON | `validateSummary` null | no write | Blocks keep last good value and stay visible; nothing new appears |
| ESPN summary wrong event id | `header.id ≠ expected` | no write | as above |
| One ESPN block vanishes | that block's parser returns null | **only that block's** `*_ok=false`; value retained | Only that module hides; neighbours unaffected (D-1…D-4) |
| ESPN standings down | `parseStandings` null | `derived` row still written | Table renders from our results, labelled "Cashford, from results" |
| Odds absent | existing `odds_available` false | no odds columns | Odds row omitted; model top scores stand alone |
| FotMob disabled (launch state) | env, pre-URL | `last_error='disabled'` | FotMob modules all hide; **Understat still supplies xG** |
| FotMob 403 | `{kind:'http',status:403}` | `last_error='http'`, `last_status=403`, breaker | FotMob modules hide; Understat xG unaffected |
| FotMob timeout / bad JSON / shape | tagged result | `last_error` records which | same, and `sync_issues` on shape |
| Understat 404 or no match | tagged result | recorded | xG hides only if FotMob is also absent |
| Fixture unmatched to a provider | no `fixture_provider_ids` row | nothing polled | Provider modules hide permanently and silently |
| Fixture unmatched to ESPN | null `external_id` | no ESPN blocks | Row still renders with FPL score/status; every ESPN block absent (I-4) |
| FPL availability malformed | `parseAvailability` null | `team_news` and its stamp untouched, `team_news_ok=false` | Team-news card hides (§4.9) |
| FPL availability fine, no flagged players | successful parse, empty result | `team_news = null`, `team_news_ok=true`, stamp bumped | Team-news card absent — not a failure (§4.9) |
| Phase 2 results absent for a settled GW | read model | — | Analytics shows its empty state, not zeroes |

No row here produces a broken page, a zero, or a skeleton.

---

## §6 Read models — pure math, thin loaders, serializable views

Follows `lib/home-matches.ts` / `lib/home-analytics.ts`: a loader that queries and a sibling pure module
that does the arithmetic, returning plain serializable objects.

### 6.1 The app-level gameweek resolver **[R2]**

v2 said Phase 4 imports `pickCurrentGameweek` from `lib/gw-view.ts`. **That function does not exist.**
Phase 3's approved plan withdrew it and shipped `resolveGameweekView` in its place (Phase 3 U3), which
is **league-scoped** and prefers an open contest over a locked-but-live one. Matches and Analytics are
**app-level** tabs spanning every league the viewer belongs to, and the product rule is the opposite:
the locked-but-unsettled gameweek stays the focus until it settles (spec rule 2). So Phase 4 needs its
own resolver — one, app-level, additive to Phase 3, which keeps `resolveGameweekView` unchanged for the
league screens (round-2 finding 2).

`lib/gw-resolve-app.ts`, pure, injected clock:

```ts
export type AppGwResolution = {
  currentGw: GwRef | null;      // the locked, not-yet-fully-settled GW — the focus
  nextOpenGw: GwRef | null;     // earliest GW whose deadline is still in the future
  latestSettledGw: GwRef | null;// most recent GW settled CLEANLY in every viewer league
  overlapAlert: { gws: number[] } | null;  // more than one locked unsettled GW
};

export function resolveAppGameweek(input: {
  competition: { id: string; archived: boolean };
  gameweeks: Array<{ id: string; number: number; label: string;
                     deadlineAt: Date | null }>;   // null = not yet scheduled by FPL
  contests: Array<{ gwId: string; leagueId: string; status: ContestStatus;
                    deadlineAt: Date;          // the contest's OWN snapshot — authoritative
                    inputVersion: number;
                    cl: ContestLifecycle }>;   // CL0–CL10, precomputed — see below
  results: Array<{ gwId: string; leagueId: string; outcome: 'settled'|'void';
                   settledVersion: number }>;
  viewerLeagueIds: string[];
  now: Date;
}): AppGwResolution;
```

**Classification is Phase 3's, supplied as an input (round-4 finding 3) [V3].** v4 said "every
per-contest lifecycle question goes through Phase 3's `resolveContestLifecycle`" while giving the resolver
an input with **no fixtures in it** — and Phase 3's signature is
`resolveContestLifecycle(contest, gw, fixtures, results, now)`, where `fixtures` are the **effective**
fixtures after the D6 membership collapse. The resolver could not call the function it claimed to call, and
Phase 4 must not reimplement the collapse (two implementations of "effective membership" is the drift the
whole CL tree exists to prevent). So the split is explicit:

- **The loader** — `lib/gw-resolve-app-load.ts`, impure — resolves effective fixture membership and state
  for each gameweek in scope exactly once, then calls **Phase 3's `resolveContestLifecycle`** per contest
  and puts the returned `cl` on the contest record. It imports the function; it does not restate the tree.
- **`resolveAppGameweek`** stays pure and consumes `cl`. It never re-derives a lifecycle, never reads
  fixture state, and therefore **cannot classify the same contest differently from the league screens**.
  Test R-14 pins this: for a generated set of contests, the `cl` the loader hands over is the value
  `resolveContestLifecycle` returns for the same inputs, asserted against Phase 3's own function rather
  than a copy.

**Locking is read from the contest, not the gameweek (round-3 finding 3).** v3 took only
`status` from the contest and then decided open-versus-closed from `gameweeks.deadlineAt`. That is the
wrong source: Phase 2 and Phase 3 both treat **`gameweek_contests.deadline_at` as the authoritative
snapshot**, taken when the contest was created, and Phase 3's PR1 keys entirely off it. The two can
legitimately differ — a gameweek deadline moved by an FPL reschedule does not retroactively reopen a
contest that already locked against the old one. Using the gameweek's value would reopen a locked
contest on screen and, worse, disagree with the league screens about the same gameweek. `gameweeks.deadlineAt`
is used only for `nextOpenGw`, which is about a gameweek nobody has a contest in yet, and it is
**nullable** — a gameweek whose deadline FPL has not published yet has no value to compare (round-4
finding 3).

Rules, in order:

1. **`nextOpenGw`** = lowest-numbered gameweek that satisfies **both**: its `deadlineAt` is **non-null and
   later than `now`**, and **no in-scope contest for it is already locked** — i.e. no contest of the
   viewer's for that gameweek has `cl` outside {CL0, CL1}. A null `deadlineAt` is never open; it is
   unscheduled. Null overall in the final week of a season.

   **The locked-contest exclusion is new in v5 (round-4 finding 3) [V3].** Without it R-8's shape — a
   contest snapshot that locked against an *earlier* deadline than the gameweek now carries — makes GW3
   simultaneously `currentGw` (rule 3, from the contest snapshot) and `nextOpenGw` (rule 1, from the moved
   gameweek deadline), so the tabs would offer to enter the gameweek they are already showing as locked.
   The contest snapshot wins in both directions, which is the same precedence rule 3 applies.
2. **Settled across leagues, and never vacuously.** A gameweek counts as settled only when **both**:
   - it has **at least one in-scope contest** — a viewer league with a contest for that gameweek; and
   - **every** in-scope contest's `cl` is **`CL5` or `CL7`** — clean settled or clean void.

   The first clause is new in v4 and it matters (round-3 finding 3): "every contest is clean" is
   **vacuously true when there are no contests**, so v3's rule would have declared a gameweek nobody
   entered fully settled and let `latestSettledGw` skate past it. A gameweek with no in-scope contest is
   *not settled* — it is simply not this viewer's gameweek.

   **Cleanliness comes from the supplied `cl`, not from a second reading of the result row (round-5
   finding 2) [W2].** v5 restated Phase 2's dirty predicate here — `outcome in ('settled','void') and
   input_version <= settled_version` — which is the third place that predicate would have lived. Phase 3's
   §5.1 already applies it: **CL5** is clean settled, **CL7** clean void, **CL6/CL8** their dirty
   counterparts and **CL9** terminal-with-no-result-row. So rule 2 tests the classification instead, and
   the dirty rule stays in one place. Everything that is not CL5/CL7 is unsettled: one league still
   `settling` (CL4), one dirty result (CL6/CL8), one corrupt contest (CL9).

   **CL0 is excluded from rule 2's scope; CL10 is not.** A true-blank contest has nothing on either
   surface — PR4 renders C29 and no row at all — so it contributes to neither `currentGw` nor
   `latestSettledGw` and the resolver reads past it. CL10 is a **live obligation** and is treated as
   unsettled (see rule 3).
3. **`currentGw`** = the highest-numbered gameweek that has at least one in-scope contest whose `cl` is
   **`CL2`, `CL3`, `CL4`, `CL6`, `CL8`, `CL9` or `CL10`** — past its own deadline with something still to
   resolve — and which is **not** settled by rule 2. This keeps a locked, live or awaiting-settlement
   gameweek on screen instead of jumping ahead the moment a deadline passes.

   **`cl` is the test, not `deadlineAt <= now` (round-4 finding 3) [V3].** v4's rule was "any in-scope
   contest past its own deadline, not settled by rule 2", which sweeps in **CL0**, a **true blank**
   gameweek (no effective-active *and* no effective-void fixtures — Phase 3 §5.1 step 4). That would have
   presented a blank gameweek as the focus gameweek while PR4 says the league screens render C29 and no row
   at all — the two surfaces disagreeing about the same contest, which is exactly what importing Phase 3's
   classifier was meant to make impossible. CL1 is excluded because a future deadline is open (PR1),
   CL5/CL7 because they are clean and terminal (rule 2 already claims them).

   **CL10 belongs here, and v5 was wrong to exclude it (round-5 finding 2) [W2].** v5 grouped CL10 with
   CL0 and said Phase 2 would never write a result over a wholly called-off gameweek. **It does.** Phase 2
   §L3 is explicit: 0/1-entrant contests void at lock, and "**all-void W2 contests become ready trivially
   and settle through claim/finalize returning `kind:'void'`**" — the readiness gate (every
   effective-active fixture finished) is vacuously satisfied when there are no effective-active fixtures, so
   a ≥2-entrant CL10 contest is claimed on the very next settlement pass and written as
   `outcome='void', void_reason='all_fixtures_void'` (Phase 2 §3 W2, §1 `GwOutcome`; `void_reason` check at
   the `void_reason` check constraint on `gameweek_results`). CL10 therefore means **"all called off, result not written
   yet"** — an unfinished pot with real money in it, and the last thing the app should do is move focus off
   it. It stops being current the moment Phase 2's void lands and Phase 3 reclassifies it **CL7**, which
   rule 2 then claims as settled. Excluding it, as v5 did, would have hidden a pending settlement from the
   viewer and let `currentGw` jump to the next gameweek while the previous one still owed transfers.
4. **`latestSettledGw`** = the highest-numbered gameweek that **is** settled by rule 2. Analytics needs
   this separately from `currentGw`, because season figures must come from clean money while the current
   gameweek is still in flight.
5. **`overlapAlert`** = set when rule 3 finds **more than one** past-deadline unsettled gameweek, listing
   all of them. Its presence means settlement is behind; the UI shows the caveat line and Analytics
   **suppresses the lead card** (§6.6 rule 2, `reasons` entry `overlap`). The resolver reports it; it never
   picks a winner silently. **v7 said "suppresses cumulative figures" here while §6.6 and U-14d suppress
   only the lead card (round-7 finding 4) [Y4].** One gate, one wording: `overlap` never touches the
   cumulative cards, because the cumulative figures are computed through `latestSettledGw` and a backlog of
   *unsettled* gameweeks does not make settled history wrong. Only a **dirty** gameweek does, which is what
   `dirty` and `dirty_older` are for.
6. **Archived competition** → `currentGw = nextOpenGw = overlapAlert = null`, and `latestSettledGw` is
   computed with **the same rule 2 predicate**, not assumed to be the final gameweek. v3 handed back the
   last gameweek unconditionally, which would present a dirty or corrupt final gameweek in an archive as
   clean settled history — the stale-money bug with a longer shelf life. An archive is read-only, so a
   stuck contest in it is not a live *alert*; it is still not clean *data*.
7. If no in-scope contest has passed its deadline (pre-season), `currentGw` is null and the tabs render
   their pre-season empty state (§9.3).

Loader tests, sixteen, each asserting all four output fields:

| # | Seed | Asserts |
|---|---|---|
| R-1 | GW3 locked and unsettled, GW4 open | `currentGw=3`, `nextOpenGw=4`, no alert |
| R-2 | GW3 settled in league A, still `settling` in league B | `currentGw=3` (not advanced), `latestSettledGw=2` |
| R-3 | GW3 has a result row but `input_version > settled_version` | GW3 counts as unsettled: `currentGw=3`, `latestSettledGw=2` |
| R-4 | GW3 `outcome='void'`, clean | void **is** settled: `currentGw` moves off 3, `latestSettledGw=3` |
| R-5 | GW2 and GW3 both past deadline, both unsettled | `currentGw=3`, `overlapAlert.gws=[2,3]` |
| R-6 | GW38 locked, no later gameweek | `nextOpenGw=null`, no crash |
| R-7 | Competition archived, final GW clean | all-null current/next/alert, `latestSettledGw=38` |
| **R-8** | GW3's contest `deadline_at` is **earlier** than `gameweeks.deadlineAt` (FPL moved the deadline after locking) | The contest snapshot wins: GW3 reads locked, `currentGw=3` — **not** open — and **`nextOpenGw` is 4, never 3**, so no gameweek is both current and next-open (rule 1's locked exclusion) |
| **R-9** | GW3 contest is `settled` with **no `gameweek_results` row** (CL9 corrupt) | GW3 is unsettled: `currentGw=3`, `latestSettledGw=2` |
| **R-10** | GW3 has **no contest in any viewer league** | GW3 is neither current nor settled; `latestSettledGw` stays at 2, no vacuous advance |
| **R-11** | Competition archived, final GW **dirty** | `latestSettledGw=37`, not 38; no alert |
| **R-12** | GW2 settled cleanly; GW3's contest is past its deadline over a **true blank** gameweek (no effective-active and no effective-void fixtures) → `cl = CL0` | GW3 is **not** `currentGw` and not settled: `currentGw=null`, `latestSettledGw=2`, no alert. v4 made this `currentGw=3` |
| **R-13** | Same seed, but GW3's fixtures were **all called off** with ≥2 locked-in entries and no result row yet → `cl = CL10` | **Opposite of R-12**: `currentGw=3`, `latestSettledGw=2` — the pot is unresolved until Phase 2 writes its `all_fixtures_void` result (round-5 finding 2) **[W2]** |
| **R-13b** | The same contest **after** Phase 2's void lands, so Phase 3 reclassifies it `cl = CL7` | Focus moves off it: `currentGw=null`, `latestSettledGw=3`. R-13 → R-13b is the whole transition, and asserting both is what proves CL10 is a waiting state and not a terminal one |
| **R-14** | A generated set of contests with fixtures and results | The `cl` the loader supplies equals **Phase 3's `resolveContestLifecycle`** for the same inputs, asserted against the imported function — the resolver holds no second classifier |
| **R-15** | GW4's `gameweeks.deadlineAt` is **null** (FPL has not published it) | `nextOpenGw` skips GW4 rather than treating null as open, and no comparison throws |

### 6.2 `lib/gw-live-money.ts` — provisional money at the current score **[R1]**

v1 excluded unfinished fixtures, so a live 1–0 contributed nothing — contradicting the spec amendment
(*"as it stands: +₹600 in Solid Yenne · P1"*, spec line 106). Corrected contract.

**Per league**, build a `GwInput` snapshot containing:

- every **finished** fixture as `{state:'final', home, away}`;
- every **in-progress** fixture **at its current score**, also as `{state:'final', …}` — that is what
  "as it stands" means;
- every **void** fixture as `{state:'void'}`;
- and **omit only fixtures that have not kicked off**.

**There must be a kicked-off fixture at all (round-3 finding 4) [T4].** If no counted fixture has started,
`buildLiveInput` returns `null` and the caller renders no money — not ₹0, not a nets object over an empty
snapshot. This is the ordinary state of CL2 ("closed, awaiting results"), which begins the moment the
deadline passes and can last hours before the first kickoff. "As it stands" has no meaning when nothing
stands yet, and an engine call over a snapshot of nothing would hand back a full set of confident zeroes.
Void-only is the same case: voids carry no score, so a gameweek whose only non-pending fixtures are voids
also yields `null`. Test M-6.

Then call the engine's **already-exported** functions — `settleGameweek` and `gameweekNets`
(`lib/gameweek-settle.ts:105,141`) for money and winners, `scoreGameweek`
(`lib/gameweek-points.ts:115`) for the per-fixture 0/1/3 chips. **No export refactor and no change to
either golden file** (v1's D4 is withdrawn; E4 in §0.1 is therefore unconditional).

Output per entered league:
`{ leagueId, leagueSlug, leagueName, ordinal, fieldSize, points, netInr, inProgress: true }`.
`points` is **always** present per row; only the card's `headerPoints` is nulled when rows differ (X-4).

Tests replace v1's wrong U-10 with M-1…M-5: mixed live/finished/upcoming; a **live 0–0**, which must
produce a real verdict rather than be skipped; differing-league picks; an all-final case asserting
byte-identical equivalence with a straight `settleGameweek` call; and unstarted-omitted /
voids-included.

### 6.3 `lib/matches-tab.ts` → `MatchesTabView` (finding 4)

```ts
type LeagueRef = { id: string; slug: string; name: string };

type MatchesTabView = {
  competition: { id: string; slug: string; name: string; archived: boolean };
  gw: { id: string; number: number; label: string; state: 'pre'|'live'|'settled';
        deadlineAt: string; isCurrent: boolean };
  picker: { prev?: number; next?: number; range: number[]; futureCaveat: boolean };

  yourGw: {
    enteredCount: number; leagueCount: number; toGo: number | null;
    headerPoints: number | null;          // null only when rows differ (X-4)
    rows: LeagueRowView[];
    provisional: boolean;                 // one footer, not one per row
    recap?: { gwNumber: number; href: string };
  } | null;

  winnersRecap: WinnersRecapView[] | null;

  days: Array<{ label: string; fixtures: FixtureRowView[] }>;
  overflow: { count: number; label: string } | null;   // "…3 more · Sun and Mon"
};
```

`FixtureRowView`: state (`time | minute+LIVE | FT | Postponed | Void`), crests, names, score (`null`
pre-kickoff → a dash, never 0–0), `matchHref`, an `insightsMark` boolean, and a `yourCall` union:
`{kind:'none'} | {kind:'same', score, leagues: LeagueRef[], points, verdict?} |
{kind:'varies', calls: Array<{score, league: LeagueRef, points, verdict}>}` — sorted best-call-first,
leagues **named** not counted. No friend consensus in hub rows. No odds in rows.

`winnersRecap` reads Phase 2's `gameweek_results` + `gameweek_entry_results` through the session client
(RLS), so it can only ever show leagues the viewer belongs to.

#### 6.3a `LeagueRowView` and `WinnersRecapView` — every legal Phase 2 outcome **[R2]**

v2 said `points` is "null only when not entered" and modelled every recap as settled. Phase 2 permits
four more outcomes that v2 had no shape for: a **dirty** result (`input_version > settled_version`),
a **void** outcome (which writes `gameweek_results` and **no per-entry rows at all** — Phase 2 plan
§"Per-entry result rows exist ONLY for outcome='settled'"), a `needs_update` entry, and an **invalid**
entry that stakes nothing. Rendering any of those through v2's shape shows stale money as if it were
final (round-2 finding 3).

**Phase 4 does not invent a classification.** It reuses Phase 3's `resolveContestLifecycle` (the ordered
CL0–CL10 tree, Phase 3 §5.1), `resolveViewerParticipation` (VP0–VP5, §5.2) and **`resolveRender(cl, vp)`**
with its precedence rules PR1–PR9 (§5.3) **verbatim, by import**.

**v3's union was a hand-picked subset and its VP labels were wrong (round-3 finding 4) [T4].** It mapped
`needs-update` to VP4; Phase 3 §5.2 defines **VP3 = `needs_update`** and **VP4 = `locked_in`**. It had no
shape at all for open-entered, ineligible (VP0), corrupt (CL9), all-called-off (CL10) or locked-awaiting
(CL2). Its `not-entered` arm required a CTA, which **PR8 forbids** in a terminal lifecycle — VP1 there
renders C66 ("You sat this one out"), not a button offering to enter a gameweek that is over. And its
`provisional` arm spanned CL2–CL4 while requiring `netInr`, though CL2 routinely has no kicked-off fixture
and therefore no money to state.

So the builder is **exhaustive over `resolveRender(cl, vp)`**, fourteen arms, with an `assertNever` on the
default branch so a new Phase 3 render outcome breaks the build rather than falling through to a blank row.
Its signature is

```ts
export function buildLeagueRow(cl: ContestLifecycle, vp: ViewerParticipation, ctx: RowCtx):
  LeagueRowView | null;
```

— **`| null` is the CL0 case, and it is in the type (round-4 finding 4) [V4]**. v4 said in prose that CL0
"produces no row at all", declared a union with no way to say so, and then asserted in U-2a and acceptance K
that all 66 cells produce an arm. Two of those three could hold. The nullable return is the one that matches
PR4, so the other two are corrected to it below.

```ts
type LeagueRowView =
  | { kind: 'open-not-entered';   league: LeagueRef; cta: Cta; raceHref: string }      // CL1 + VP1 (PR6, C3)
  | { kind: 'open-entered';       league: LeagueRef; cta: Cta; raceHref: string }      // CL1 + VP2 (PR6, C7)
  | { kind: 'open-locked-in';     league: LeagueRef; raceHref: string }                // CL1 + VP4 — NO cta (PR6)
  | { kind: 'open-needs-update';  league: LeagueRef; cta: Cta; raceHref: string }      // CL1 + VP3 (PR6, C47)
  | { kind: 'locked-awaiting';    league: LeagueRef; raceHref: string }                // CL2 — no money yet
  | { kind: 'closed-not-entered'; league: LeagueRef; raceHref: string }                // terminal + VP1 (PR8, C66) — NO cta
  | { kind: 'ineligible';         league: LeagueRef; raceHref: string }                // VP0 (PR5, C65)
  | { kind: 'invalid';            league: LeagueRef; reason: string; raceHref: string }// VP5 (PR7, C50)
  | { kind: 'provisional';        league: LeagueRef; ordinal: string | null; fieldSize: number;
      points: number; netInr: number | null; raceHref: string }                        // CL3/CL4
  | { kind: 'recalculating';      league: LeagueRef; points: number | null; raceHref: string } // CL6/CL8
  | { kind: 'settled';            league: LeagueRef; ordinal: string; fieldSize: number;
      points: number; netInr: number; raceHref: string }                               // CL5
  | { kind: 'void';               league: LeagueRef; voidReason: string; raceHref: string } // CL7
  | { kind: 'all-called-off';     league: LeagueRef; raceHref: string; waiting: true }  // CL10 (C72) —
                                                          // waiting on Phase 2's void, NOT terminal [X1]
  | { kind: 'sync-issue';         league: LeagueRef; raceHref: string };                // CL9 (C64)
```

Rules that fall out of it:

- **`sync-issue` (CL9) wins over every VP**, because PR2 says corrupt beats everything: no points, no
  money, no CTA. **`ineligible` (VP0) is next** by PR5. **CL0** (blank / pre-season) returns **`null`** —
  no row at all rather than an empty one, per PR4 — for all six VP values, PR4 outranking even PR5.
- **A CTA exists only for CL1 + VP ∈ {VP1, VP2, VP3}** (PR6). **CL1 + VP4 (`locked_in`) therefore has no
  CTA and gets its own arm, `open-locked-in` (round-4 finding 4) [V4].** v4 folded VP4 into `open-entered`,
  whose shape *requires* `cta`, so the union itself forced a button onto a locked-in entry that PR6 does not
  permit — the same class of bug as the terminal CTA v4 fixed, one lifecycle earlier. A locked-in entry is
  complete and unchangeable: the row shows the entry and the race link and offers nothing to press. Every
  terminal arm is likewise CTA-free by construction — the field does not exist on those shapes, so the bug
  PR8 warns about cannot be written.
- **`provisional.netInr` is nullable**, and is null until at least one counted fixture has kicked off
  (§6.2, M-6). `locked-awaiting` (CL2) has no money field at all.
- **`invalid`** carries no points and no money: an invalid entry stakes nothing, so a number there would
  be a claim about a contest the viewer is not in.
- **`recalculating`** is the dirty case where PR3/PR3a bind: **all money is suppressed** (there is no field
  for it), and `points` come from the **live input recomputation**, never from `gameweek_entry_results`. If
  the recomputation cannot run, `points` is null and the row shows C60 alone. The stored snapshot is never
  shown while dirty — that is the stale-money bug.
- **`void`** (CL7) and **`all-called-off`** (CL10) have neither points nor money by construction, matching
  Phase 2's no-entry-rows rule. Neither is an error. But they are **not the same kind of state**, and v6
  called both "terminal and clean" (round-6 finding 1) **[X1]**:
  - **`void` is terminal and clean.** Phase 2 has written the result; there is nothing left to happen.
  - **`all-called-off` is a *waiting* state.** Every fixture was called off, so Phase 2's readiness gate is
    vacuously satisfied and a ≥2-entrant contest will be claimed and written `all_fixtures_void` on the
    next settlement pass (§6.1 rule 3). Until then the pot is unresolved. Calling it clean here while §6.1
    counts it as `currentGw` is the two halves of Phase 4 disagreeing about one contest — the exact defect
    the CL import exists to prevent.

  So the arm carries **`waiting: true`** and the row renders the settlement-pending caption (C72 plus the
  "settling" note), not a settled-looking one. It has no money field either way: money is not suppressed
  *pending* anything, it will never exist for this contest, which is why the shape does not change when the
  contest reclassifies. On reclassification to **CL7** the same league drops to the `void` arm.

  **The transition assertion is stated against the declared union, not as "differ only in `kind`/`waiting`"
  (round-7 finding 2) [Y2].** v7's wording was unsatisfiable: the `void` arm requires `voidReason`, so no
  valid CL7 object can differ from the CL10 object in `kind` and `waiting` alone. **U-2c** asserts the
  three real differences and the one thing that must not change: `kind` moves `'all-called-off'` →
  `'void'`, `waiting` is **absent** on the CL7 arm (not `false` — the field does not exist there),
  `voidReason === 'all_fixtures_void'` appears, `league` and `raceHref` are byte-identical across the two,
  and **neither arm carries a points or money field at all** — so the no-money/no-points shape is
  structurally preserved rather than asserted value-by-value.
- `headerPoints` (X-4) is nulled unless every row is `settled` (or every row `provisional`) **and** their
  points agree — a mixed set has no single number to show.

**Test U-2a runs the full CL0–CL10 × VP0–VP5 cross-product** — 66 combinations — and asserts
**six `null`s and 60 rendered cells (round-4 finding 4) [V4]**: the six CL0 rows return `null` (PR4), and
each of the other 60 maps to exactly one arm. It further asserts that no combination yields a CTA outside
CL1 + VP1/VP2/VP3 — **CL1 + VP4 included in the negative, since that is the cell v4 got wrong** — that no
arm outside `provisional`/`settled` carries money, and that the `assertNever` branch is unreachable. The
66/60/6 split is stated as three separate assertions rather than one count, so a future arm that swallows
CL0 fails the test instead of keeping the total at 66. This mirrors Phase 3's own T-U2, so the two screens
cannot drift on the same contest.

**Callers handle `null`.** `yourGw.rows` is built by mapping the viewer's leagues through `buildLeagueRow`
and dropping the nulls, so a competition in which every in-scope contest is CL0 yields an empty `rows`
array — and `yourGw` itself is then `null` (§6.3), which is the pre-season empty state (§9.3), not a card
with no rows in it. U-2b pins that: all-CL0 input → `yourGw === null`, and no zero, skeleton or placeholder
row anywhere in the view (X-2).

`winnersRecap` becomes the same kind of union rather than assuming a pot:

```ts
type WinnersRecapView =
  | { kind: 'settled'; league: LeagueRef; potInr: number;
      winners: Array<{ name: string; points: number }>;
      tiebreakUsed: 'none'|'exacts'|'goalError'|'split'; href: string }
  | { kind: 'void'; league: LeagueRef; voidReason: string; href: string }
  | { kind: 'recalculating'; league: LeagueRef; href: string };
```

A void gameweek's recap says the gameweek was voided and why. It does **not** render a ₹0 pot with an
empty winners list, which is what v2's non-union shape would have produced.

Tests: U-6a dirty-settled row renders `recalculating` with recomputed points and **no money anywhere on
the card**; U-6b dirty-settled where recomputation fails renders `recalculating` with null points and the
caveat; U-6c dirty-void renders `recalculating` and never reads `gameweek_entry_results`; U-6d
single-entrant void renders `void` with its reason and no pot; **U-6e a gameweek where every fixture voided is split by
whether Phase 2's result row exists yet (round-8 should-fix 2) [Z4]**: U-6e-i, before the
`all_fixtures_void` result is written, is CL10 and must render `all-called-off` with `waiting: true` —
v8's single case said this shape renders `void`, which is the CL10-as-terminal mistake round 6 removed;
U-6e-ii, once that clean void result exists, renders `void` with
`voidReason === 'all_fixtures_void'` in every league row and no pot; U-6f an invalid viewer entry renders `invalid` with no points, no
money and no ordinal.

### 6.4 `lib/standings-view.ts` → the Table

Compression, not truncation: top 8, a labelled gap row ("8 clubs between them"), bottom 4. Form dots
render only matches played (two dots after two games). Champions-League and relegation boundary
markers. Source and freshness stated once at the top. No Cashford number anywhere. One component serves
both the Matches-tab Table segment and the league Table tab Phase 3 left a slot for.

### 6.5 `lib/match-detail.ts` → `MatchDetailView`

Every provider-fed block is built by a `lib/match-blocks.ts` constructor that returns `undefined` when
semantically empty (X-2), and carries its own source and stamp (finding 7):

```ts
type Sourced<T> = T & { source: string; fetchedAt: string; age: string };

type MatchDetailView = {
  state: 'pre'|'live'|'post';
  header: { home: Club; away: Club; score: [number,number] | null; status: string;
            kickoffAt: string | null;   // null = postponed / TBC (round-5 finding 4)
            // the SELECTED room's contest deadline snapshot — null when room is null
            deadlineAt: string | null;   // league-scoped (round-6 finding 3) [X3]
            scorers?: Sourced<{ lines: ScorerLine[] }> };
  yourCalls: Array<{ league: LeagueRef; anteInr: number; score: [number,number] | null;
                     deadlineAt: string;   // THIS league's contest snapshot [X3]
                     entered: boolean; points?: number; verdict?: 'exact'|'result'|'miss' }>;
  room: { league: LeagueRef; leagueOptions: LeagueRef[]; deadlineAt: string;   // [X3]
          entrants: Array<{ name: string; score: [number,number] | null; hidden: boolean;
                            annotation?: string; points?: number; offBy?: number;
                            verdict?: 'exact'|'result'|'miss' }> } | null;
  whatIf?: { line: string };                                    // live only

  // pre only. One Sourced<T> per independently stamped, independently renderable module —
  // NOT one Sourced<InsightsBlock> (round-3 finding 5) [T5].
  odds?:    Sourced<{ home: number; draw: number; away: number; book: string }>;
  model?:   Sourced<{ topScores: ScoreProb[]; btts: number; cleanSheets: [number,number]; pOver: number }>;
  form?:    Sourced<{ home: FormRun; away: FormRun }>;
  h2h?:     Sourced<{ games: H2HGame[]; summary: string }>;
  table?:   Sourced<{ window: StandingRow[]; source: 'espn'|'derived'; note: string | null }>;

  teamNews?: Sourced<{ home: NewsItem[]; away: NewsItem[] }>;   // own source + stamp
  keyEvents?: Sourced<{ timeline: MatchEvent[] }>;

  // ONE key for the one team_stats_ok / team_stats_fetched_at pair, state-tagged (round-4 finding 6).
  // 'live' renders the five-stat live frame (§8); 'final' renders the full post-match bars.
  teamStats?: Sourced<{ phase: 'live'|'final'; minute: string | null; rows: StatRow[] }>;
  playerStats?: Sourced<{ rows: PlayerStatRow[] }>;
  commentary?: Sourced<{ lines: Array<{ minute: string; text: string }> }>;
  lineups?: Sourced<{ home: XiBlock; away: XiBlock }>;
  retrospective?: Sourced<{ line: string }>;                    // post, once

  // xG and the shot map come from different providers on different stamps, so they are siblings.
  xg?:      Sourced<{ home: number; away: number; provider: 'FotMob'|'Understat'; model: string;
                      afterFt: string }>;                       // via selectXg only
  shotMap?: Sourced<{ shots: ShotMapEntry[]; provider: 'FotMob'|'Understat' }>;
  ratings?: Sourced<{ potm: PlayerRating; others: PlayerRating[]; provider: string }>;
  momentum?: Sourced<{ series: MomentumPoint[]; provider: string }>;
  predictedXi?: Sourced<{ home: XiBlock; away: XiBlock; provider: 'FotMob' }>;
  raceLink?: { league: LeagueRef; standingLine: string; href: string };
  notes: string[];                                              // void / corrected-result one-liners
};
```

**Why the DTO was flattened (round-3 finding 5) [T5].** v3 stored odds, model, form, H2H and the table
window under five separate flags and five separate stamps (§1.1) and then collapsed them into a single
`Sourced<InsightsBlock>` here — so the read model could not say "the odds are 8 minutes old but the table
is an hour old", and one broken module took the whole block down. It also nested `shots` **inside** `xg`
while §1.4 stamps them separately, meaning a fresh xG number could carry a shot map from a different
fetch under the xG's stamp. Every separately stamped storage field now has its own `Sourced<T>` at the top
level, and the invariant is mechanical: **for each `*_ok` / `*_fetched_at` pair in §1.1 and §1.3 there is
exactly one `MatchDetailView` key**, asserted by **U-18b**, which walks the two column lists and fails on
any storage field with no rendering home (or the reverse). `InsightsBlock` disappears as a type.

**`liveStats` is gone; `teamStats` is state-tagged (round-4 finding 6) [V6].** v4 declared both
`liveStats` and `teamStats` while §1.3 stores **one** `team_stats` column behind **one**
`team_stats_ok` / `team_stats_fetched_at` pair — so the "exactly one key per pair" invariant U-18b asserts
was false in v4's own DTO, in the storage→view direction, and the test could not have passed. The two keys
were never two data sets either: the live five-stat frame (§8) and the post-match bars are the same ESPN
stats block read at different times. So there is **one key, tagged with which reading it is**:
`phase: 'live'` while the match is in progress, `'final'` from full time, with `minute` non-null only in the
live phase. The renderer picks the frame from `phase`; a single storage pair therefore maps to a single view
key that has **two mutually exclusive presentations**, which is the mapping U-18b can actually check. **U-18c**
pins the tag: a live view carries `phase='live'` with a minute and at most the five stats §8 allows, a
post-match view carries `phase='final'` with `minute === null`, and no `MatchDetailView` ever holds both a
live and a final stats key — because there is only one key to hold.

**`header.kickoffAt` is nullable, because the column is (round-5 finding 4) [W4].** Phase 1 drops the
not-null constraint (the `alter column kickoff_at drop not null` statement in Phase 1's migration), the
FPL sync writes `nullif(e->>'kickoff_at','')` through **`apply_fpl_reconciliation`** — the real routine
name; v7 called it `sync_fpl_gameweeks`, which does not exist in either migration or in `lib/sync-fpl.ts`
(round-7 should-fix 3) **[Y8]** — and §4.7's reconciliation now writes null in place when a fixture is
postponed to no date. A required `string` therefore made a real row **unrepresentable**: the one fixture whose match page
people would actually open to find out what happened is the one whose DTO could not be built. v5's own
finding-3 fix created the writer of the value its DTO forbade.

Rendering, defined here so it is not invented per component:
- **`kickoffAt === null`** → the header time slot reads **"Date TBC"**, and `status` carries the provider's
  own word (`'Postponed'`, `'Cancelled'`) when there is one. No relative countdown, no "in 3 days", no
  `new Date(null)` — which is where an unguarded null becomes "1 Jan 1970" on screen rather than a crash.
- **The pre-match modules follow the model chip rule, not a new one**: `model_source_kickoff_at` cannot
  equal a null kickoff (§13 step 7 requires exact equality with both sides non-null), so a TBC fixture
  shows **no model chips**, which is correct — a Poisson model over an unscheduled fixture is a guess about
  a match that may not happen. Odds, form, H2H and the table window are unaffected; they do not depend on
  the kickoff.
- **`deadlineAt` is league-scoped and nullable — v6's "stays non-null" bullet was wrong (round-6
  finding 3) [X3].** v6 argued the field is safe because `gameweek_contests.deadline_at` is `not null`.
  That constraint guarantees a value **only where a contest row exists**, and it guarantees one value
  **per league**, not one per fixture. Two cases break the old claim, and both are required by this plan:
  - **The neutral deep link (E-9).** A viewer with no league in the competition still resolves the
    fixture, `room` is null, and there is **no contest row anywhere** to read a deadline from. `NOT NULL`
    on a row that does not exist guarantees nothing.
  - **A multi-league viewer.** Two of the viewer's leagues can hold different `deadline_at` snapshots for
    the same gameweek — that is exactly the divergence §6.1 rule R-8 already relies on, where a contest's
    own snapshot beats `gameweeks.deadlineAt`. A single fixture-level header value would have to pick one
    silently and be wrong for the other room.

  So the deadline is carried where it is scoped: **`room.deadlineAt`** (the selected league's snapshot,
  non-null because a room implies a contest) and **`yourCalls[].deadlineAt`** (each entered league's own
  snapshot). `header.deadlineAt` is `string | null` and is defined as **the selected room's value**, so
  the header, the room block and that league's row can never disagree.
- **The neutral fallback is explicit.** When `room === null` the header renders **no lock countdown at
  all** — not the gameweek deadline, not the earliest of anything. `header.deadlineAt` is null, the lock
  line is omitted, and the page shows the fixture, insights and scores only. `gameweeks.deadlineAt` is
  deliberately **not** used as a stand-in: §6.1 already establishes that the gameweek deadline is not
  authoritative for any contest, and showing it to a viewer who has no contest would be a lock time that
  applies to nobody.
- **Switching rooms re-scopes the header.** Changing `room.league` through `leagueOptions` moves
  `header.deadlineAt` to the newly selected league's snapshot. It is a projection of the selected room,
  never an independently loaded value.

Test **U-18d**: build `MatchDetailView` from a seeded fixture row with `kickoff_at = null`, assert the DTO
constructs, `header.kickoffAt === null`, the time slot renders "Date TBC", and no `model` key is present.
Seeded from an actual null-kickoff row rather than a hand-written object, so the test fails if the column
ever regains its constraint and the case stops being reachable.

`room` is null when the viewer has access to no league in this competition — the neutral deep-link case
(E-9). Two loader tests pin the scoping **[X3]**: **U-18e** a zero-contest caller — the neutral viewer
builds the DTO with `room === null`, `header.deadlineAt === null`, `yourCalls` empty, and no query is
issued against `gameweek_contests`; **U-18f** a divergent-snapshot caller — a viewer in two leagues whose
contests hold different `deadline_at` values for the same gameweek gets both values in `yourCalls`,
`header.deadlineAt` equal to the selected room's, and asserts it changes when the selection changes —
**and, at a `now` between the two deadlines, that reveal behaviour follows the selected room (round-7
should-fix 1) [Y7]**: the earlier league's entrants show scorelines while the later league's still show
placeholders. Checking the displayed value alone would pass a build that scoped the header correctly and
still revealed picks on the gameweek clock.

### 6.6 `lib/analytics-view.ts` → `AnalyticsTabView` (finding 4)

v1 had the math but no view model.

```ts
type AnalyticsStrip =
  | { kind: 'pre_not_entered'; gw: number }     | { kind: 'pre_entered'; entered: number; of: number }
  | { kind: 'live_not_entered'; gw: number }    | { kind: 'live_entered'; gw: number; raceHref: string }
  | { kind: 'settled_not_entered'; gw: number } | { kind: 'settled_entered'; gw: number }
  // CL10 — all fixtures called off, Phase 2's void not written yet (round-6 finding 1) [X1]
  | { kind: 'awaiting_void_not_entered'; gw: number }
  | { kind: 'awaiting_void_entered'; gw: number };

type AnalyticsTabView = {
  competition: { id: string; slug: string; name: string; archived: boolean };
  currentFocusGw: { id: string; number: number;
                    state: 'pre'|'live'|'settled'|'awaiting_settlement' };   // [X1]
  latestSettledGw: { id: string; number: number } | null;   // what every card is computed through
  strip: AnalyticsStrip;
  lens: { league: LeagueRef | null; options: LeagueRef[] };
  leadCard?: { gwNumber: number;
               perLeague: Array<{ league: LeagueRef; points: number; potInr: number | null }>;
               exacts: number; biggestGain: ReceiptRef; biggestMiss: ReceiptRef;
               acknowledged: boolean };
  myForm?: MyFormView;  vsRoom?: VsRoomView;  receipts?: ReceiptsView;
  weeklyLabels?: WeeklyLabelsView;  rivalry?: RivalryView;  clubReads?: ClubReadsView;
  habits?: HabitsView;
  emptyState?: { kind: 'pre_gw1'|'never_entered'; cta: { label: string; href: string } };
};
```

Two GW fields, both needed: the strip describes `currentFocusGw`, every card is computed
`throughGameweek = latestSettledGw`, and both come from §6.1's `resolveAppGameweek`.

**`state` has a fourth value, because §6.1 can hand Analytics a gameweek that is none of the other three
(round-6 finding 1) [X1].** v6 made a CL10 gameweek `currentGw` — correctly, since its pot is unresolved —
while `currentFocusGw.state` still offered only `pre`, `live` and `settled` and `AnalyticsStrip` had no
matching arm. There was no honest value to pick: it is past its deadline so not `pre`, has no match in
progress so not `live`, and has no result row so certainly not `settled`. The implementation would have had
to mislabel the gameweek or fail to build the view. So **`'awaiting_settlement'`** is a first-class state
with its own two strip arms, and the gate behaviour is defined here rather than inferred:

- **Cards are frozen, exactly as in `live`.** Nothing about the viewer's season changed: no fixture was
  played, so there is no new sample, and the strip says so — *"GW8 called off · settling"* entered,
  *"GW8 called off"* not entered.
- **No `leadCard`.** Nothing was won. The lead card is a settlement artefact and this gameweek has not
  settled.
- **Cumulative cards are *not* suppressed and need no new reason in `suppressed.reasons`.** The reason is
  that a CL10 gameweek **contributes no played sample and no settled result**, so no cumulative figure can
  read it: every card is built from settled results, and a gameweek with no result row supplies none.
  **v7 argued this from gameweek ordering — "a CL10 gameweek is by definition above `latestSettledGw`" —
  and that is false (round-7 should-fix 2) [Y6].** `latestSettledGw` is the *highest* gameweek clean by
  rule 2, not a watermark below which everything is settled: if GW3 stays CL10 while GW4 settles cleanly,
  rule 4 returns `latestSettledGw = 4` and the pending CL10 gameweek sits **below** it. The
  no-suppression rule holds anyway, because it never depended on the ordering — it depends on the
  settled-result filter finding nothing to include for GW3. Adding a suppression reason would hide correct
  history because *another* gameweek is pending, which is the opposite of the dirty gate's purpose. The
  out-of-order case (GW3 CL10, GW4 settled, `latestSettledGw = 4`) is asserted by **U-14f**.
- **`overlapAlert` still applies.** If a CL10 gameweek and an ordinary unsettled one are both pending, §6.1
  rule 5 reports both and the existing `overlap` suppression fires unchanged. A called-off gameweek stuck
  unsettled for days is a real settlement backlog and should read as one.

When Phase 2 writes the void and the contest reclassifies **CL7**, the gameweek becomes settled by rule 2,
`state` flips to `'settled'`, the strip becomes `settled_*`, and the cumulative cards advance by exactly the
nothing a void contributes. **U-14f** drives that transition through `buildAnalyticsTabView` and asserts the
state, strip kind and card set before and after, alongside the row-builder's **U-2c** — the same transition
proved on both surfaces, so they cannot drift on one contest.

**The dirty gate (round-2 finding 3).** `latestSettledGw` is already defined as the latest gameweek clean
in *every* viewer league (§6.1 rule 2), so a dirty gameweek cannot enter a cumulative figure through the
front door. Two further gates close the back door:

```ts
  suppressed: { cumulative: boolean; leadCard: boolean;
                reasons: Array<'dirty'|'dirty_older'|'settling'|'overlap'> } | null;  // never empty when present
```

1. **Cumulative figures** — `myForm`, `vsRoom`, `rivalry`, `clubReads`, `habits`, and every money total —
   are computed only over gameweeks that **`isGwClean(gw)`** accepts in every league in scope. Phase 4
   does not restate the predicate inline anywhere: resolver rule 2 asks Phase 3 for `cl ∈ {CL5, CL7}`, and
   Analytics — which is per-gameweek and has no CL to hand — calls `isGwClean` (round-6 finding 4) **[X4]**.

   **`isGwClean` does not own the predicate; Phase 3 does (round-7 finding 5) [Y5].** v7 described it as
   "the one shared helper that owns the dirty test for all of Phase 4", which collides with Phase 3 §5.3
   PR3b: the canonical predicate lives in **`lib/net-balance.ts`**, is **exported for exactly this reason**,
   and is asserted directly by Phase 3's **T-U8** so Phase 5's Dues loader (X-P5-1) has a tested function to
   call rather than a rule to re-derive. Two implementations of "dirty" would let Analytics publish season
   figures Phase 3 and Phase 5 suppress on the same contest — the cross-surface money disagreement PR3b
   exists to prevent. So `isGwClean` is a **thin per-gameweek aggregator over Phase 3's exported
   predicate**: for each league in scope it calls the `net-balance` predicate with that league's
   `gameweek_contests.input_version` and `gameweek_results.settled_version`, and returns clean only when
   every league is clean. It contains **no version comparison of its own** — one line of `every(...)` over
   an imported function. Phase 4 adds no new owner, and a change to the dirty rule moves one function body
   in `lib/net-balance.ts`. **U-14g** asserts the delegation directly: stub the imported predicate to
   report dirty and every cumulative card must disappear, proving `isGwClean` cannot answer independently. If any gameweek at or below `latestSettledGw` is dirty (a **re-settlement of an old gameweek**,
   which is exactly how this happens in practice), those cards are **suppressed entirely**, not
   recomputed from partial data, and the strip carries the caveat line. A season average that silently
   drops a re-settling gameweek is worse than an honest gap.
2. **`leadCard`** is suppressed on **four** conditions, not three (round-3 finding 4) **[T4]**: its own
   gameweek is dirty (`dirty`); its gameweek is `settling`; its gameweek is named in `overlapAlert.gws`
   (`overlap`); **or any gameweek at or below `latestSettledGw` is dirty (`dirty_older`)**. v3 listed only
   the first three, which contradicted U-14a — the lead card states season-to-date money per league
   ("GW8 added · +₹600 · season net ₹1,240"), and those per-league figures are cumulative, so an older
   dirty gameweek makes them wrong for exactly the reason gate 1 exists. **Whenever `cumulative` is
   suppressed, `leadCard` is suppressed too**; the converse does not hold (a `settling` current gameweek
   leaves the cumulative cards intact, U-14b). Because several conditions can hold at once, `reasons` is a
   list rather than one value.

Both gates read the **same shared dirty predicate** the engine and Phase 3 use — Phase 4 does not restate
the comparison inline anywhere.

Tests: U-14a a dirty older gameweek suppresses every cumulative card and the lead card while the strip
still renders, with `reasons` containing `dirty_older`; U-14b a `settling` gameweek suppresses the lead
card only and leaves the cumulative cards present; U-14c an all-clean season shows every card and
`suppressed` is null; U-14d `overlapAlert` present suppresses the lead card **and leaves every
cumulative card present**, including the case where one of the overlapping gameweeks is CL10 **[Y4]**; **U-14e** the invariant —
across a generated set of gameweek states, `cumulative === true` always implies `leadCard === true`, and
`suppressed` is null exactly when `reasons` would be empty.

**Acknowledgement store ("GW8 added" pinned until opened once).** Stated explicitly: a `localStorage`
key `cf-analytics-ack:<competitionId>` holding the acknowledged gameweek number, read on the client and
used to set `leadCard.acknowledged`. Deliberately **not** a table — a durable store would be Phase 4's
only user-scoped write and would breach the §0.1 allowlist, which is the safety proof for the whole
phase. Accepted cost: the card can reappear once per device (D8).

### 6.7 `lib/analytics-math.ts` — pure, and the dedupe rule

All 7 modules' arithmetic, pure, over **settled results only**. No I/O, no `Date.now()`; every function
takes `throughGameweek`.

**Cross-league dedupe.** "My form" is rates across all leagues, so a mirrored pick must be deduplicated
to distinct `(gameweek_id, fixture_id)` before any rate is computed. Where the viewer's picks for one
fixture differ across leagues, the sample keeps the pick from the league the viewer **joined earliest**
— deterministic, explainable, stable as leagues come and go — stated in the module footnote. Money is
never summed across leagues; official points totals appear only under a named league (spec decision 4).

Module gates, enforced in the math layer so the UI cannot render a thin sample: `weeklyLabels` null
under 3 entrants or too few counted fixtures; `clubReads` includes a club only at ≥5 settled picks;
`rivalry` counts only GWs both entered; `vsRoom` needs a named league and ≥1 settled GW **the viewer
entered**; `receipts` returns an empty list rather than a filler card.

**Which modules a gameweek the viewer sat out may move (round-4 finding 8) [V8].** The gates above already
decide this, and B-11 asserts it, so it is stated here once rather than left to be inferred:

| Module | Moves on a sat-out settled GW? | Why |
|---|---|---|
| `myForm`, `receipts`, `habits`, season net | **No** | Every figure is over the viewer's own settled picks; there were none |
| `clubReads` | **No** | Per-club counts over the viewer's picks |
| `rivalry` | **No** | Gated on GWs **both** users entered, so a sat-out gameweek is outside the sample by definition. v4 listed it as advancing, contradicting this gate |
| `vsRoom` | **No** | It is a **delta**, over the gameweeks the viewer entered. Advancing only the room side would move the number without any new fact about the viewer — the same error as moving a personal average |
| `weeklyLabels` for that gameweek | **Yes** | Awarded among entrants; the viewer is simply not a candidate (§9.3). **The only module that advances** |

**There is no room-table module, and v5 asserted one (round-5 finding 5) [W5].** v5's table and B-11 both
named a "league-lens room table (each member's own points and net)" as advancing. `AnalyticsTabView` has
**seven** module keys — `myForm`, `vsRoom`, `receipts`, `weeklyLabels`, `rivalry`, `clubReads`, `habits`
(§6.6) — and no room table among them; §9.2 defines "You vs the room" as **differences between the viewer
and the room**, not a per-member table. The per-member table of points and net is the **league standings /
race screen**, which is Phase 3's surface, not an Analytics module. So the assertion pointed at a DTO field
that does not exist and a browser test could not have found it.

The fix is **removal, not a new module**: `weeklyLabels` is the only Analytics module a sat-out settled
gameweek moves. Adding an eighth module and revising §9.2 to make the assertion true would grow the phase
to satisfy a test, and would duplicate a table Phase 3 already renders. The seven-module contract stands.

**Freeze:** live weeks change nothing on the cards; only the strip changes. There is no provisional
analytics anywhere.

### 6.8 Client discipline and the enumerated service-role reads

Session client (RLS): entrants, names, picks, entries, entry results, `gameweek_results`, league
membership, transfers. Service-role reads, each justified in the loader's header comment: `fixtures`,
`teams`, `fixture_insights`, `fixture_match_data`, `fixture_provider_data`, `competition_standings`,
`fixture_provider_ids` — all reference/cache tables that are `select to authenticated using (true)`
anyway; the service client only saves a round-trip on the hot path and reads nothing a session client
could not. **No Phase 4 loader reads a user-scoped table with the service client**, and no Phase 4
loader reads `provider_samples`, `sync_state` or `sync_issues` at all.

---

## §7 Matches tab — states and rules

Route `app/matches/page.tsx` (Phase 3 built the 3-tab shell). Segmented control **Fixtures & results |
Table**. Competition switcher on top; archived competitions frozen read-only.

### 7.1 Landing

| Situation | Lands on |
|---|---|
| Pre-deadline | Current GW grouped by day; Your-GW card pinned |
| Live | Current GW, scrolled to the first live fixture, else the next kickoff |
| Post-settlement | Next open GW + "GW7 settled" recap strip linking back |
| Viewer chose a historical GW | That GW, for the visit only; next visit returns to current |

GW picker spans past, current and published-future; future fixtures marked "subject to change".

### 7.2 The 6 cells

| | Not entered (any league) | Entered (≥1 league) |
|---|---|---|
| **Pre-deadline** | Fixtures + kickoffs, no picks. Card reads "Not entered". CTA: Enter GW → league chooser first. | Fixtures + own picks, split per league where they differ. Card: "entered in 2 of 3 · 5 to go". CTAs: Edit picks (named league) · Enter another league. |
| **Live** | Scores + clocks + revealed league picks (viewable without entering). Card: "You sat this one out". No late entry. | Live scores + per-pick 0/1/3 provisional chips; card shows provisional money per entered league with one in-progress footer, computed at the current score (§6.2). CTA: View live race. |
| **Settled** | Final scores, "Not entered", **`winnersRecap`** — league winners with pot amounts. | Final scores, own picks, points per pick with Exact/Result/Miss, settled net per league. CTAs: View league recap · Share my calls. |

### 7.3 Card rules (mockup 08, non-negotiable)

One card, one row per league — never a strip per league. Ordinals, never P-numbers ("1st of 7", because
field size is half the story). Points in the header only when picks are identical in every league; the
moment one differs the header drops points and **every row carries its own** — nothing is averaged
across rooms. One provisional footer at the bottom, not one per row. A league the viewer sat out still
gets a row ("You're not in GW3", dash for money) — omitting it would read as the league having gone.
Different calls on one fixture: the row says "You called it two ways" and expands, best call first,
leagues named. Void fixture: dashed, no score, no points, and it says when it will be called again.
Not yet played: the call shows, with a dash where points will land.

### 7.4 Entry semantics at app level

"Entered" = entered in ≥1 league; always show the count, never a third state. Every entry/edit CTA
routes to a *named* league's entry sheet (`rows[].cta.href`), asking which league when ambiguous. There
is no global edit — it could silently flatten different-per-league picks. Copying picks re-consents per
league with that league's ante shown.

---

## §8 Match detail — one scroll per state, fixed order

Route `app/m/[fixtureId]/page.tsx` with `?league=<slug>` selecting the room (D2). The existing WC route
`app/leagues/[slug]/m/[id]` is untouched.

Order, verbatim from the mockup: **Pre** header → your calls → the room → insights → predicted XI.
**Live** header → your points → what-if → the room → match stats. **Full time** verdict → your calls →
the room → retrospective → post-match modules.

Rules: score is a dash before kickoff, never 0–0 · kickoff and deadline are separate lines pre-match,
and only the deadline takes picks · **no single-fixture editing, ever** — the only edit route is "Edit
all picks" → that league's GW entry sheet · **reveal is per room, at the selected league's
`gameweek_contests.deadline_at`** — never a competition-wide clock (round-7 should-fix 1) **[Y7]**: with
league A locked at 20:00 and league B at 22:00, a viewer on this screen at 21:00 sees A's scorelines and
B's placeholders, and switching rooms switches the reveal state (before: names plus `•–•`
placeholders; after: every entrant's scoreline for every fixture, including Sunday's on Friday night) ·
your own calls show for **all** your leagues with each ante, because they can differ and each scores on
its own · the room is one named league at a time, sorted by value (live: what each call is worth at the
current score with the next event it needs; FT: verdict then "Off by") · the league selector defaults
to the last league chosen in Matches, else the most recently visited, always named · nothing
FotMob-fed appears live, and the live frame carries exactly five stats and says where the rest went ·
the what-if strip names the single goal that changes the viewer's standing, from the current score only,
labelled provisional.

---

## §9 Analytics tab — states, modules, and what hides

Route `app/analytics/page.tsx`. Default landing: season-to-date **My form** — not a GW, and never a
previously chosen friend comparison. Competition choice persists; the view always resets to My form.

### 9.1 The 8 cells

| | Not entered | Entered |
|---|---|---|
| **Pre-deadline** | Stats through `latestSettledGw`. Strip `pre_not_entered` + Enter CTA. Never-entered → no-data state, not zeroes. | Settled stats. Strip `pre_entered` ("Entered in 2 of 3"). Current picks never exposed in comparative cards. |
| **Live** | Cards frozen. Strip `live_not_entered` ("GW8 live · you sat out"). No provisional analytics anywhere. | Cards frozen. Strip `live_entered` ("updates after settlement") + Follow live race. |
| **Awaiting settlement** (CL10, all fixtures called off) **[X1]** | Cards frozen; nothing was played, so no sample changed. Strip `awaiting_void_not_entered` ("GW8 called off"). | Cards frozen. Strip `awaiting_void_entered` ("GW8 called off · settling"). No lead card — nothing was won yet. Cumulative cards stay visible: a called-off gameweek contributes **no played sample and no settled result**, so the settled-result filter finds nothing of it to include (round-8 should-fix 1) **[Z3]** — this holds whatever its number is, including GW3 called off while GW4 has settled. |
| **Settled** | No new personal sample; the league lens updates with friends' results. Strip `settled_not_entered`. | Full refresh + `leadCard` ("GW8 added": points per league, exacts, biggest gain, biggest miss), pinned until acknowledged. CTAs: See breakdown · Share receipt. |

### 9.2 Modules and their hide conditions

| # | Module | Hides when |
|---|---|---|
| 1 | My form — avg pts/fixture, result rate, exact rate, avg goal miss, 5-GW form line, records | no settled picks by the viewer |
| 2 | You vs the room (league lens) — deltas vs league average, differences not another table | no named league, or no settled GW in it |
| 3 | Receipts — settled calls with social weight, named GW/fixture/league | no qualifying call |
| 4 | Weekly labels — Oracle, Maverick, Nearly, 1–0 Merchant, The Crowd | <3 entrants or too few counted fixtures |
| 5 | Rivalry — one friend, GWs both entered | no shared entered GW |
| 6 | Club reads — per club at ≥5 settled picks | no club reaches 5 |
| 7 | Prediction habits — modal scoreline, draw rate, home bias, goals predicted vs scored, consensus-following | no settled picks |

No standings, no schedule; money only in settled contexts (pot won in the lead card, season net in My
form). Debt stays in Dues.

### 9.3 Empty states

Pre-GW1-settlement: *"Your prediction profile starts when GW1 settles"* with muted previews and CTA
"Enter GW1", or "You're in; results unlock these cards". Never-entered mid-season: *"No submitted picks
yet"* + Enter current GW; the league lens is available and the viewer is omitted from awards and
comparisons.

---

## §10 Copy — lifted verbatim from the mockups

Strings live in `lib/match-copy.ts` and `lib/analytics-copy.ts`, never inline in components (Phase 3's
pattern).

Matches tab: "Your GW3" · "entered in 2 of 3 · 5 to go" · "1st of 7" · "You're not in GW3" ·
"Provisional · updates live" · "View live race ›" · "You called it two ways" · "You called 2–0 in both" ·
"Right result" · "Exact" · "Miss" · "void in GW3" · "Counts for nothing here. You'll call it again in
GW14." · "…3 more · Sun and Mon" · "Your points differ by league this week, so each row carries its own."

Table: "Fixtures & results | Table" · "ESPN · updates 10m during matches, hourly otherwise" ·
"8 clubs between them" · "Champions League places" · "Liverpool and five others have a game in hand —
the postponed round is folded into GW14."

Match detail: "Your picks lock at the GW3 deadline, not at kickoff." · "Your calls" ·
"locks Fri 23:00 IST" **— the selected room's deadline, and every lock line names its league when the
viewer is in more than one: "Solid Yenne · locks Fri 23:00" (round-6 finding 3) [X3]** ·
**neutral deep link (`room: null`): no lock line at all — the copy is omitted, not defaulted to the
gameweek deadline** · "You're in · ante ₹100" · "You're not in GW3 yet · ante ₹100" ·
"Edit all picks → GW3 entry sheet" · "One fixture is never edited on its own — the whole gameweek is one
entry." · "The room" · "Names now, scorelines at the deadline. Then everyone's whole gameweek reveals at
once — including Sunday's fixtures on Friday night." · "Insights · reference only" · "Team news" ·
"odds 12m ago · form, H2H and table 2h ago" · "predicted · via FotMob · as of 14:20" ·
"Right now 0 pts" · "GW3 total 8 pts" · "One more Leeds goal takes you to 3 pts and 1st of 7." ·
"What-if from the current score only. Everything on this screen is provisional until the fixture is
final." · "Exact if it ends here" · "Needs a Leeds goal" · "Sorted by what each call is worth right
now." · "3 for an exact scoreline, 1 for the right result." · "ESPN · every 2 minutes · xG shows only
when the feed carries it" · "You called it two ways, so it scores two ways. Leagues never combine." ·
"Off by" · ""Off by" is the total goal miss that breaks a tie at the end of the gameweek." ·
"Odds had 2-1 at 9%. The model's top score was 1-2." · "The three below arrive on a four-hourly poll —
within about 4h of full time." · "Expected goals" · "fetched 21:48 · 1h 12m after full time · circled
shots scored" · "Player of the Match" · "Momentum · post-match only" ·
"void in GW3 — counts for nothing, predictable again in GW14".

Copy-system rules that bind Phase 4: second person, contractions, ordinals never P-numbers, signed ₹,
absolute time plus relative (never a countdown alone), "ante"/"stake" and never "bet"/"wager", Blank
Gameweek and Double Gameweek as official terms.

---

## §11 Edge cases

| # | Case | Handling |
|---|---|---|
| E-1 | Fixture has no ESPN `external_id` | Every ESPN block absent; the row still renders with FPL score/status (Phase 1's unmatched path). Test I-4. |
| E-2 | Fixture has no FotMob/Understat id | Those provider modules hide permanently and silently. No retry, no log spam. |
| E-3 | Postponed mid-live | `freeze_reason='postponed'`; blocks keep their last state; row reads "Postponed / void in GWn — counts for nothing, predictable again in GW14". On reschedule, `reconcileMatchCache` invalidates and re-arms with no operator (§4.7). |
| E-4 | FotMob 403 | `{kind:'http',status:403}`, breaker opens, FotMob modules hide, no header forging. Understat xG unaffected. |
| E-5 | FotMob shape change | `{kind:'shape'}` (proved by `-shapechange.json`), module hides, `sync_issues` row. |
| E-6 | Corrected result after FT | `reconcileMatchCache` sees the `result_revisions` row, invalidates events and stats, and the blocks refill together, so the header can never sit above stale events. A dated "Corrected result" note renders. Money regrading stays Phase 2's; Phase 4 only re-renders and re-labels. |
| E-7 | Two locked GWs overlap | Newest is current; `overlapAlert` names all of them (spec rule 2). Produced by §6.1's app-level resolver, tested by R-5, and it also suppresses the Analytics lead card (§6.6). |
| E-8 | Blank / Double Gameweek | Day grouping and the Your-GW card are driven by GW fixture membership, never by a count of 10. Official terms in copy. A blank GW produces no row, not an empty one. |
| E-9 | Deep link to a fixture in an inaccessible league | Same URL resolves to the neutral fixture: insights and no friend picks (`room: null`). No 403 page, no leak. |
| E-10 | Archived competition | Frozen read-only; standings and stats from cache, never re-polled. Deep links keep working after archiving. |
| E-11 | Odds absent | Odds row omitted; model top scores stand alone. Never zeroes. |
| E-12 | Summary carries the current-season table on an old fixture | P-1: the Table view never reads a summary. The 3-row window carries its own age so staleness is visible. |
| E-13 | Live money could disagree with the settled figure | Structurally prevented: §6.2 calls the exported engine over an as-it-stands snapshot; the all-final case is asserted byte-identical (M-4). |
| E-14 | FotMob and Understat both hold xG | `selectXg` returns exactly one tagged row (FotMob preferred), named in the UI. Never averaged (X-6). |

---

## §12 Test inventory **[R5]**

New script `"test:phase4": "vitest run tests/phase4"`; cases in `docs/testing/phase4-cases.md`, authored
from this plan.

**Where destructive tests run.** There is one shared Postgres. So, exactly as Phases 1 and 2 did:
**migration, cascade-delete and every other destructive persistence case runs only in disposable
Postgres** (`scripts/phase4-disposable-db.mjs` brings up a container, applies the full migration chain,
runs the suite, tears it down). Shared-DB checks use **scratch cache rows only**, keyed to a scratch
fixture, and delete exactly those rows. **No Phase 4 test deletes a `fixtures` row on the shared DB**
(v1's P-8 did — that is removed).

**Adapter unit tests**
- A-1…A-6 `espn-summary` blocks parsed from the three recorded payloads.
- A-7 `validateSummary` rejects a payload whose `header.id` ≠ the requested event id.
- A-8 `espn-standings` parses the `/apis/v2` payload; A-9 asserts the
  `/apis/site/v2/.../standings` string does not appear in the module.
- **F-1a/F-1b (whitelist, recursive)** `parseFotMob` and `parseFotMobCandidates` over both full raw
  payloads with forbidden sentinels injected into score, status, events, commentary and prose: no
  sentinel appears at any depth in the result; the candidate parser returns only id, date and two names.
- F-2 `parseFotMob` returns null (→ `{kind:'shape'}`) on `matchdetails-shapechange.json` without
  throwing.
- F-3 kill switch: zero network calls **and no URL constructed** when `FOTMOB_ENABLED` is unset.
- F-4 jitter: 1000 SQL draws inside [3h,5h], no suspicious mode.
- F-5 transport taxonomy: disabled / 403 / timeout / invalid JSON / shape each map to their own tag and
  their own `last_error` value.
- A-10…A-12 `understat`: match parse, league-data candidate parse, `X-Requested-With` header present.
  **A-10a…A-10e** `understatSeason`: `'2026-27'→'2026'`, century rollover `'2099-00'→'2099'`, rejects
  `'2026'`, rejects `'2026-28'`, and the built discovery URL ends `/EPL/2026/`.
- **F-1c/F-1d** fact keys: a full sentence in `key` is dropped and appears nowhere in the persisted row;
  an unrecognised key is dropped while its sibling facts still render.
- A-13…A-16 `provider-match`: exact, alias via `normalizeClubName`, date-only near-miss → null,
  one-club-only → null.
- A-17…A-20 `fpl-availability`: parse, malformed player id, malformed team id, no news at all.

**Pure read-model tests**
- U-1…U-3 `matches-tab`: identical picks → `headerPoints` set; one differing pick → `headerPoints` null
  **and every row still carries its own points**; a sat-out league still produces a row.
- **U-2a** the exhaustive row builder (§6.3a): all **66** CL0–CL10 × VP0–VP5 combinations resolved —
  **the six CL0 cells return `null` and the other 60 map to exactly one `LeagueRowView` arm** **[V4]**; no
  CTA outside CL1 with VP1/VP2/VP3 (CL1 + VP4 asserted CTA-free); no money outside
  `provisional`/`settled`; the `assertNever` branch unreachable. **U-2b** an all-CL0 input yields
  `yourGw === null` with no placeholder row. **U-2c** (round-6 finding 1) **[X1]** the CL10 → CL7
  transition through the row builder: the same contest first resolves to the `all-called-off` arm with
  `waiting: true` and the settlement-pending caption, then — once Phase 2 writes `all_fixtures_void` —
  to the `void` arm — asserting `kind` flips, `waiting` is **absent** on the CL7 arm, `voidReason ===
  'all_fixtures_void'`, `league`/`raceHref` unchanged, and **no points or money field on either arm**
  (round-7 finding 2) **[Y2]**.
- U-4 void row: no score, no points, next-GW note. U-5 pre-kickoff score is null.
- U-6 `winnersRecap` populated in the settled/not-entered cell, with pot and tiebreak. **U-6a…U-6f**
  (§6.3a): dirty-settled recomputed with no money; dirty-settled unrecomputable; dirty-void never reading
  `gameweek_entry_results`; single-entrant void; all-fixtures void; invalid viewer entry.
- **R-1…R-15 (with R-13b)** `resolveAppGameweek` (§6.1), each asserting all four output fields — R-8 a contest deadline
  snapshot earlier than the gameweek's (and GW3 **not** also `nextOpenGw`), R-9 terminal-without-result,
  R-10 no in-scope contest, R-11 an archived competition whose final gameweek is dirty, **R-12 a true-blank
  CL0 gameweek past its deadline (not current), R-13 an all-called-off CL10 gameweek **which is** current
  because Phase 2 has yet to write its `all_fixtures_void` result, R-13b the same contest once that void
  lands and it reclassifies CL7 (round-5 finding 2) **[W2]**, R-14 the loader's `cl` equals Phase
  3's `resolveContestLifecycle`, R-15 a null gameweek deadline** **[V3]**.
- **U-14a…U-14d** Analytics dirty gate: a dirty older gameweek suppresses every cumulative card and the
  lead card; `settling` suppresses the lead card only; an all-clean season shows everything;
  `overlapAlert` suppresses the lead card. **U-14f** (round-6 finding 1) **[X1]** the same CL10 → CL7
  transition through `buildAnalyticsTabView`, **parameterised over both viewer cases** (round-7
  finding 3) **[Y3]** — run once entered and once not entered, so each of the two new strip kinds is named
  by an assertion rather than a wildcard: first `currentFocusGw.state === 'awaiting_settlement'` with
  `awaiting_void_entered` / `awaiting_void_not_entered` respectively and cumulative cards still present,
  then `'settled'` with `settled_entered` / `settled_not_entered` once the void lands. A third case adds
  **CL10 plus a second unsettled gameweek**: `overlapAlert` lists both and only the lead card is
  suppressed (round-7 finding 4) **[Y4]**. A fourth case is **out of order** (round-8 should-fix 1)
  **[Z3]**: seed GW3 still CL10 and GW4 cleanly settled, assert `latestSettledGw === 4` — i.e. the pending
  gameweek sits *below* it, which v7 wrongly said was impossible — and assert every cumulative card is
  still present and reads through GW4, since GW3 contributed no played sample and no settled result.
- **U-14g** (round-7 finding 5) **[Y5]** `isGwClean` **delegates** the dirty test to Phase 3's exported
  `lib/net-balance.ts` predicate and holds no comparison of its own: stub the imported predicate to report
  dirty for one league while the gameweek's own `input_version` / `settled_version` would read clean, and
  require every cumulative card to disappear. A build that re-implemented the comparison locally would
  keep the cards and fail — which is the point of the test.
- **U-20a…U-20g** entry-sheet chips (§13 step 7): absent, present and ordered, `model_ok=false`, tap fills
  without submitting, **`model_ok=true` with an expired stamp at each of the three ladder rungs**, a
  kickoff reschedule invalidating a stamped model **via an in-place `kickoff_at` change with no
  `fixture_moves` row**, and **a null `model_source_kickoff_at` yielding no chips** **[V7]**.
- U-7…U-9 `standings-view`: compression keeps top 8 + gap + bottom 4; form dots equal matches played;
  the source line appears exactly once.
- **M-1…M-5 (live money, replacing v1's U-10)** mixed live/finished/upcoming; **live 0–0 contributes a
  real verdict** rather than being skipped; differing-league picks; all-final equals a straight
  `settleGameweek` call byte-for-byte; unstarted omitted and voids included. **M-6** no counted fixture has
  kicked off → `buildLiveInput` returns null and the row carries no money (§6.2).
- X-6a…X-6e `selectXg`: both providers present, partial row, stale FotMob (fetched before kickoff) losing
  to a valid Understat row, Understat-only fallback, and nothing valid → `undefined`.
- U-11…U-17 `analytics-math`: mirrored picks deduped by `(gameweek_id, fixture_id)`; differing mirrored
  picks resolve to the earliest-joined league; weekly labels null under 3 entrants; club reads gated at
  5; rivalry counts only shared GWs; `throughGameweek` freeze; no cross-league points sum.
- U-19 `AnalyticsTabView`: **all eight** strip variants produced from the right inputs — the six
  pre/live/settled kinds plus **`awaiting_void_not_entered` and `awaiting_void_entered`** (round-7
  finding 3) **[Y3]**; v7 still said six after §6.6 grew to eight, which left the two new kinds with no
  test claiming them. `currentFocusGw` ≠ `latestSettledGw` exercised.
- U-18 `match-detail`: recursive assertion that no present key holds a semantically empty value (X-2).
  **U-18b**: one `MatchDetailView` key per `*_ok` / `*_fetched_at` pair in §1.1 and §1.3, in both
  directions, so storage granularity and render granularity cannot drift (§6.5) — **satisfiable now that
  the single `team_stats` pair maps to the single `teamStats` key** **[V6]**. **U-18c**: the stats key is
  state-tagged — `phase='live'` with a minute and at most five stats live, `phase='final'` with a null
  minute after full time, never both. **U-18d**: built from a seeded `fixtures` row with
  `kickoff_at = null`, the DTO constructs, `header.kickoffAt === null`, the header renders "Date TBC", and
  no `model` key is present (round-5 finding 4) **[W4]**. **U-18e / U-18f** deadline scoping (round-6
  finding 3) **[X3]**: a zero-contest neutral caller builds the DTO with `room === null`,
  `header.deadlineAt === null` and no lock line; a two-league caller whose contests hold **different**
  `deadline_at` snapshots gets both in `yourCalls` and `header.deadlineAt` equal to the selected room's,
  changing when the room selection changes, **and — evaluated between the two deadlines — the room's
  entrant scorelines are revealed for the earlier league and hidden for the later one** **[Y7]**.
- C-1 `poll-due` boundary tests at T−24h, T−2h, kickoff, FT+5, FT+10, FT+30, asserted on both sides.
- C-2 exactly one ESPN network request per fixture per tick with all pollers armed.
- C-2b the same across a 10-fixture gameweek: 10 requests, not 30.
- C-3 FotMob call cap enforced with a 30-fixture backlog; C-4 the same for Understat.
- **C-5** `pollTeamNews` cadence boundaries at T−48h, T−3h and kickoff, both sides; **C-6** one FPL
  bootstrap call for a 10-fixture gameweek, not ten.

**Persistence tests** (RLS enumerated per table, not a blanket P-1…P-4 — finding 10)
- P-1 `competition_standings`, P-2 `fixture_match_data`, P-3 `fixture_provider_data`,
  P-4 `fixture_provider_ids`: `authenticated` may select; insert/update/delete refused for `anon` and
  `authenticated`.
- P-5 `provider_samples`: `authenticated` select **refused** (no policy). P-6 the same for `sync_state`,
  P-7 the same for `sync_issues`.
- P-8 `chk_xg_pair` rejects one-sided xG. P-9 `chk_provider_model` rejects a cross-labelled model.
- P-10 `(fixture_id, provider)` PK prevents duplicate provider rows. P-11
  `unique (provider, external_id)` prevents two fixtures claiming one provider match.
- P-12 (**disposable DB only**) cascade delete of a fixture removes all its cache rows and nothing else.
- P-13 partial patches: writing the stats block leaves the events block's value, stamp and flag intact.
- P-14 `frozen_at` set → poller writes skipped. P-14b `reconcileMatchCache` clears it on reschedule and
  on a new `result_revisions` row.
- P-15 `provider_samples` retains exactly 5 per `(provider, endpoint)`. P-16 a >40% byte swing writes a
  `sync_issues` row.
- P-17 breaker: 3 failures push `tried_at` 24h; 5 provider failures set `next_due_at='infinity'`.
- P-18 lease: a second concurrent poller run is skipped, not doubled; a `renew_sync_lease` returning
  false aborts before writing. **P-18b (round-8 finding 1) [Z1]** asserts all three
  `claimPhase4Lease` outcomes against real rows and that the two failures are told apart: a key at
  `'infinity'` yields `{outcome:'not_due'}`; a key due **and** holding a live `lease_until` yields
  `{outcome:'leased'}`; a due, unleased key yields `{outcome:'claimed'}` with a token. Both failure
  outcomes must leave the row byte-identical and produce zero fetches and zero writes — one assertion per
  outcome, so a helper that collapsed the two would fail.
- **P-19 = E1+E2 (static scan)**, seven planted violations asserted to fail the scan and **one input
  asserted to pass** **[R2]**:
  P-19a a banned `.from('gameweek_audit_log').update()`; P-19b a non-literal target
  (`.from(tableName)`); P-19c `claim_sync_lease` called from outside `lib/poll-lease.ts`; P-19d a direct
  `.from('sync_state').update()` bypassing the helpers; **P-19e an `insert into cashford.sync_state`
  seeding `'fpl-sync'`; P-19f an `update cashford.sync_state … where key='fpl-sync'` hidden inside a routine
  body** (the hole v3's seed-insert-only rule left open, [T1]). Plus a planted banned migration statement.
  **P-19g and P-19h (round-5 finding 1) [W1]**: P-19g feeds the scanner the migration's **own three approved
  routines — `release_sync_lease_jittered`, `arm_sync_key` and, since v10, `claim_phase4_lease`
  (round-10 finding 6) **[Z8]** — verbatim, including `where key = p_key`, and asserts the scan **passes**; v5's blanket ban on
  parameterised keys failed this, so the harness could never have run. P-19h drops one key from
  `arm_sync_key`'s hard-coded `p_key not in (…)` allowlist and asserts the scan fails on the set comparison
  against `PHASE4_SYNC_KEYS`.
- **P-20 = E3 (quiescent diff)**, disposable DB: all Phase 4 pollers run against a quiescent data set;
  the protected set is **derived at run time** from `information_schema.tables` as
  `allBaseTables(cashford) − FULLY_ALLOWED − {'sync_state'}` — **`sync_state` is subtracted from the
  whole-table comparison, not merely re-checked afterwards (round-4 finding 1) [V1]**. Each protected
  table's count and checksum are unchanged. `sync_state` is then checked **row-wise instead**: every row
  whose key is **not** in `PHASE4_SYNC_KEYS` is snapshotted and asserted byte-unchanged — a Phase 4 bug
  must not be able to reschedule or disarm `fpl-sync`. The two checks are disjoint by construction, so a
  valid lease claim and release (which must move Phase 4's own nine rows) cannot fail P-20. v4 described a
  whole-table check over "every `cashford` table minus the seven fully-allowed ones", which includes
  `sync_state`; a later row-scoped assertion cannot undo a whole-table failure, so the test would have gone
  red on correct behaviour. P-20b pins the subtraction directly: the enumerated protected set is asserted
  **not** to contain `sync_state`.
- **P-21 = E4**: the four golden engine files match their pre-Phase-4 hashes.
- **P-22 concurrency**: `apply_score_update` and a `pollMatchData` upsert on the same fixture, both
  interleavings, no deadlock, correct results (the reworded lock claim in §0.1).
- D-1…D-4 per-block degradation: each ESPN block disappears alone while the others stay visible.
- **P-23 rollout script** (disposable DB): `scripts/phase4-rollout.mjs` moves every launch-enabled Phase 4
  key from `infinity` to due-now, **leaves `fotmob_slow` at `infinity`** (asserted explicitly), touches no
  non-Phase-4 `sync_state` row, and `--revert` restores the seeded state exactly. `--dry-run` writes
  nothing.
> ## ⚠ CARVE-OUT — RO-1 and RO-2 are an implementation-time contract, not plan contract
>
> **Everything else in this plan is contract. This cluster is not.** The review loop closed at round 11
> with RO-1/RO-2 still Partial, and two of the three findings were defects in v11's own new text — the
> point at which more plan prose stops paying for itself. Under **decision #34** the cluster becomes a
> **contract written at implementation time**, against real code, and reviewed as its own slice.
>
> **The three round-11 findings, verbatim in substance:**
>
> 1. **RO-1's write sets are still incomplete — the `provider_samples` class.** A successful FotMob
>    response must enter `provider_samples` so §1.6 can retain five samples and compare payload sizes, and
>    that insert (plus any retention delete) falls outside the FotMob cell's asserted write set. A correct
>    sampled run therefore fails RO-1; suppressing the sample makes P-15/P-16 and the shape monitor false.
>    This is a **carry-over**: v11 fixed the `sync_state` instance of the same class and missed this one.
> 2. **RO-2's `updated_at` attribution is unsound.** All six named columns exist, but each is declared
>    `default now()` — **no trigger advances it on update**, and a deleted row cannot be found by a
>    post-run timestamp query. A faulty Phase 4 update that omits the column, or a protected-row deletion,
>    passes part (a); those six tables are excluded from part (b)'s checksums, so RO-2 passes anyway.
>    **NEW in v11.** The claim that the row-level test "actually attributes" protected writes is false:
>    the schema provides creation defaults, not change tracking.
> 3. **RO-2 is not executable as written.** No approved routine returns the poller's database-clock start
>    or finish — `claim_phase4_lease` returns `(outcome, token)`, the release routines return booleans, and
>    no clock RPC exists; the Supabase caller cannot issue a raw `select clock_timestamp()` and E1 rejects
>    an unapproved RPC. Part (c)'s quiescence is also insufficient: `pollScores` reports
>    `{fetched, updated, resolved}`, not "zero live matches", and zero score/settlement counts do not rule
>    out writes by `syncFpl`, knockout resolution, contest locking, legacy settlement or gameweek
>    maintenance. **NEW in v11.**
>
> **Binding requirement at implementation.** Before any rollout runs:
>
> 1. **Enumerate every RO-1 write set from the actual poller code** — read each poller and list what it
>    writes, rather than deriving the list from this plan. `provider_samples` is the known miss; the point
>    of reading the code is to catch the ones nobody has named yet.
> 2. **Design RO-2's attribution mechanism against the real tick response**, once that response exists —
>    including how a database-clock boundary is obtained through an approved routine, exact before/after
>    snapshots over **all** protected tables (not only the ones without `updated_at`), coverage of deletes,
>    and a zero-write predicate for every earlier writer in the tick.
> 3. **Review that contract adversarially as its own slice**, the same way this plan was reviewed.
>
> **Gate: no key may be armed — no `scripts/phase4-rollout.mjs --key <name>` — until the carved-out
> contract is written and passes that review.** The RO-1/RO-2 prose below and in §13 step 4 is left
> unedited on purpose: it is the starting point implementation revises, not a specification to follow, and
> this box supersedes it wherever the two disagree.

- **RO-1 the key actually gates its caller** (round-6 finding 2, restated round-7 finding 1) **[X2]**
  **[Y1]** — run once per key against the **deployed** build, immediately before that key is armed.
  **v7 asserted this from absence, which is not evidence:** `sync_state` has five columns
  (`key`, `last_run_at`, `next_due_at`, `lease_until`, `lease_token`) and **no attempt or failed-claim
  field at all**, so nothing "records a failed claim" — a rejected claim leaves the row byte-identical.
  Worse, a *direct* caller with nothing due would also fetch nothing and write nothing, passing the
  assertion while ignoring the lease entirely. RO-1 therefore requires **positive evidence from the
  deployed code**, and the poller contract changes to supply it:
  - **Every Phase 4 poller returns an explicit lease outcome** — `{ lease: 'claimed' | 'not_due' |
    'leased', fetches: number, writes: number }` — and the cron route includes it per poller in its JSON
    response, alongside the counts it already returns. The three values are exactly `claimPhase4Lease`'s
    three outcomes (§4.6) **[Z1]**; a caller that never claims cannot emit the field at all.
  - **RO-1 has two halves, and they run in different places (round-9 finding 2) [Z6].** The **negative**
    half runs on the shared production DB against the deployed build: with the key at `'infinity'`, one
    real tick must report `lease: 'not_due'` with `fetches === 0` and `writes === 0`. It is safe there by
    construction — a dark poller writes nothing, so the check needs no seeding at all. The **positive**
    half runs on a **disposable backend wired to the exact deployed artifact** (the same build SHA, the
    same env, a container DB from the full migration chain): seed that poller's due state, arm the key, run
    one tick, assert `lease: 'claimed'` with that key's positive signal, then tear the container down.
    v9 put the positive half on the shared DB, which cannot be done: making a poller due means inserting or
    updating a `fixtures` row, and `fixtures` is a shared reference table — league scoping does not isolate
    it, so "scratch fixture" was never scratch. **The scratch-rows-only rule wins; RO-1 moves.**
  - **The setup and the positive signal are per key, not one recipe (round-8 finding 2) [Z2].** v8
    prescribed "seed a fixture, expect `fetches >= 1`" for all nine keys, which is unrunnable for three of
    them: `deriveStandings` is settlement-driven and makes no provider request, `reconcileMatchCache` is
    cache-only and never fetches, and `pollStandings` is competition-scoped, so no fixture makes it due.
    Each cell below is the **positive** half, on the disposable backend; each states its own teardown,
    which is the container itself plus an explicit assertion that no row outside the listed write set
    changed.

    **Every write set includes that key's own `sync_state` row (round-10 finding 4) [Z8].** v10 listed
    cache writes only, while a correct run *must* write `sync_state` twice — `claim_phase4_lease` sets
    `lease_until`, `lease_token` and `last_run_at`, and the release clears the lease and advances
    `next_due_at`. Under v10's own "no unlisted change" rule all nine cells would have failed on correct
    behaviour. So each cell's write set is **that key's `sync_state` row, plus the rows named below, and
    nothing else** — and P-20's rule still holds that no *other* key's row may move.

    | Key | Made due by | Positive signal after arming | Write set asserted |
    |---|---|---|---|
    | `espn_insights`, `espn_match_data`, `espn_commentary` | a fixture placed inside that poller's §4.1 window | ESPN request counter (§2.2) `>= 1` | that fixture's cache row only |
    | `team_news` | a fixture inside T−48h…kickoff, **with the FPL team mappings its two clubs need** — the poller reads availability per FPL team id, so an unmapped club yields no news and a silent zero [Z8] | **team-news provider counter** `>= 1` — this poller fetches **per league, not per fixture** (§4.9), so the counter is its own and the write set is *every* due fixture in that league, which the cell enumerates up front | all due fixtures of the seeded league |
    | `understat_xg` | a post-FT fixture past FT+2h | Understat request counter `>= 1` | the fixture's xG row **plus any provider-id rows discovery writes** — discovery spans fixtures by design (§4.8), so the cell asserts the id-write set explicitly rather than "one fixture" |
    | `espn_reconcile` | a cache row whose `source_kickoff_at` deliberately mismatches its fixture | `writes >= 1`, the mismatched row invalidated (§4.7), **and `fetches === 0`** — asserting the zero is the point for a cache-only poller | that cache row only |
    | `espn_standings` | competition scope, no fixture; due by cadence | ESPN request counter `>= 1` | one `competition_standings` row |
    | `derived_standings` | a settled gameweek in the harness's own fixture set | `writes >= 1` — a `derived` fallback row appears; `fetches === 0` | one `derived` standings row |
    | `fotmob_slow` | a post-FT fixture with `FOTMOB_ENABLED` set in the harness env (D7 keeps it unset in prod) **and a seeded `fixture_provider_ids` row for it (round-10 finding 4) [Z8]** — E-2 says an unmapped fixture is never polled, so without the mapping the counter stays 0 and the cell would fail on correct behaviour. Seeding the id is the cheaper of the two options; the alternative, driving discovery, would make the cell depend on a second provider | **FotMob request counter** `>= 1` and the slow-provider block written for that fixture | that fixture's slow-provider block only |

    **`fotmob_slow` has no production cleanup because it has no production run.** D7 keeps it dark and
    unarmed at launch; its RO-1 positive cell exists only on the harness. If Ananth later arms it, the
    negative half runs in prod first like every other key, and the post-arming observation below is what
    covers it thereafter — there is nothing to clean up in either case, because Phase 4 never seeds a
    production fixture.

  - **The scratch-rows-only rule is absolute (round-8 finding 2, tightened round-9) [Z2][Z6].** §12's
    shared-DB rule wins over RO-1 without exception: on the shared DB a Phase 4 test may create and delete
    only scratch **cache** rows, and may not insert, update or delete a `fixtures` row, a contest, a
    competition's standings or any protected row — that is the Phase 1 prod-write lesson, and a test's
    convenience does not reopen it. Anything RO-1 needs beyond that runs on the harness. P-20's row-wise
    `sync_state` snapshot still applies everywhere: RO-1 may move only Phase 4's nine keys.

- **RO-2 post-arming observation (round-9 finding 2) [Z6]** — runs in **prod**, immediately after each
  `--key` arming, and is the phase's prod-truth evidence now that RO-1's armed half sits on the harness.
  Watch one real tick and assert (a) that key's `sync_state` row advanced — `last_run_at` moved and
  `next_due_at` is in the future — and (b) that **the target poller** changed no protected row. It seeds
  nothing and deletes nothing; it is a read plus two comparisons. A failure means `--revert` before the
  next key (§13 step 4).

  **The checksum window is the poller's, not the tick's (round-10 finding 5) [Z8].** v10 bracketed the
  whole tick, which is wrong: the same real tick runs FPL reconciliation, `pollScores`, `lockDueContests`
  and both settlement paths before Phase 4 ever starts (`app/api/cron/tick/route.ts`), and every one of
  those legitimately writes a protected table. A concurrent user pick does too. A whole-tick bracket
  therefore fails on correct behaviour and forces a needless `--revert`, so it cannot prove the
  requirement. Two mechanisms replace it, and RO-2 needs **both**:

  1. **Attribution by window, where the schema supports it.** The deployed tick response reports, per
     Phase 4 poller, the `clock_timestamp()` it started and the one it finished — its own timestamps,
     taken inside its own call, alongside the §4.6 result contract. For the protected tables that carry
     an `updated_at` column — `fixtures`, `predictions`, `gameweek_entries`, `gameweek_picks`,
     `knockout_predictions`, `knockout_brackets`, all verified against the migrations — RO-2 asserts **no
     row carries an `updated_at` inside the target poller's `[started, finished]` window**. Writes by the
     earlier stages of the same tick stamp their own transaction times, which fall outside it. This is
     the assertion that actually attributes, and it covers `fixtures`, the table Phase 4 is most likely
     to damage.
  2. **Attribution by exhaustion, for the rest.** Protected tables **without** an `updated_at` column —
     `contests`, `gameweek_contests`, `contest_results`, `transfers`, `result_revisions` and the other
     engine tables — get the before/after checksum, and a moved checksum is *not* an automatic revert.
     The operator must explain it from the tick's own per-stage counters, which the response already
     carries: a moved `contests` checksum with `lockDueContests` reporting a non-zero lock count is
     explained; the same move with every earlier stage reporting zero is not, and means `--revert`. A
     Phase 4 poller cannot write these tables at all under X-1, so "unexplained" is the whole signal.
  3. **Quiescence, to make (1) and (2) sharp.** Arm during a window with no live fixture and no gameweek
     awaiting settlement, and confirm it from the tick's own response — `pollScores` reporting zero live
     matches and the settle step zero gameweeks — before trusting the run. Under quiescence the earlier
     stages write nothing, so almost every protected checksum should be flat and step 2's explanation
     list is short.

  What this does **not** claim: it cannot exclude a concurrent user write that lands inside the same
  window — a pick saved at that second stamps `predictions.updated_at` inside it. That is why (1) is
  row-level rather than a checksum: the operator sees *which* row moved and whether a Phase 4 poller
  could have written it under the X-1 allowlist, and only a row inside the allowlist's blast radius means
  `--revert`. Nor is `updated_at` a trigger — a writer that forgets to set it would escape (1), which is
  why (2)'s checksums still run over the tables that have no such column and P-20's exact diff still runs
  on the harness. The exact whole-schema comparison stays where it can be exact: E3 and P-20 on the
  quiescent harness, where nothing else runs. RO-2 is corroboration in prod, not a substitute for it.
- **P-24 routine privileges**: `release_sync_lease_jittered` has **no** EXECUTE for `public`, `anon` or
  `authenticated` (queried from `information_schema.routine_privileges`), and does have it for
  `service_role`. A `security definer` routine callable by `authenticated` would let any logged-in user
  reschedule any poller.
- **P-25 invalid bounds**: `(0,0)`, `(-5,10)` and `(600,60)` each raise, and `sync_state` is unchanged
  after each attempt.
- **P-26…P-29 `arm_sync_key`** (§1.7a) **[T1]**: P-26 arming `'fpl-sync'` raises and leaves the row
  untouched; P-27 `anon` and `authenticated` have no EXECUTE while `service_role` does, read from
  `information_schema.routine_privileges`; P-28 a row holding a `lease_token` is not rescheduled; P-29
  arming then disarming a Phase 4 key round-trips to `infinity`.
- **P-30…P-36 `claim_phase4_lease`** (§1.7c), registered here in v11 — v10 wrote them into §1.7c prose and
  never listed them in the inventory (round-10 finding 6) **[Z8]**. Persistence, disposable Postgres:
  **P-30** a due unleased key returns `claimed` with a token and sets `lease_until` / `lease_token` /
  `last_run_at`; **P-31** a key at `'infinity'` returns `not_due` and leaves the row byte-identical;
  **P-32** a due key holding a live lease returns `leased` and leaves the row byte-identical;
  **P-33** two sessions claiming at once yield exactly one `claimed`, the other `leased`, never two
  `claimed` and never `not_due`; **P-34** the six lock-order cases, one assertion per order, with
  **P-34b** the wait-longer-than-the-lease case that `clock_timestamp()` fixes; **P-35**
  `claim_phase4_lease('fpl-sync', …)` raises and writes nothing; **P-36** `PUBLIC`, `anon` and
  `authenticated` have no EXECUTE and `service_role` does, read from
  `information_schema.routine_privileges`.

**Browser tests** — transport and cells **[R2]**

**Transport: `chrome-devtools-axi` with a QA-account login.** Every case below runs signed in as
`ananth@cashford.internal` on `https://cashford-staging.vercel.app`, driven by `chrome-devtools-axi`. This
corrects two things at once. Sol's round-2 fix said these screens need Ananth's real Chrome; they do not —
Phase 1's browser acceptance logged this QA account in through `chrome-devtools-axi` and passed. And the
repo's `CLAUDE.md` line that authed screens require `claude-in-chrome` is out of date for this account. So:

- One session per worker, isolated by `CHROME_DEVTOOLS_AXI_SESSION=worker-<n>`, so parallel cases cannot
  fight over one cookie jar.
- **Never Ananth's real Chrome profile**, and never a real-league write — B-0 stands.
- The unsigned/throwaway browser is kept for **public and logged-out checks only**: the login screen, a
  logged-out deep link, and the neutral fixture page.

- B-0 never write to Solid Yenne Boys, KK Bois, PES Bois — view-only, asserted first.

**B-1…B-6 — the six Matches-tab cells** (rows: pre / live / settled × not-entered / entered)

| # | Cell | Seed state | Main assertions |
|---|---|---|---|
| B-1 | **Pre · not entered** | GW open, deadline ahead, viewer has no entry in any league | "Enter GW*n*" CTA per league; no scores (dashes, never 0–0); no points column; insights mark on fixtures with warm `fixture_insights`; no money anywhere |
| B-2 | **Pre · entered** | Same GW, viewer entered 2 of 3 leagues | Your-GW card reads `2 of 3`, `toGo=1`; entered rows show "Edit picks", the third shows "Enter"; **the viewer's own scoreline renders on each entered row** (own picks are never hidden from their author) and **no friend's pick appears at all — no scoreline and no `•–•` placeholder**, because the hub has no room block to reveal (round-3 finding 8) **[T8]**; still no money |
| B-3 | **Live · not entered** | One fixture in play, viewer entered nothing | Minute + LIVE on the live row; `yourCall: none` on every row; no provisional footer *(the Analytics-strip assertion moved to B-9, which is the Analytics cell for this state — [T8])* |
| B-4 | **Live · entered** | Two fixtures final, one live at 1–0, one unstarted | Row points render; card shows **provisional money counting the live 1–0** ("as it stands"), one footer not one per row; unstarted fixture contributes nothing (M-1) |
| B-5 | **Settled · not entered** | GW settled cleanly in all leagues, viewer sat out | `winnersRecap` renders per league with pot and winner names; the `tiebreakUsed` line appears when not `'none'`; no own points, no own money |
| B-6 | **Settled · entered** | Same GW, viewer entered all leagues | Per-pick Exact/Result/Miss verdicts; settled net per named league; "View league recap" and "Share my calls" CTAs; no cross-league money total |

**B-7…B-12 — six of the eight Analytics cells** (the 3 × 2 grid, driven by `strip`). The two `awaiting_void_*` cells §9.1 added in round 6 **[X1]** are covered by **U-14f** rather than a browser case: staging cannot be made to call off a whole gameweek on demand, and the assertion that matters is the state transition, not the pixels.

| # | Cell | Seed state | Main assertions |
|---|---|---|---|
| B-7 | **Pre · not entered** | GW1 not yet open, no history | `pre_gw1` empty state with its CTA; **no zeroed cards**, no skeletons |
| B-8 | **Pre · entered** | GW*n* open and entered, 4 settled GWs behind | Strip `pre_entered` shows `entered/of`; every card computed `throughGameweek = latestSettledGw`, not the open GW |
| B-9 | **Live · not entered** | Fixtures in play, viewer sat this GW out | **Strip is `live_not_entered`** (moved here from B-3, [T8] — the strip belongs to the Analytics tab, so its assertion belongs to the Analytics cell); cards unchanged from B-8's values — **live weeks move nothing but the strip** |
| B-10 | **Live · entered** | Fixtures in play, viewer entered | Strip `live_entered` with its race link; still no provisional analytics |
| B-11 | **Settled · not entered** | GW just settled, viewer sat out | Strip `settled_not_entered`; no lead card (nothing was won); **every card that depends on the viewer's own participation is byte-identical to its pre-settlement value** — `myForm`, `receipts`, `habits`, season net, **`rivalry`** *and* **`vsRoom`** — because a gameweek the viewer did not enter produced no sample of theirs, and a delta whose left-hand side cannot move is not allowed to move because its right-hand side did; **the only thing that advances is `weeklyLabels` for that gameweek**, computed from entrants' results and never from the viewer's (round-4 finding 8) **[V8]**. **v5's "league-lens room table" assertion is removed (round-5 finding 5) [W5]**: `AnalyticsTabView` has no room-table key — §9.2 defines "You vs the room" as differences, and the per-member points-and-net table is Phase 3's race screen — so the assertion named a field the test could never have read. **`rivalry` is explicitly byte-identical** — §6.7 gates it on GWs **both** users entered, so a sat-out gameweek cannot enter the sample; v4 listed it as advancing, contradicting its own gate. v3 before that said "cumulative cards advance", which would have certified a personal average moving on a week the viewer sat out |
| B-12 | **Settled · entered** | GW just settled with the viewer in the money | Lead card pinned with points, pot per league, exacts, biggest gain and biggest miss; reopening the tab after acknowledging unpins it (D8 `localStorage`) |

- B-22 **dirty suppression on screen**: re-settle an older gameweek on staging so
  `input_version > settled_version`, then assert the lead card and every cumulative Analytics card are
  **absent** with the caveat line present, and that the Matches row renders `recalculating` with no money
  (§6.3a, §6.6).
- B-13 pick reveal: before the deadline, names + placeholders; after, scorelines — **run across two
  leagues with divergent contest deadlines (round-7 should-fix 1) [Y7]**: at a moment between the two,
  the earlier league shows scorelines and the later one still shows placeholders, and switching rooms
  flips the reveal state without a reload.
- B-14…B-16 match detail in all three states, in the mockup's block order.
- B-17 with FotMob dark, no xG/ratings/momentum module appears and no empty container is left — **while
  Understat-sourced xG does render**, named as Understat.
- B-18 Table compressed with the source line, light and dark.
- B-19 a module below its gate is absent, not empty.
- B-20 deep link to a fixture in an inaccessible league renders neutral with no friend picks.
- B-21 dark and light correct on every new screen.

**Integration**
- I-1 a full cron tick with **all launch-enabled pollers armed and FotMob dark** completes, writes cache
  rows, and leaves **both** settlement outputs identical to a tick with the new pollers dark — the legacy
  `settles` **and** Phase 2's `gwSettles`, compared key by key — with the step order asserted as
  `gameweekMaintenance → dispatchGameweekSettlements → pollInsights → Phase 4` and nothing between the
  first two (the X-1 end-to-end check) **[T2]**.
- I-2 a poller that throws is captured into the response body and does not abort the tick.
- **I-3 Understat fallback with `FOTMOB_ENABLED` off**: discovery finds an id, `pollUnderstat` stores
  xG, and the match page renders it labelled Understat.
- **I-4 ESPN-unmatched fixture**: the row renders from FPL score/status with every ESPN block absent.
- I-5 postpone → reschedule → play: blocks refresh with no operator action.
- I-6 final → corrected result: header, events and stats move together with a dated note. **I-6a** ESPN
  still stale after the correction: blocks stay hidden, nothing marked valid. **I-6b** the next tick
  carries the corrected score: every block re-enables in one write. **I-6c** three stale reads raise
  `sync_issues` kind `'provider_stale_result'` — one row, not one per tick. **I-6d** a correction arriving
  after FT but **before** the FT+30 freeze, `frozen_at` still null, is reconciled on the same tick. **I-6e**
  `stale_result_reads` reaches 3 across three separate invocations against the same disposable database.
  **I-6f** a future `stale_retry_at` makes the next tick skip the fixture and leave the counter alone.
  **I-6g** one matching write resets the counter to 0 and `stale_retry_at` to null.
- **I-8 team news**: an injured player renders on the card; after the FPL snapshot flips them to available
  with empty news, the next tick removes them, and the card disappears entirely when they were the only
  entry — proving wholesale replacement rather than a merge. **I-8b** a successful pass with nothing to
  report stores SQL `null` (never `'[]'`) with `team_news_ok = true` and renders no card. **I-8c** a
  malformed bootstrap over an existing good value leaves value and stamp byte-identical, flips
  `team_news_ok` to false, and removes the card.
- **I-7 mocked FotMob suite** (separate from I-1, since FotMob ships dark): with a recorded payload
  served by a local mock and the flag on, xG, shots, ratings, PotM and momentum all persist and render.

---

## §13 Sequencing

1. **Adapters first, no DB.** `espn-summary`, `espn-summary-fetch`, `espn-standings`, `fotmob`,
   `understat`, `provider-match`, `fpl-availability`, `poll-due`, plus recorded fixtures and every
   adapter unit test. Zero prod risk; can start while the Phase 1 migration gate is blocked.
2. **The write-safety harness** (E1 static scan, E2 migration inspection, E3 quiescent check, E4
   hashes) — built before the migration, so it gates everything after it.
3. **Migration** `20260728000001_match_data_v2.sql` with every poller dark. Assume a human gate on prod
   DDL.
4. **Pollers, one at a time**, each observed for a full cycle before the next is armed:
   **`pollInsights`** → `pollStandings` → `deriveStandings` → `reconcileMatchCache` → `pollMatchData` →
   `pollCommentary` → **`pollTeamNews`** → **`pollUnderstat`**. **`pollInsights` leads the order and is
   named explicitly (round-4 finding 2) [V2].** §0.1 makes `espn_insights` Phase 4's ninth key and §1.7
   seeds it at `infinity` like every other Phase 4 key. v4's step 4 omitted it, so following that sequence
   literally would have left odds, the model, form, H2H and the table window unrefreshed for the whole
   rollout, and taken the entry-sheet chips down with them. It is armed first because it is the one poller
   whose behaviour is already known in production, which makes it the cheapest cycle to observe.

   **A dark key controls nothing until the caller reads it — v6's claim that seeding `infinity` makes the
   existing insights poller dark at migration time was false (round-6 finding 2) [X2].** Verified against
   the shipped code: `app/api/cron/tick/route.ts` imports `pollInsights` from `lib/espn-insights.ts` and
   calls it directly, and `lib/espn-insights.ts` contains no reference to `sync_state` anywhere. So on the
   day the migration lands, `espn_insights.next_due_at = 'infinity'` is an inert row: the old poller keeps
   running on every tick, and `--revert` cannot stop it. Two consequences, both deliberate:
   - **The old poller stays live through the migration**, which is the safe state — insights keep
     refreshing exactly as they do today while the new tables sit empty. Nothing about the ESPN insights
     product changes at migration time.
   - **`espn_insights` is armed only after the lease-gated rewrite deploys** — that is, after
     `pollInsights` claims through `claimPhase4Lease('espn_insights')` and returns early when the claim
     fails. Arming before that deploy would be theatre: the row would move, the caller would not notice,
     and the "observed cycle" would prove nothing. The same rule holds for every other key: arm a key only
     once the deployed code path for it goes through the lease.
   > **⚠ CARVE-OUT applies to RO-1 and RO-2 below.** Both are an **implementation-time contract under
   > decision #34**, not plan contract — see the carve-out box above §12's RO-1 for the three round-11
   > findings and the binding requirement. **No key may be armed until that contract passes review.** The
   > text below is the starting point, left unedited on purpose.

   - **Rollout assertion RO-1** gates the arming step, and it asserts a **reported** outcome rather than
     an absence (round-7 finding 1) **[Y1]**. Every Phase 4 poller returns
     `{ lease: 'claimed' | 'not_due' | 'leased', fetches, writes }` — the three outcomes of §4.6's
     reason-bearing claim, classified inside `claim_phase4_lease` **[Z1][Z5]** — and the cron route
     surfaces it per poller. **The negative half runs in prod, the positive half on the harness
     (round-9 finding 2) [Z6]:** with `espn_insights.next_due_at = 'infinity'`, one real prod tick must
     report `lease: 'not_due'`, `fetches === 0`, `writes === 0` — no seeding, safe by construction, and a
     deployed caller that ignores the lease cannot produce the field at all. The armed half runs on a
     disposable backend wired to the **same build artifact**, with that key's own due setup and positive
     signal (§12 RO-1). Nothing seeds a production `fixtures` row, ever.
     `sync_state` is **not** consulted for proof of the failed claim: its five columns hold schedule and
     lease state only and record no attempt (§12 RO-1). Only a passing RO-1 — both halves — permits
     `--key espn_insights`; a failing negative half means the old direct caller is still deployed and the
     key is not yet a switch. The same pair runs per key before each later arming.
   - **Rollout assertion RO-2 — the post-arming observation, in prod (round-9 finding 2) [Z6].** Moving
     the positive half to a harness would otherwise cost us prod truth entirely, so it is recovered
     immediately *after* arming, where it is safe: the operator watches **one real tick** and asserts
     (a) **that key's `sync_state` row advanced** — `last_run_at` moved and `next_due_at` is in the future,
     which is what a poller that actually claimed and released leaves behind — and (b) **that the target
     poller changed no protected row**, judged over that poller's own `[started, finished]` window and
     not over the whole tick (round-10 finding 5) **[Z8]** — the same tick legitimately runs
     reconciliation, score polling, locking and settlement first, so a whole-tick bracket would revert on
     correct behaviour. §12 RO-2 states the three-part mechanism (window, exhaustion, quiescence).
     RO-2 is an observation, not a seeding step: it creates nothing and deletes nothing. A
     failing RO-2 means `--revert` immediately, before the next key. Together the two assertions bracket
     the switch — RO-1 proves the key is a real switch and the poller is inert while dark, RO-2 proves the
     live poller does its work and nothing else.

   Arming is `scripts/phase4-rollout.mjs --key <name>` (§1.7b) —
   never an edit to the migration, and never all at once. **This is not a staging-versus-prod gate**: one
   database serves both (§1.7b), so "one at a time, watch it, `--revert` if it misbehaves" is the actual
   containment. `pollSlowProviders` (FotMob) is written and tested against the I-7 mock but **stays
   dark**.
5. **Pure read models** with their tests: `gw-live-money` (no engine refactor), `matches-tab`,
   `standings-view`, `match-detail` + `match-blocks`, `analytics-math`, `analytics-view`.
6. **Loaders, then UI:** Matches tab first (highest traffic, exercises the whole pipeline), then Table
   (which also lights up the league Table tab slot Phase 3 left), then match detail, then Analytics.
7. **Entry-sheet chips — wired here, explicitly. Nothing is free (round-2 finding 9).** v2 claimed the
   chips light up on their own once PL insights are warm. They do not. Phase 3's D-EN5 is explicit: the
   entry page **does not query `fixture_insights` at all**, `ScoreChips` **is not mounted**, and the
   shipped mapper is `chipsForFixture(topScores: ScoreProb[]): ScoreChip[]` — it takes the model's score
   probabilities, not an insights row. So Phase 4 does four concrete things:
   1. **Loader:** extend the entry-sheet loader to read `fixture_insights` for the gameweek's fixtures in
      one batched query (service-role read, already in §6.8's enumerated list), returning
      `Map<fixtureId, InsightsView>`.
   2. **Map:** for each fixture, gate on `modelUsable(row, fixture, now)` — defined below, not merely
      `model_ok` and a non-null stamp — pull `topScores` out of `mapInsightsView`, and pass **that array**
      through the existing `chipsForFixture`. No new mapper, no signature change — Phase 3's function stays
      as tested.
   3. **Mount:** render `ScoreChips` in the entry row, above the scoreline steppers, per the mockup.
      A fixture with no chips renders **no chip row at all** (X-2), not an empty strip.
   4. **Never a default:** tapping a chip fills the steppers; it does not submit, and it is not
      pre-selected. A model suggestion must never become a pick the viewer did not make.

   **`modelUsable` — the staleness rule v3 never wrote (round-3 finding 7) [T7].** v3 gated on `model_ok`
   plus a non-null `model_fetched_at`, which is not a freshness test: a timestamp from six days ago is
   non-null. Chips are the most persuasive thing on the entry sheet — a viewer taps 2-1 because the model
   said so — so a stale model must show nothing rather than an old suggestion presented as current. A model
   row is usable only when **all three** hold:
   1. `model_ok = true` **and** `model_fetched_at` is not null;
   2. the stamp is inside **the same pre-kickoff age ladder the odds/model poller runs on** (§4.1: 6h
      outside T−24h, 1h from T−24h, 10m from T−2h), with **one missed cycle of tolerance** —
      `now() - model_fetched_at <= 2 × ladderInterval(fixture.kickoffAt, now)`. One skipped tick from a
      throttle or a breaker must not blank the chips; a sustained outage must;
   3. **`model_source_kickoff_at` equals `fixtures.kickoff_at` exactly** — a kickoff reschedule invalidates
      the model, because the odds it was built from were priced for a different match date. The comparison is
      `=` on two timestamps, not a range test, and a null on either side fails it (an un-backfilled row and a
      postponed fixture both mean "no usable model").

      **This replaces v4's `fixture_moves` comparison, which could never have worked (round-4 finding 7)
      [V7].** `fixture_moves` records **gameweek-membership** moves — its columns are `old_membership_id`
      and `new_membership_id` (the `fixture_moves` declaration) — and nothing writes a row
      there when `fixtures.kickoff_at` changes in place, which is the ordinary FPL reschedule. There is no
      `kickoff_changed_at` stamp in the schema either, and Phase 4 does not add one: a new stamp on
      `fixtures` would be a write to a table outside the §0.1 allowlist, and inferring "last change" from a
      history table that does not record the change is not a freshness rule. Storing the kickoff **with the
      model** and demanding exact equality needs no history at all — the model either describes the match as
      currently scheduled or it does not. `pollInsights` writes `model_source_kickoff_at` in the same
      statement as `model_fetched_at`, so the two cannot disagree.

   `ladderInterval` is the **one** function the poller and this gate share, exported from `lib/insights-
   cadence.ts`, so cadence and staleness can never disagree — if the poller aims to refresh every 10
   minutes, 20-minute-old chips are stale by construction, with no second constant to keep in step.

   Tests: U-20a chips absent for a fixture with no insights row; U-20b chips present and ordered
   most-likely-first from a warm row; U-20c `model_ok = false` yields no chips even though the row exists;
   U-20d a chip tap fills the steppers without submitting; **U-20e** `model_ok = true` with a
   `model_fetched_at` **outside** the ladder window for the fixture's bucket yields **no chip row** — with
   the three boundary cases asserted (inside one interval → chips; between one and two → chips, the
   tolerance; beyond two → none) at each of the three ladder rungs; **U-20f** a kickoff reschedule after the
   model was stamped yields no chips until the next refresh — **`fixtures.kickoff_at` is mutated in place with
   no `fixture_moves` row written, which is what an FPL reschedule actually looks like, so this case fails
   against v4's rule and passes against the `model_source_kickoff_at` equality** **[V7]**; **U-20g** a row whose
   `model_source_kickoff_at` is null (the un-backfilled state) yields no chips. Browser B-23 in light and dark, plus the absent
   case and **a stale-model case where `model_ok` is true but the stamp is expired and the chip row is
   absent from the rendered entry sheet**, on the staging entry sheet.
8. **Integration + browser pass** on staging with FotMob dark.
9. **FotMob enablement is a separate, explicit human decision** (D7), taken after all of the above is
   green and reversible in one env change.

---

## §14 Acceptance criteria

- **A.** All twelve browser cells (6 Matches + 6 of the 8 Analytics states) render correctly on staging,
  dark and light, with copy matching §10 verbatim. The two `awaiting_void_*` Analytics states are proved
  by U-14f instead **[X1]** — they cannot be seeded on staging without calling off a real gameweek.
- **B.** Match detail renders all three states in the mockup's block order, every module naming its
  source and the age of its data.
- **C.** With FotMob dark, no page shows an empty module, a zero, a skeleton or a "data unavailable"
  row — **and Understat-sourced xG does render**, labelled Understat (B-17, I-3).
- **D.** Live money on the Matches card counts in-progress fixtures at their current score, and equals
  the settled net once the GW settles — M-1…M-5 plus one observed end-to-end staging case.
- **E.** The four golden engine files are byte-identical; the full Phase 1 and Phase 2 suites pass
  unchanged; the write-safety harness (P-19…P-21) and the concurrency test (P-22) are green; and the
  routine tests **P-24…P-36** are green, including **P-30…P-36** for `claim_phase4_lease` — its three
  outcomes, the six lock orders, the rejected `fpl-sync` key and the privilege grants (round-10
  finding 6) **[Z8]**.
- **F.** A full cron tick with **all launch-enabled pollers armed and FotMob dark** stays inside its
  budgets, makes exactly one ESPN request per fixture, and produces **both settlement outputs identical to a
  tick with the new pollers dark — the legacy cup `settles` **and** Phase 2's `gwSettles`**, compared key by
  key **[T2]**. v3 said "settlement output" without naming which, so it would have passed with gameweek
  settlement missing from the chain entirely. The tick's step order is asserted to be
  `… → gameweekMaintenance → dispatchGameweekSettlements → pollInsights → Phase 4 steps`, with nothing
  inserted between maintenance and settlement. The separate mocked FotMob suite (I-7) is green.
- **G.** `npm run typecheck`, `npm run build`, `npx vitest run` clean; a WC league's screens visually
  unchanged (cup-path regression).
- **H.** *(round-2)* **No stale money reaches a screen.** With an older gameweek deliberately dirty on
  staging, the lead card and every cumulative Analytics card are absent, the Matches row reads
  `recalculating` with no money, and a void gameweek's recap says it was voided rather than showing a ₹0
  pot (U-6a…U-6f, U-14a…U-14e, B-22).
- **K.** *(round-3, corrected in round-4)* **The row builder covers every lifecycle.** U-2a exercises all 66
  CL × VP combinations: **the six CL0 cells return `null` (PR4) and the remaining 60 each resolve to exactly
  one `LeagueRowView` arm** — v4 demanded 66 arms, which contradicted its own CL0 rule **[V4]**. No arm
  outside `provisional`/`settled` carries money; no CTA appears outside CL1 with VP1/VP2/VP3, **CL1 + VP4
  included in that exclusion**; and provisional money is absent until a counted fixture has kicked off
  (§6.3a, M-6) **[T4]**.
- **L.** *(round-3)* **Corrections cannot leave stale blocks on screen.** A correction landing between full
  time and the FT+30 freeze invalidates the affected blocks on the same tick (I-6d), the stale-read counter
  and backoff survive across separate invocations (I-6e…I-6g), and every `*_ok` column has exactly one
  `MatchDetailView` key (U-18b) **[T5]**.
- **I.** *(round-2)* **Every launch path actually runs.** After `scripts/phase4-rollout.mjs`, the
  `understat_xg` and `team_news` keys are due, `fotmob_slow` is still `infinity`, and one observed staging
  cycle produces a real Understat xG row and a real team-news card (I-3, I-8, P-23).
- **J.** *(round-2, tightened in round-3)* **The entry-sheet chips render on staging** from warm PL insights,
  absent when the model flag is false, **absent when `model_ok` is true but the stamp has aged past the
  poller's own ladder**, **absent after an in-place kickoff reschedule (`model_source_kickoff_at` no longer
  equals `fixtures.kickoff_at`)**, and a chip tap fills the steppers without submitting (U-20a…U-20g, B-23)
  **[T7]** **[V7]**.

---

## §15 Open decisions for the orchestrator

| # | Decision | Recommendation |
|---|---|---|
| **D1** | **Contradiction:** the Phase 4 brief says lineups are excluded; the data-content plan §Confirmations 3 says *"confirmed lineups (ESPN, ~T−75m) ship day one"*. | Ship the ESPN lineups **parser and column** (cheap — same payload) but **no ESPN lineup UI at launch**; keep the FotMob predicted-XI card as the opportunistic module it already is. Lighting up a confirmed-XI card later is then UI-only. Needs Ananth. (Matches decisions-log #22.) |
| **D2** | New route `app/m/[fixtureId]?league=<slug>` versus nesting under a league. | Flat route. Match detail is reached from the app-level Matches tab where no league is implied, and the neutral no-access case (E-9) needs a URL that works without one. The WC route stays put. |
| **D3** | Dedupe rule when mirrored picks differ across leagues in "My form". | Earliest-joined league wins, stated in the module footnote. Deterministic and stable; the alternatives either flatter the user or change retroactively. |
| **D4** | *(Withdrawn in v2.)* A Phase 2 export refactor. | Not needed: `scoreGameweek`, `settleGameweek` and `gameweekNets` are already exported (`lib/gameweek-points.ts:115`, `lib/gameweek-settle.ts:105,141`). Both golden files stay byte-identical. |
| **D5** | *(Reopened and re-answered in v3.)* Who owns the current-GW resolver. | v2's answer named `pickCurrentGameweek`, which **Phase 3 withdrew**. Phase 4 owns a new **app-level** resolver, `lib/gw-resolve-app.ts::resolveAppGameweek` (§6.1). Phase 3's league-scoped `resolveGameweekView` is left untouched — the two answer different questions, and merging them would break the league screens' open-contest preference. |
| **D6** | There is **no Analytics mockup** in `docs/design/cleansheet2/`. Seven gated modules are specced from prose. | Commission a mockup pass before Analytics UI work (step 6 of §13 is the natural gate). Matches tab and match detail have mockups and proceed meanwhile. |
| **D7** | Turning FotMob on in prod. | Ananth's explicit call, never an agent's. Phase 4 ships with `FOTMOB_ENABLED` unset and `fotmob_slow.next_due_at='infinity'`; **Understat covers xG at launch**, so nothing waits on this. |
| **D8** | *(New in v2.)* The Analytics lead-card acknowledgement is `localStorage`, so the card can reappear once per device. | Accept for launch. A durable store would be Phase 4's only user-scoped write and would breach the §0.1 allowlist, which is the safety proof for the whole phase. Revisit in Phase 5, where user-scoped writes already exist. |

---

## Sol round-1 findings mapping

*(Rounds 1–4 are a historical record of what each round changed at the time. Where a row describes a shape a later round replaced — six strip variants, twelve browser cells, CL10 as clean and terminal — the later mapping wins and the live sections above are authoritative.)*

| # | Severity | Where it lands | How v2 resolves it |
|---|---|---|---|
| 1 | Blocker | §0.1, §1.3, §4.7, P-19…P-22 | Explicit 8-table write allowlist including `provider_samples`/`sync_state`/`sync_issues`; four-part enforcement — E1 static `.from()`/`.rpc()` scan across changed TS **and** the cron route, E2 migration DML/DDL target inspection, E3 quiescent before/after diff over every banned table, E4 golden-file hashes. Lock claim reworded to "no explicit money-path locks and no lock cycle", with the FK `KEY SHARE` lock acknowledged and P-22 run against `apply_score_update`. The `frozen_at` clearing path is defined as `reconcileMatchCache` — cache-only, reads `result_revisions`, never writes it. |
| 2 | Blocker | §6.2, §6.3, X-4, E4, M-1…M-5, D4 | Snapshot = finished + **in-progress at current score** + voids, omitting only unstarted; calls the already-exported `settleGameweek`/`gameweekNets`/`scoreGameweek`; **D4 withdrawn**, both golden files byte-identical and E4 unconditional. Every league row always carries its own points; only `headerPoints` nulls. v1's U-10 replaced by M-1…M-5 including live 0–0 and all-final equivalence. **[R1]** |
| 3 | Blocker | §2.5, §4.1, I-3 | Understat discovery via `getLeagueData/EPL/<season>/` matched by date + both clubs; a separate **`pollUnderstat`** on the `understat_xg` lease, **armed at launch and independent of FotMob**; integration case I-3 with `FOTMOB_ENABLED` off. **[R3]** |
| 4 | Blocker | §6.3, §6.6, B-1…B-12 | `MatchesTabView` gains `winnersRecap` (winners, pot, tiebreak), `LeagueRef` identity and per-row `cta`/`raceHref`. New `AnalyticsTabView` with `currentFocusGw` **and** `latestSettledGw`, six strip variants, league lens, optional lead card, and a stated acknowledgement store (localStorage, D8). Browser coverage is all twelve cells. |
| 5 | Blocker | §2.4, §1.4, F-1a/F-1b, F-3, F-5 | Every `unknown` replaced by exact scalar/array types; separate `parseFotMobCandidates` for the date endpoint returning only id, date and two club names; facts modelled as `{key, args:number[]}`; tagged `FetchResult` distinguishing disabled / http+status / timeout / invalid_json / shape, persisted as `last_error` + `last_status`. F-1a/F-1b test both full raw payloads recursively with forbidden sentinels; F-3 proves the kill switch precedes URL construction. |
| 6 | Should-fix | §2.1, §2.2, §4.2, C-1, C-2 | `createSummaryFetcher` gives one ESPN fetch per fixture per tick, shared by insights, lineups, events and stats. `lib/poll-due.ts` replaces the flat 3h guard with injected-clock per-block due functions on the cron path, while `refreshInsights` keeps its `ttlMs` hatch for the cold fill. Boundary tests at T−24h, T−2h, kickoff, FT+5, FT+10, FT+30. `validateSummary(summary, expectedEventId)` takes the id explicitly. |
| 7 | Should-fix | §1.1, §1.3, X-2, §6.5, D-1…D-4, U-18 | Per-block stamp **and** per-block `*_ok` validity flag, with data columns holding last-good values and pollers writing partial patches. X-2 enforced by `lib/match-blocks.ts` constructors returning `undefined` for semantically empty blocks (U-18 recursive). Source and timestamp added to team news, retrospective, ratings and momentum via `Sourced<T>`; `ratings_provider`, `momentum_provider`, `team_news_fetched_at`, `team_news_source` columns added. D-1…D-4 drop each ESPN block alone. |
| 8 | Should-fix | §1.3, §4.7, I-5, I-6 | `freeze_reason`, `source_status`, `source_version`, `source_kickoff_at` added; `reconcileMatchCache` observes reschedules and `result_revisions`, invalidates conflicting blocks and re-arms — cache-only, no Phase 2 routine touched. Tests: postpone→reschedule→play, final→corrected. |
| 9 | Should-fix | §2.7, A-17…A-20, I-4 | New `lib/fpl-availability.ts`: pure `parseAvailability` + `teamNewsForFixture`, whole-payload rejection, join through the Phase 1 FPL team mapping, own freshness stamp and source, stale rows replaced wholesale, recorded snapshot, tests for malformed player/team ids and absent news. I-4 covers the ESPN-unmatched fixture rendering from FPL with all ESPN blocks absent. |
| 10 | Should-fix | §1 RLS posture, P-1…P-7 | Rendered reference caches get `authenticated` select; `provider_samples`, `sync_state`, `sync_issues` are **service-only, RLS with no policies**, matching Phase 1 (`20260727000001:402`). RLS tests enumerated per table. **[R4]** |
| 11 | Should-fix | X-6, §1.4, §3, X-6a…d | `chk_xg_pair` (both-null or both-present) and `chk_provider_model` (constrained provider/model pairs) added; all reads go through the single pure `selectXg` precedence selector; tests cover both providers present, partial rows, stale FotMob and Understat fallback. |
| 12 | Should-fix | §12 preamble, P-12, B-1…B-12, C-1…C-4, I-3…I-7, acceptance F | Migration, cascade (P-12) and all destructive cases run only in disposable Postgres; shared-DB checks use scratch cache rows and delete only those; v1's fixture-deleting P-8 is gone. Browser coverage is all twelve cells. New tests for cadence boundaries, per-block ESPN failure, ESPN-unmatched fixtures, correction/replay, the FotMob and Understat call caps, and the independent Understat fallback. Acceptance F is now "all launch-enabled pollers armed, FotMob dark", with the separate mocked FotMob suite I-7. **[R5]** |

---

## Sol round-2 findings mapping (v2 → v3)

Round 2 closed findings 2 and 10 outright and marked the other ten partial, with ten new blocking
findings. All ten are folded below. **Rows 1, 2, 3, 4, 6, 9 and 10 were then found only partially resolved
in round 3** — read them together with the round-3 table that follows, which supersedes them where the two
disagree (the count of `sync_state` keys, the VP numbering, the flag names, and the chip freshness rule all
changed). One correction to the review itself: finding 10's prescribed
transport is wrong — `chrome-devtools-axi` does drive a signed-in session with the QA account, which is
how Phase 1's browser acceptance passed, so the cases run there and **not** in Ananth's real Chrome.

| # | Finding | Where it lands | How v3 resolves it |
|---|---|---|---|
| 1 | The write-safety proof does not enforce its own row-level limit on `sync_state`, permits non-literal table targets, and its handwritten banned list omits `league_competitions` and `gameweek_audit_log`. | §0.1, E1, E3, P-19a…d, P-20 | The protected set is **derived at check time** from `information_schema.tables` (all of `cashford` minus the seven fully-allowed tables), so a table added by a later migration is protected without editing this plan — a handwritten list rots, and v2's two omissions prove it. `sync_state` moves out of the fully-allowed set: only the **eight Phase 4 keys** in `PHASE4_SYNC_KEYS` (`lib/poll-keys.ts`), written only through `claimPhase4Lease`/`releasePhase4Lease` in `lib/poll-lease.ts`. E1 now fails on four things including **any non-string-literal `.from()`/`.rpc()` argument**. E3 additionally snapshots every non-Phase-4 `sync_state` row. |
| 2 | The current-GW contract imports `pickCurrentGameweek`, which does not exist — Phase 3 withdrew it for the league-scoped `resolveGameweekView`, whose open-contest preference is the opposite of the product rule. | §6.1, D5, R-1…R-7 | New **app-level** resolver `lib/gw-resolve-app.ts::resolveAppGameweek`, pure with an injected clock, returning `currentGw` (locked and unsettled), `nextOpenGw`, `latestSettledGw` and `overlapAlert`. "Settled" is stated across leagues: every viewer league with a contest for that gameweek holds a non-dirty result, using Phase 2's predicate verbatim. Phase 3's resolver is left untouched. Seven loader tests R-1…R-7 as named. |
| 3 | Matches and Analytics can display stale money and have no shape for dirty, void, `needs_update` or invalid Phase 2 outcomes. | §6.3a, §6.6, U-6a…U-6f, U-14a…U-14d, B-22, acceptance H | Every league row is a **union** — not-entered / needs-update / invalid / provisional / recalculating / settled / void — resolved by **importing Phase 3's CL0–CL10 tree, VP0–VP5 and PR1/PR3/PR3a verbatim**, not a parallel classification. Dirty rows carry no money field at all and take points from the live recomputation only, never the stored snapshot. `winnersRecap` becomes a settled / void / recalculating union, so a void gameweek says so instead of showing a ₹0 pot. Analytics gains a `suppressed` gate: any dirty gameweek at or below `latestSettledGw` suppresses every cumulative card, and dirty/settling/overlap suppresses the lead card. |
| 4 | Two launch data paths cannot run: Understat is seeded off with nothing to arm it and needs a season conversion; team news has an adapter and no caller. | §1.7 [S3], §2.5, §4.1, §4.9, A-10a…e, C-5, C-6, I-8, P-23, acceptance I | **`scripts/phase4-rollout.mjs`** — a documented service-role script run by hand at Phase 4 launch — moves launch-enabled keys from `infinity` to due-now while leaving `fotmob_slow` dark and asserting it, with `--dry-run` and `--revert`. *(Round 3 corrected this row's original "staging-only posture" claim — see the round-3 table, finding 1.)* `understatSeason('2026-27') → '2026'` is a pure, tested helper that throws on a malformed season, fixing the 404 that would have been a silent permanent xG outage. New **`pollTeamNews`** with its own `team_news` lease, a 30m/10m cadence inside T−48h/T−3h, a place in the cron order, the Phase 1 FPL team-mapping read, a partial patch touching only the four `team_news_*` columns, and I-8 rendering then removing a recovered player. |
| 5 | The one-summary-request criterion is false — `pollCommentary` is missing from the fetcher's consumer list. | §2.2, §4.8, C-2, C-2b | **Every** ESPN-summary consumer takes the fetcher as an argument, commentary included, enforced by the signature since no poller imports `fetch` or `fetchSummary` directly. The §4.8 sharing sentence now names all three. C-2 places commentary, events and stats due on the same fixture in one tick and asserts one request; C-2b asserts 10 requests across a 10-fixture gameweek, not 30. |
| 6 | Validity is coarser than the visible modules, the claimed model flag does not exist, and a corrected fixture can refill from a stale summary and be marked valid. | §1.1, §1.3, §1.4, §4.7, X-6, I-6a…I-6c | One stamp and one flag **per visible module**: `odds_*`, `model_*` (the flag v2's prose claimed but never defined), `form_*`, `h2h_*`, `table_*` splitting v2's single `context_ok`, plus per-module stamps on the slow providers (`xg_*`, `shots_*`, `ratings_*`, `momentum_*`, `facts_*`, `predicted_xi_*`). `result_fingerprint` (`'<home>-<away>@<revision_count>'`) is written on invalidation, and a score-sensitive block may be marked valid **only when the summary header's fingerprint matches**. A mismatch is a **stale read, not a shape failure**: nothing written, retried next tick, `sync_issues` kind `'provider_stale_result'` after three. Re-enabling is one atomic statement. `source_version` is documented as a write counter, not a result identity — v2 conflated the two, which is why the fingerprint exists separately. `selectXg` gains its missing staleness rule: discard any row whose `xg_fetched_at` predates kickoff, since a row fetched before the match started cannot be about it. |
| 7 | The jitter routine omits Phase 1's required revoke/grant and accepts invalid bounds. | §1.7 [S4], P-24, P-25 | The routine now raises unless `0 < min_secs < max_secs`, then `revoke all on function … from public, anon, authenticated` followed by `grant execute … to service_role`, quoting Phase 1's own comment at `20260727000001_competitions_gameweeks.sql:1072`. The concrete risk is stated: a `security definer` routine executable by `authenticated` would let any logged-in user reschedule any poller — including `fpl-sync`, whose key this routine does not restrict. P-24 reads `information_schema.routine_privileges`; P-25 covers `(0,0)`, negative and reversed bounds. |
| 8 | `FotMobFact.key: string` still admits authored prose as a key. | §2.4, F-1c, F-1d | `key` becomes the **closed union** `FotMobFactKey` (eight supported stats). Unknown keys are dropped, not passed through and not fatal. Rendering goes through an exhaustive `Record<FotMobFactKey, …>` copy map in `lib/fotmob-copy.ts`, so a key absent from the map cannot exist. F-1c puts a full sentence in `key` and asserts it appears nowhere in the persisted row; F-1d drops an unrecognised key while siblings still render. |
| 9 | Phase 4 will not light the entry-sheet chips — Phase 3 mounts nothing, queries nothing, and its mapper takes `topScores`. | §13 step 7, U-20a…U-20d, B-23, acceptance J | v2's "for free" claim is withdrawn. Phase 4 does four named things: batch-query `fixture_insights` in the entry-sheet loader; gate on `model_ok` and pass **`topScores`** through the existing `chipsForFixture` unchanged; mount `ScoreChips` above the steppers with no empty strip when there are no chips; and keep a chip tap a stepper fill, never a submit and never pre-selected. Four unit tests plus a light/dark browser case. |
| 10 | The twelve browser cases are not mapped to cells, and the prescribed browser cannot reach the signed-in screens. | §12 browser section, B-1…B-12, B-22, B-23 | **B-1…B-6 mapped to the six Matches cells and B-7…B-12 to the six Analytics cells**, each with its seed state and main assertions in a table. Transport corrected against the review: **`chrome-devtools-axi` signed in as the QA account** `ananth@cashford.internal` on `cashford-staging.vercel.app`, one isolated session per worker via `CHROME_DEVTOOLS_AXI_SESSION=worker-<n>` — this is how Phase 1's browser acceptance passed. Never Ananth's real Chrome profile; the unsigned browser is retained only for public and logged-out checks. B-0 (no real-league writes) still runs first. |

---

## Sol round-3 findings mapping (v3 → v4)

Round 3 closed round-2 findings **5, 7 and 8** outright and marked the other seven partial, with eight new
blocking findings. All eight are folded below. Two of them corrected v3 against the repo rather than
against taste: the cron chain and the Phase 3 VP numbering. Every claim below was checked against the
source before being accepted — the review was right on all eight.

**Round 4 then closed rows 2 and 6 outright and found the other six only partially resolved.** Read this
table together with the round-4 table that follows, which supersedes it where the two disagree — the
reconciliation predicate, the resolver's inputs, the row-builder return type, the stats DTO key, the
chip-invalidation rule and B-11's advancing modules all changed again.

| # | Finding | Where it lands | How v4 resolves it |
|---|---|---|---|
| 1 | The safety harness and the rollout script cannot execute: E3's derived protected set necessarily contains `sync_state`, so every ordinary lease write fails it; E2 permits only seed inserts while the same migration's jitter routine updates `sync_state`; and `claim_sync_lease` requires `next_due_at <= now()`, which an `infinity` row can never satisfy, so nothing can arm a poller. | §0.1, E1, E2, E3, §1.7a, §1.7b, §13 step 4, P-19e, P-19f, P-26…P-29 | `protectedTables = allBaseTables − FULLY_ALLOWED − {'sync_state'}`, with `sync_state` checked **row-wise**: E3 snapshots only rows whose key is not in `PHASE4_SYNC_KEYS`. **v3's set would have failed the harness on correct behaviour.** E2 now parses routine bodies and permits a `sync_state` write only inside two named approved routines whose text matches this plan after whitespace normalization, with seed keys required to be literal members of `PHASE4_SYNC_KEYS`; planted cases P-19e (`insert … 'fpl-sync'`) and P-19f (an `update … where key='fpl-sync'` hidden in a routine body) prove both holes closed. New **`cashford.arm_sync_key(text, timestamptz)`** (§1.7a) sets `next_due_at` directly, with the nine Phase 4 keys **hard-coded in its body** so even a buggy service-role caller cannot touch `fpl-sync`, and `and lease_token is null` so it never yanks a row from a running poller — revoked from `public, anon, authenticated` and granted to `service_role` alone, following Phase 1's rule at `20260727000001_competitions_gameweeks.sql:1072` and matching decision #28's treatment of the jitter routine. `lib/poll-lease.ts` gains **`renewPhase4Lease`** (§4.6 needed a renew path v3 had no helper for) and **`armPhase4Key`**. `espn_insights` becomes the ninth key, so `pollInsights` is leased like everything else. |
| 2 | **The proposed cron order drops Phase 2 gameweek settlement.** v3 claimed to preserve the existing chain but omitted `dispatchGameweekSettlements`. | §4.8, I-1, acceptance F | The chain is quoted verbatim from `app/api/cron/tick/route.ts:26–42`: `syncFpl → pollScores → resolveKnockoutBracket → lockDueContests → settleFinishedContests → gameweekMaintenance → dispatchGameweekSettlements → pollInsights →` Phase 4's steps. The **maintenance→settlement pairing is load-bearing**: maintenance is what locks entries and creates the immediate `<2`-entrant voids, so settlement must follow it in the same tick, and Phase 4 inserts nothing between them. I-1 and acceptance F now compare **both** `settles` **and** `gwSettles` key by key — v3 said "settlement output" without naming which, so it would have passed with the money path missing. |
| 3 | The app resolver ignores the authoritative lifecycle inputs: it takes contest `status` but not the contest's deadline, resolves locking from `gameweeks.deadlineAt`, and sets an archived competition's `latestSettledGw` to the final gameweek without applying its own clean predicate. | §6.1, R-8…R-11 | The resolver input gains **`deadlineAt` per contest**: `gameweek_contests.deadline_at` is the authoritative snapshot that Phase 2 and Phase 3 both use, so a moved gameweek deadline cannot reopen a locked contest; `gameweeks.deadlineAt` now serves only `nextOpenGw`. Rule 2 requires **at least one in-scope contest** — "every contest is clean" is vacuously true when there are none — and treats a terminal contest with no result row as unsettled (CL9). Rule 6 computes an archive's `latestSettledGw` with the **same** clean predicate. Tests R-8 (contest snapshot earlier than the gameweek deadline → the contest wins), R-9 (CL9 corrupt → unsettled), R-10 (no contest → no vacuous advance), R-11 (archived dirty final GW → `latestSettledGw = 37`). |
| 4 | `LeagueRowView` is not a union over Phase 3's lifecycle: it labels `needs_update` as VP4 where Phase 3 defines VP3, has no shape for open-entered, ineligible VP0, corrupt CL9, all-called-off CL10 or locked-awaiting CL2, requires a CTA on the terminal `not-entered` arm that PR8 forbids, and requires money on a `provisional` arm spanning CL2. U-14a also contradicts the stated lead-card gate. | §6.3a, §6.6, U-2a, U-14a…U-14e, M-6 | The builder is **exhaustive over `resolveRender(cl, vp)`** with **thirteen arms** — open-not-entered, open-entered, open-needs-update, locked-awaiting, closed-not-entered, ineligible, invalid, provisional, recalculating, settled, void, all-called-off, sync-issue — and an `assertNever` default, so a new Phase 3 outcome breaks the build instead of rendering blank. VP labels corrected to Phase 3 §5.2 (**VP3 `needs_update`, VP4 `locked_in`**). A CTA field exists **only** on the three CL1 arms, so PR8's bug cannot be written. `provisional.netInr` is nullable and stays null until a counted fixture kicks off (M-6); CL2 has no money field at all. **U-2a runs all 66 CL × VP combinations.** The lead-card gate gains its fourth condition, `dirty_older`, so an older dirty gameweek suppresses the lead card as U-14a always asserted — and `reasons` becomes a list, since several conditions co-occur. U-14e pins the invariant that suppressing the cumulative cards always suppresses the lead card. |
| 5 | The validity and correction machinery is unimplementable: the schema declares `events_ok`/`stats_ok` while the algorithm writes four names that do not exist; `reconcileMatchCache` only scans frozen rows, so a correction before the FT+30 freeze stays visible; the three-stale-reads counter and 30-minute backoff have nowhere to live in a serverless tick; and the detail DTO collapses five separately stamped modules into one `Sourced<InsightsBlock>` with shots nested inside xG. | §1.3, §4.7, §6.5, I-6d…I-6g, U-18b | **One flag and one stamp per data column**, named mechanically from the column: `key_events_ok`, `scorers_ok`, `team_stats_ok`, `player_stats_ok`, `commentary_ok`, `lineups_ok`. `reconcileMatchCache`'s predicate becomes the **mismatch itself, not the freeze** — kickoff differs from `source_kickoff_at`, or a `result_revisions` row is newer than `coalesce(frozen_at, latest block stamp)` — closing the up-to-30-minute window in which a corrected header sat above a wrong timeline. New **`stale_result_reads`** and **`stale_retry_at`** columns hold the count and the backoff floor, incremented in one atomic statement, skipped on while `stale_retry_at > now()`, raising one `provider_stale_result` issue on the third, and **both reset by any accepted write**. `MatchDetailView` gains per-module `Sourced<T>` keys (`odds`, `model`, `form`, `h2h`, `table`, `keyEvents`, `teamStats`, `playerStats`, `commentary`, `lineups`) with `shotMap` a **sibling** of `xg`; `InsightsBlock` is deleted, and **U-18b** asserts one DTO key per `*_ok` column in both directions. Tests I-6d (correction before freeze), I-6e (counter survives separate invocations), I-6f (backoff skips), I-6g (reset). |
| 6 | Team-news success and failure shapes contradict each other: a successful empty result stores `'[]'::jsonb` into a column typed `{home, away}`, and §2.7 says a malformed payload writes nothing while §5 says it sets `team_news_ok = false`. | §2.7, §4.9, §5, I-8b, I-8c | Three states, stated once in a table: news found → value plus `ok = true` plus a bumped stamp; **success with nothing to report → `team_news = null`, `ok = true`, stamp bumped**; **failure → value and stamp untouched, `ok = false` only**. `'[]'` is gone — it would have thrown on any reader doing `row.team_news.home`. Retaining the last-good value on failure while flipping the flag is what stops two-day-old injuries rendering as current, which v3's "writes nothing" would have allowed. I-8b pins the raw stored `null` and the absent card; I-8c pins a byte-identical value and stamp across a failed pass with the card gone. |
| 7 | The stale entry-chip requirement is still missing — v3 gates on `model_ok` plus a non-null timestamp, and a non-null timestamp is not a freshness rule. | §13 step 7, U-20e, U-20f, B-23, acceptance J | **`modelUsable(row, fixture, now)`** replaces the null check: the flag must be true, the stamp must be inside **the poller's own pre-kickoff ladder** (6h / 1h from T−24h / 10m from T−2h) with one missed cycle of tolerance, and the stamp must postdate the last kickoff change, since odds priced for a different match date do not describe this one. `ladderInterval` is exported from one module and shared by the poller and the gate, so cadence and staleness cannot disagree. **U-20e** asserts the three boundaries at each of the three rungs; **U-20f** covers a reschedule; B-23 gains a rendered case where `model_ok = true`, the stamp is expired, and **the chip row is absent**. |
| 8 | Two browser cells assert the wrong product behaviour: B-2 expects the viewer's own pre-deadline picks hidden as placeholders, and B-11 expects cumulative cards to advance after a gameweek the viewer sat out. | §12, B-2, B-3, B-9, B-11 | **B-2** now asserts **own calls visible** — the reveal rule hides friends' picks from each other, never a viewer's own from their author — and **no friend pick in the hub rows at all**, neither scoreline nor `•–•`, because the hub has no room block to reveal. **B-11** asserts **every personal card byte-identical** to its pre-settlement value (a gameweek the viewer did not enter produced no sample of theirs) with **only the league-lens cards advancing** from friends' results; v3 would have certified a personal average moving on a week the viewer sat out. B-3's Analytics-strip assertion moves into **B-9**, the Analytics cell for that state. The QA-account `chrome-devtools-axi` transport stands as ruled, and the review accepts it. |

---

## Sol round-4 findings mapping (v4 → v5)

Round 4 closed round-3 findings **2 and 6** outright — the cron order with both settlement dispatches, and
the team-news storage shapes — and marked the other six partial, with eight new blocking findings. All eight
are folded below. Two of them caught **false schema claims**, checked here against the applied migration
before anything was written: `result_revisions` has `observed_at` and no `created_at`, and `fixture_moves`
records gameweek-membership moves and nothing about `fixtures.kickoff_at`
(the `fixture_moves` and `result_revisions` declarations in `20260727000001_competitions_gameweeks.sql`). The review
was right on all eight.

**Round 5 then confirmed six of these resolved and found two resolved-with-a-new-blocker** — the
reconciliation predicate (finding 5) and B-11 (finding 8). Read this table together with the round-5 table
that follows, which supersedes it where the two disagree: CL10's classification, the kickoff
acknowledgement, and B-11's advancing modules.

| # | Finding | Section(s) changed | How v5 resolves it |
|---|---|---|---|
| 1 | P-20 checks every table except the seven fully-allowed ones, which still includes the changed `sync_state`, so any valid poller run fails the quiescent proof; E2's approved list is called "three-name" while naming two routines; the scanner never compares its SQL key literals against `PHASE4_SYNC_KEYS`. | §0.1 (E2, the row-wise note), §12 P-20, new P-20b | P-20 now states the subtraction in the same form as §0.1 — `allBaseTables − FULLY_ALLOWED − {'sync_state'}` — and says why a later row-scoped assertion cannot undo a whole-table failure; the two checks are disjoint, so a lease claim and release cannot fail it. **P-20b** asserts the enumerated protected set does not contain `sync_state`. E2's approved list is **two named routines** (`release_sync_lease_jittered`, `arm_sync_key`), a third fails the scan, and the scanner **extracts every `sync_state` key literal from seeds and routine bodies and compares the set against `PHASE4_SYNC_KEYS` in both directions**, failing on any non-literal key expression. The "eight rows" slip at §0.1 is corrected to nine. |
| 2 | `espn_insights` is seeded at `infinity` but §13 step 4 never arms it, so following the stated one-at-a-time order leaves the existing insights poller dark. | §13 step 4 | `pollInsights` **leads** the rollout order (`pollInsights → pollStandings → deriveStandings → reconcileMatchCache → pollMatchData → pollCommentary → pollTeamNews → pollUnderstat`), with the consequence spelled out: the migration darkens a poller that runs in production today, so leaving it out of the sequence would have taken odds, the model, form, H2H, the table window and the entry-sheet chips down for the whole rollout. It goes first because its production behaviour is already known, which makes it the cheapest cycle to observe. |
| 3 | The resolver cannot call `resolveContestLifecycle(contest, gw, fixtures, results, now)` because its input has no fixtures; a past-deadline contest over a true blank GW becomes `currentGw` instead of CL0; and in R-8 the moved gameweek deadline makes GW3 both `currentGw` and `nextOpenGw`. | §6.1 (signature, rules 1–3), R-8, new R-12…R-15, §12 R-list | The input carries **`cl: ContestLifecycle` per contest, precomputed by the loader** (`lib/gw-resolve-app-load.ts`) with **Phase 3's own function** over the effective fixtures it already resolves — Phase 4 never restates the D6 collapse or the CL tree, and **R-14** asserts the supplied `cl` equals `resolveContestLifecycle`'s. `gameweeks.deadlineAt` becomes **nullable** and an unscheduled gameweek is never open (**R-15**). Rule 1 excludes any gameweek with an **already-locked in-scope contest** (`cl` outside {CL0, CL1}), so R-8's GW3 is `currentGw` and `nextOpenGw` is 4 — asserted in R-8. Rule 3 keys on `cl ∈ {CL2, CL3, CL4, CL6, CL8, CL9}` instead of "past its deadline", which excludes **CL0 true-blank** (**R-12**) and **CL10 all-called-off** (**R-13**); rule 2 excludes both from settled-ness too, so the resolver reads past them rather than waiting forever for a result row nobody will write. |
| 4 | CL0 is declared to produce no row, yet U-2a and acceptance K require all 66 cells to produce an arm; the `open-entered` arm requires a CTA for CL1 + VP4, which PR6 forbids. | §6.3a (signature, union, rules, U-2a), §12 U-2a/U-2b, acceptance K | `buildLeagueRow` returns **`LeagueRowView | null`**, with the CL0 null in the type rather than in prose. U-2a asserts **six CL0 nulls and 60 rendered cells** as three separate assertions, so a future arm that swallows CL0 fails rather than keeping the total at 66; acceptance K is reworded to match. `open-entered` **splits**: CL1 + VP2 keeps its CTA (C7), and the new **`open-locked-in`** arm (CL1 + VP4) has **no `cta` field at all** — fourteen arms — so PR6's rule is enforced by the shape, not by discipline. **U-2b** pins the caller: an all-CL0 input yields `yourGw === null`, not a card with no rows. |
| 5 | The reconciliation query reads `result_revisions.created_at`, which does not exist; `kickoff_at <> source_kickoff_at` misses non-null→null postponements; the "latest block stamp" is only `key_events_fetched_at`; and `source_kickoff_at` is written only at freeze. | §4.7 (query + rationale, I-6h, I-6i), §1.3 (column comment, the freeze bullet, the new write rule, P-13b) | The query uses **`observed_at`**, **`is distinct from`** for the kickoff comparison (null-safe both ways, so a cleared kickoff is caught), and **`greatest(...)` over all five score-sensitive stamps** — `lineups_fetched_at` deliberately excluded, since a lineup refresh must not make a pending correction look already-seen. The `greatest` fix also closes a permanent invalidation loop: a null `key_events_fetched_at` beside a fresh `team_stats_fetched_at` fell through to `'epoch'` and re-invalidated every tick. **`source_kickoff_at` is now written on every accepted cache write** as part of the partial patch, because §4.7's predicate runs over unfrozen rows too and a null there was true for every fixture — v4 would have invalidated every unfrozen row on every tick. Freeze only reads the column. **I-6h** (kickoff set to null is reconciled), **I-6i** (no re-invalidation loop across ticks), **P-13b** (a single-block patch leaves `source_kickoff_at` current). |
| 6 | Both `liveStats` and `teamStats` consume the single `team_stats_ok` / `team_stats_fetched_at` pair, so U-18b's one-to-one storage-to-view mapping is unsatisfiable. | §6.5 (DTO + invariant), §12 U-18b, new U-18c | `liveStats` is **deleted**. There is **one state-tagged key**: `teamStats?: Sourced<{ phase: 'live'|'final'; minute: string | null; rows: StatRow[] }>` — the same ESPN stats block read at different times, with the renderer choosing the five-stat live frame (§8) or the post-match bars from `phase`. One storage pair maps to one view key with two mutually exclusive presentations, which is what U-18b can check. **U-18c** pins the tag: live carries a minute and at most five stats, final carries `minute === null`, and no view can hold both. |
| 7 | Model-chip invalidation relies on `fixture_moves`, which records gameweek-membership moves — an in-place kickoff reschedule writes no row there, so a stale model stays usable. | §1.1 (new column + backfill note), §13 step 7 rule 3, U-20f, new U-20g, §12 U-20 list, acceptance J | New **`fixture_insights.model_source_kickoff_at`**, written in the same statement as `model_fetched_at`, and `modelUsable`'s third condition becomes **exact equality with `fixtures.kickoff_at`** — a null on either side fails. The `fixture_moves` comparison is removed with the reason stated: it tracks `old_membership_id`/`new_membership_id`, nothing writes it on a kickoff change, there is no `kickoff_changed_at` stamp, and adding one would be a write to a table outside the §0.1 allowlist. Storing the kickoff with the model needs no history at all. **Not backfilled** — existing rows stay null and show no chips until the next refresh, rather than back-dating freshness. **U-20f** mutates `kickoff_at` in place with no `fixture_moves` row (the case v4's rule missed); **U-20g** covers the null column. |
| 8 | B-11 says `rivalry` advances from friends' results, but §6.7 gates rivalry on GWs **both** users entered and the viewer sat this one out. | §12 B-11, §6.7 (gate wording + new table) | B-11 now asserts **`rivalry` and `vsRoom` byte-identical** alongside `myForm`, `receipts`, `habits` and season net, and names as advancing only the genuinely room-only figures: the **league-lens room table** (each member's own points and net) and **`weeklyLabels`** for that gameweek. `vsRoom` moved to the byte-identical side because it is a **delta over the gameweeks the viewer entered** — advancing only the room side would move the number with no new fact about the viewer, the same error as moving a personal average — and §6.7's gate is tightened to say so. §6.7 gains a seven-row table stating, per module, whether a sat-out settled gameweek may move it and why, so the assertion and the gate cannot drift again. |

---

## Sol round-5 findings mapping (v5 → v6)

*(Superseded in part by the round-6 mapping that follows, which wins where the two disagree: CL10's treatment on the row builder and in Analytics, the dark-launch claim about `pollInsights`, and the non-null `header.deadlineAt`.)*

Round 5 confirmed six of the eight round-4 fixes resolved outright — the `pollInsights` rollout step, the
`LeagueRowView | null` return with its 6-null/60-cell proof, the state-tagged `teamStats` key, and
`model_source_kickoff_at` — and marked two **resolved with a new blocker**: the reconciliation predicate was
right but did not converge on a cleared kickoff, and B-11 fixed `rivalry` only to assert a module the DTO
does not have. Five new blockers and one should-fix, all folded below.

**The round's one false claim was mine, not the reviewer's.** v5 wrote that a wholly called-off gameweek
waits on "a result row that will never be written". Phase 2 §L3 says the opposite in as many words:
"all-void W2 contests become ready trivially and settle through claim/finalize returning `kind:'void'`".
Checked before rewriting, along with `fixtures.kickoff_at` being nullable
(the `drop not null` in Phase 1's migration), `competition_standings` keying on `competitions` (§1.2),
and `provider_samples` having no parent key (§1.6). The review was right on all six.

| # | Finding | Section(s) changed | How v6 resolves it |
|---|---|---|---|
| 1 | E2 rejects the migration it was written for: both approved routines write `where key = p_key`, and v5 banned every parameterised key expression anywhere in the file. | §0.1 E2, §12 P-19 (new P-19g, P-19h) | The literal requirement now applies to **key-naming sites only** — the seed inserts, and `arm_sync_key`'s hard-coded `p_key not in (…)` allowlist, whose nine literals must equal `PHASE4_SYNC_KEYS` as a set. Everywhere else a `sync_state` write is judged by **which routine encloses it**, so `where key = p_key` inside an approved, text-matched routine is permitted and expected; the bound parameter comes from `lib/poll-lease.ts`, which E1 already covers. A parameterised key outside the two approved routines still fails, on the stronger enclosing-routine rule. **P-19g** feeds the scanner both approved routines verbatim and asserts it **passes** — the assertion v5 could not have satisfied. **P-19h** drops one key from the allowlist and asserts the set comparison fails. |
| 2 | CL10 semantics are wrong: Phase 2 writes an `all_fixtures_void` result for ≥2 entrants, but v5 said none would ever be written, excluded CL10 from `currentGw`, and called it clean. | §6.1 rules 2–3, R-13, new R-13b, §12 R-list | **CL10 joins the unresolved `currentGw` set** (`cl ∈ {CL2, CL3, CL4, CL6, CL8, CL9, CL10}`) and is *not* clean: it is an unfinished pot that keeps focus until Phase 2's void lands and Phase 3 reclassifies it **CL7**, which rule 2 then claims. Rule 2 also stops restating Phase 2's dirty predicate — **clean is `cl ∈ {CL5, CL7}`**, so `input_version <= settled_version` lives in one place instead of three. CL0 stays excluded from both rules, since PR4 renders nothing at all for a true blank. **R-13 reverses**: `currentGw=3`, `latestSettledGw=2`. New **R-13b** asserts the transition — once the void lands and `cl` becomes CL7, `currentGw=null` and `latestSettledGw=3`. Verified against the Phase 2 plan's §L3 void branch and the `void_reason` check constraint on `gameweek_results`. |
| 3 | Kickoff reconciliation never converges when a kickoff becomes null: a postponed fixture has no due pass to write `source_kickoff_at = null`, so the mismatch re-fires every tick. | §4.7 (new acknowledgement statement + rationale, I-6h) | The invalidating statement now sets **`source_kickoff_at = f.kickoff_at`, including null**, in the same `update` as the `*_ok=false` flags — so the pass fires once per kickoff change instead of forever. Deliberately **not** conditional on the refill succeeding: the `*_ok` flags already record invalidation and gate rendering, while `source_kickoff_at` records only which kickoff the cache was last reconciled against; coupling them would recreate the loop. **I-6h** extends to three assertions — the null postponement is reconciled, a second tick with nothing else changed does **not** reconcile it again, and a later null→timestamp reschedule invalidates exactly once more. |
| 4 | `MatchDetailView.header.kickoffAt` requires a `string`, but `fixtures.kickoff_at` is nullable and v5's own §4.7 fix writes null in place — a postponed fixture cannot build the DTO. | §6.5 (type, new rendering rules), §12 new U-18d | **`kickoffAt: string \| null`**. Phase 1 drops the constraint (`…:107`), the FPL sync writes `nullif(e->>'kickoff_at','')` (`…:771`), and reconciliation writes null — so v5's finding-3 fix created the writer of a value its own DTO forbade. Rendering is defined once, not per component: null → the header time slot reads **"Date TBC"** with the provider's own status word when there is one, and no countdown and no `new Date(null)`. Pre-match modules need no new rule — `model_source_kickoff_at` cannot equal a null kickoff, so a TBC fixture shows **no model chips**, which is right; odds, form, H2H and the table do not depend on the kickoff. `deadlineAt` stays non-null: it is the contest's snapshot, which Phase 2 guarantees. **U-18d** builds the DTO from a seeded `kickoff_at = null` row and asserts it constructs, renders "Date TBC", and carries no `model` key. |
| 5 | B-11 asserts a "league-lens room table" module that `AnalyticsTabView` does not have, and §9.2 defines "You vs the room" as differences rather than a table. | §12 B-11, §6.7 (table + new note) | **Removed, not grown.** `weeklyLabels` is now the **only** module a sat-out settled gameweek advances. `AnalyticsTabView` has seven module keys (§6.6) and no room table; the per-member points-and-net table is Phase 3's race screen. Adding an eighth module and revising §9.2 to make the assertion true would grow the phase to satisfy a test and duplicate a surface Phase 3 already renders — the seven-module contract stands. §6.7 states this so the gate and the assertion cannot drift apart again. |
| 6 | **Should-fix.** "Every table is derived cache: `on delete cascade` from `fixtures`" is false for two of the five: `competition_standings` references `competitions` and `provider_samples` has no fixture key. | §1 opening | Split into three cases. **Per-fixture caches** (`fixture_match_data`, `fixture_provider_data`, `fixture_provider_ids`) cascade from `fixtures`. **`competition_standings`** cascades from **`competitions`** (§1.2) and needs no pruning: at most two rows per competition, `(competition_id, source)`, overwritten in place. **`provider_samples`** is **parentless by design** so a sample of a broken payload outlives whatever prompted the fetch — which means nothing will ever cascade it away, so its bound is its own retention rule, the latest 5 per `(provider, endpoint)` trimmed in the inserting statement (§1.6). |

Two stale source annotations corrected: `result_revisions.observed_at` is
`20260727000001_competitions_gameweeks.sql` (v5 cited a line number that was wrong, and both have since been
replaced with column-name references — see round 6, should-fix).


## Sol round-6 findings mapping (v6 → v7)

*(Superseded in part by the round-7 mapping that follows, which wins where the two disagree: RO-1's evidence, `isGwClean`'s ownership, U-2c's assertion, the strip count and the `latestSettledGw` rationale.)*

Round 6 confirmed five of the six round-5 fixes resolved outright — the narrowed E2 literal ban with
P-19g/P-19h, the converging kickoff acknowledgement, the nullable `header.kickoffAt` with U-18d, B-11's
removed room table, and the three-way cascade split — and marked one **partial**: the resolver now agrees
with Phase 2 about CL10, but nothing else in the plan did.

**Both of the round's false claims were mine.** v6 wrote that seeding `espn_insights = 'infinity'` makes
the existing insights poller dark from the moment the migration lands; checked against the shipped code,
`app/api/cron/tick/route.ts` imports `pollInsights` and calls it directly, and `lib/espn-insights.ts`
contains no reference to `sync_state` at all, so the seeded row is inert and `--revert` reaches nothing.
v6 also inferred that `gameweek_contests.deadline_at NOT NULL` guarantees a match-detail deadline; the
constraint holds per existing row and per league, and this plan's own E-9 neutral deep link has no
contest row anywhere. Neither claim survives in v7, in the body or in any acceptance table.

| # | Finding | Section(s) changed | How v7 resolves it |
|---|---|---|---|
| 1 | CL10 must be an unresolved waiting state on every Phase 4 surface, not only in the resolver: the row-builder prose still called it "terminal and clean" and `AnalyticsTabView` offered only `pre`/`live`/`settled` with no matching strip, so the implementation had to mislabel the gameweek or fail to build the view. | §6.3a (prose + union arm), §6.6 (`AnalyticsStrip`, `currentFocusGw.state`, gate paragraph), §9.1, §12 U-2c / U-14f | The prose now splits the two: **`void` is terminal and clean; `all-called-off` is waiting**, and its arm carries **`waiting: true`** with the settlement-pending caption. Analytics gains **`state: 'awaiting_settlement'`** and the strips **`awaiting_void_not_entered` / `awaiting_void_entered`**; cards freeze as in `live`, there is no lead card, cumulative cards stay visible (a CL10 gameweek is above `latestSettledGw` by rule 2, so no new `suppressed.reasons` value is needed), and `overlapAlert` is unchanged. §9.1 grows from 6 cells to 8. **U-2c** and **U-14f** both drive the CL10 → CL7 transition, through the row builder and through `buildAnalyticsTabView`. A sweep of the whole plan found no other surface treating CL10 as clean or terminal. |
| 2 | A dark-launch key controls nothing until its caller uses the lease: today's cron calls `pollInsights` directly and the function never reads `sync_state`, so `'infinity'` is not dark and `--revert` is not a switch. | §1.7b, §13 step 4, §12 RO-1 | §13 now states plainly that **the old poller stays live through the migration** — the safe state, since insights keep refreshing exactly as today while the new tables sit empty — and that **`espn_insights` is armed only after the lease-gated rewrite deploys**, with the same rule for every other key. New rollout assertion **RO-1** runs per key against the deployed build: with the key at `'infinity'`, one tick makes no provider fetch and no cache write and `sync_state` shows a failed claim. Only a passing RO-1 permits `--key`. §1.7b carries the matching caveat that arming and `--revert` are no-ops against a caller that does not claim. |
| 3 | Match-detail deadlines are league-scoped: the required neutral deep link (`room: null`) has no contest row to read one from, and a multi-league viewer may hold divergent snapshots, so one non-null header field cannot be built. | §6.5 (DTO + rendering rules + loader tests), §8 copy, §12 U-18e / U-18f | `header.deadlineAt` becomes **`string \| null`**, defined as the **selected room's** snapshot; `room.deadlineAt` and `yourCalls[].deadlineAt` carry the per-league values. The neutral case renders **no lock line at all** — `gameweeks.deadlineAt` is explicitly rejected as a stand-in, since §6.1 already establishes it is not authoritative for any contest and it would show a lock time that applies to nobody. Switching rooms re-scopes the header. **U-18e** covers the zero-contest caller, **U-18f** the divergent-snapshot caller including the re-scope on selection change. §8's lock copy now names its league. |
| 4 | **Should-fix.** The intro claimed `input_version <= settled_version` appears nowhere in Phase 4 while §6.6 stated it inline, and the numeric migration anchors had drifted again (`gameweek_audit_log` 279 → 285, `void_reason` 211 → 217). | opening §3, §6.6 rule 1, twelve anchor sites across §0.1, §1.x, §4.7, §6.1, §13 | The intro now says the comparison was **removed from resolver rule 2**, not from the phase, and names the single shared helper **`isGwClean(gw)` in `lib/analytics-math.ts`** that Analytics calls instead of restating it — two call sites, neither a copy. Every remaining numeric line anchor was **replaced with a symbol or column-name reference** (`the result_revisions declaration in …`, `the void_reason check constraint on gameweek_results`, `the drop not null statement`, and so on), because a third round of drift showed the numbers cannot be kept true — a further anchor, the DEFAULT PRIVILEGES comment, had moved from 1072 to 1074 without the review noticing. The only `sql:<line>` strings left in the document sit inside the historical round-2 and round-3 mapping rows, which record what past versions said. |


## Sol round-7 findings mapping (v7 → v8)

*(Superseded in part by the round-8 mapping that follows, which wins where the two disagree: the two-value lease union and RO-1's single seed-a-fixture recipe.)*

Round 7 judged all four round-6 fixes **partial** — not wrong in shape, but each carrying an edge that was
unsatisfiable, unproven, or contradicted elsewhere in the document. Five blockers and three should-fixes,
all inside Phase 4's own surface; none needed a product ruling and none asked another phase's plan to
change.

**The round's clearest false claim was mine again:** v7 said RO-1 could see `sync_state` "record a failed
claim". Checked against the migration, `sync_state` has exactly five columns — `key`, `last_run_at`,
`next_due_at`, `lease_until`, `lease_token` — and `claim_sync_lease` is a bare `update … returning
lease_token`, so a claim rejected by `'infinity'` updates zero rows and leaves the row byte-identical.
There is nothing to observe. Verified alongside the round's other schema points: `apply_fpl_reconciliation`
is the real routine (v7 invented `sync_fpl_gameweeks`), and Phase 3 §5.3 PR3b does export the dirty
predicate from `lib/net-balance.ts` under T-U8.

| # | Finding | Section(s) changed | How v8 resolves it |
|---|---|---|---|
| 1 | **Blocker.** RO-1 asserted a failed claim that `sync_state` cannot record, and a direct caller with nothing due would pass it anyway — so the gate proved nothing. | §12 RO-1, §13 step 4 | Every Phase 4 poller returns **`{ lease: 'claimed' \| 'not_due', fetches, writes }`** and the cron route surfaces it per poller; `'not_due'` is what `claimPhase4Lease` returning null produces, and a caller that never claims cannot emit the field at all. RO-1 seeds a fixture **squarely inside the poller's due window** (so a lease-ignoring caller *would* fetch), asserts `lease: 'not_due'` with zero fetches and writes while the key is at `'infinity'`, then arms the key and asserts the **paired positive case** `lease: 'claimed'` with `fetches >= 1`. The nonexistent failed-claim record is removed, and both sites now say `sync_state` is not consulted for proof. |
| 2 | **Blocker.** U-2c asserted the CL10 and CL7 arms "differ only in `kind`/`waiting`", which no valid CL7 object can satisfy — the `void` arm requires `voidReason`. | §6.3a, §12 U-2c | The assertion is restated against the declared union: `kind` flips `'all-called-off'` → `'void'`, `waiting` is **absent** on the CL7 arm rather than false, `voidReason === 'all_fixtures_void'` appears, `league`/`raceHref` are byte-identical, and **neither arm carries a points or money field at all** — so the no-money/no-points guarantee is structural instead of value-by-value. |
| 3 | **Blocker.** U-19 still claimed six strip variants after §6.6 grew to eight, and U-14f described an unspecified `awaiting_void_*` arm — so the two new strips had no test naming them, while acceptance A said U-14f proved both cells. | §12 U-19, §12 U-14f | U-19 covers **all eight** variants, naming `awaiting_void_not_entered` and `awaiting_void_entered`. U-14f is **parameterised over entered and not-entered**, so each new kind is asserted by name through the CL10 → CL7 transition, and acceptance A's claim becomes true. |
| 4 | **Blocker.** §6.1 rule 5 said `overlapAlert` suppresses cumulative figures while §6.6 and U-14d suppress only the lead card — one contest, two answers depending on which section was implemented. | §6.1 rule 5, §12 U-14d, §12 U-14f | Rule 5 now says **lead card**, with the reason stated: cumulative figures run through `latestSettledGw`, and a backlog of *unsettled* gameweeks does not make settled history wrong — only a **dirty** one does, which is what `dirty`/`dirty_older` are for. U-14d asserts every cumulative card stays present under `overlap`, including when one overlapping gameweek is CL10; U-14f adds the CL10-plus-overlap case. |
| 5 | **Blocker.** Phase 4 declared `isGwClean` the owner of the dirty test, but Phase 3 §5.3 PR3b owns and exports the predicate from `lib/net-balance.ts` (T-U8) so Phases 3–5 share one implementation; two owners let Analytics publish money Phase 3 and Phase 5 suppress. | opening §3 item 3, §6.6 rule 1, new U-14g | `isGwClean` is demoted to a **thin per-gameweek aggregator**: for each league in scope it calls **Phase 3's exported `net-balance` predicate** with that league's `input_version` / `settled_version` and returns clean only when every league is clean. It holds **no version comparison of its own** — one `every(...)` over an imported function — so a change to the dirty rule moves one body in `lib/net-balance.ts`. **U-14g** stubs the imported predicate to report dirty and requires every cumulative card to disappear, proving `isGwClean` cannot answer independently. No change to the Phase 3 or Phase 5 plans was needed. |
| 6 | **Should-fix.** The no-suppression rationale claimed a CL10 gameweek is "by definition above `latestSettledGw`"; if GW3 stays CL10 while GW4 settles cleanly, rule 4 returns 4 and the pending gameweek sits below it. | §6.6 gate bullet, §12 U-14f | The rule is rebased on what actually holds: a CL10 gameweek **contributes no played sample and no settled result**, so the settled-result filter finds nothing to include and no cumulative figure can read it — no ordering claim required. The out-of-order case (GW3 CL10, GW4 settled, `latestSettledGw = 4`) is asserted by U-14f. |
| 7 | **Should-fix.** X-5 and §8 still said picks reveal at "the GW deadline", the unscoped phrase, and U-18f checked displayed values rather than reveal behaviour — so a build could scope the header correctly and still reveal league A's picks on league B's clock. | §0.2 X-5, §6.5 U-18f, §12 B-13 | X-5 now names **`gameweek_contests.deadline_at`** in the reveal rule and states the failing case (A locked 20:00, B at 22:00, viewer switching to B at 21:00 must still see placeholders). U-18f evaluates at a `now` **between** the two deadlines and asserts reveal state per room, not just the displayed value; B-13 runs the same across two leagues with divergent deadlines, including the room switch. |
| 8 | **Should-fix.** The nullable-kickoff writer was attributed to `sync_fpl_gameweeks`, which exists in neither migration nor `lib/sync-fpl.ts`. | §6.5 | Replaced with **`apply_fpl_reconciliation`**, the real routine in both migrations and the RPC name `lib/sync-fpl.ts` calls. The same sentence had also duplicated the `drop not null` clause during round 6's anchor de-brittling; that is cleaned up. |


## Sol round-8 findings mapping (v8 → v9)

*(Superseded in part by the round-9 mapping that follows: the read-back classification became an atomic routine, and RO-1's shared-DB positive cells moved to the harness.)*

Round 8 resolved **6 of the 8** round-7 items outright (U-2c's union assertion, the eight-strip proof, the
single overlap gate, the delegated dirty predicate, the league-scoped reveal deadline and the routine
name). Two came back Partial, with two new should-fixes. All four are inside Phase 4's own surface; none
needed a product ruling and none asked another phase's plan to change.

**The round's false claim was mine again, and it was in the fix itself:** v8 said `claimPhase4Lease`
returning null means "not due". The routine at
`supabase/migrations/20260727000001_competitions_gameweeks.sql` claims on `next_due_at <= now()` **and** a
free lease, so it also returns null when a due key is already held — the case the live cron reports as
`{skipped:'leased'}`. v8's own helper table had said "returns null when leased or not due" one page
earlier, so the plan contradicted itself.

| # | Finding | Section(s) changed | How v9 resolves it |
|---|---|---|---|
| 1 | **Blocker.** A reported lease outcome must distinguish every reachable claim result. v8 reported `not_due` for a due-but-leased key, which is false and contradicts the `{skipped:'leased'}` case Phase 4's own contract defines **[Z7]**. | §0.1 helper table, §4.6, §12 P-18b, §12 RO-1, §13 step 4 | Took the **reason-bearing** option rather than collapsing to `claimed` / `not_claimed`: `claimPhase4Lease` returns `{outcome:'claimed'; token}` / `{outcome:'not_due'}` / `{outcome:'leased'}`, classified by reading the row back once after a failed claim — a plain `select`, no second write, and **no change to Phase 1's SQL routine**. §4.6 gains the three-row outcome table and states that both failures take the identical no-fetch/no-write path, so the distinction is for the rollout operator, not the poller: `not_due` means the switch is off, `leased` means it is on and something else is running. The read is advisory (a lease lapsing between the two statements can read as `not_due`) and that is called out as harmless — RO-1 never depends on it, because RO-1 runs at `'infinity'`, where no lease exists. New **P-18b** asserts all three outcomes against real rows and that both failures leave the row byte-identical. The cron union becomes three-valued at §12 and §13 together. |
| 2 | **Blocker.** RO-1 prescribed one recipe — seed a fixture, expect `fetches >= 1` — for all nine keys. `deriveStandings` makes no provider request, `reconcileMatchCache` never fetches, `pollStandings` is competition-scoped, and §12's shared-DB rule permits scratch cache rows only. | §12 RO-1 | RO-1 gains a **per-key table**: what makes each key due, and what its positive signal is after arming. The five per-fixture network pollers use a **scratch fixture** and assert `fetches >= 1` plus a write confined to that fixture's cache row; `espn_reconcile` uses a scratch cache row with a deliberately mismatched `source_kickoff_at` and asserts `writes >= 1` **with `fetches === 0`**; `espn_standings` and `derived_standings` assert a `competition_standings` write and a `derived` fallback row respectively and **run on the disposable harness**, because neither signal can be produced from scratch rows; `fotmob_slow` runs its RO-1 at the moment D7 arms it. The scratch-rows-only rule is stated as **absolute and winning over RO-1** — no protected row, real fixture, real contest or real competition is touched on the shared DB, and a key with no safe shared-DB signal moves to the harness by rule, not by exception. The negative half of every cell stays safe everywhere, because a dark poller writes nothing. |
| 3 | **Should-fix.** §6.6 carried the corrected no-sample/no-result rationale but §9.1 still repeated the false ordering claim, and U-14f's inventory entry never stated the promised GW3-CL10/GW4-settled case. | §9.1 CL10 cell, §12 U-14f | The §9.1 cell now gives the same reason as §6.6 — a called-off gameweek contributes no played sample and no settled result, so the settled-result filter finds nothing of it to include — and says explicitly that this holds whatever its number is. U-14f gains a **fourth case**: GW3 CL10 while GW4 settles cleanly, asserting `latestSettledGw === 4` (the pending gameweek *below* it, which v7 called impossible) and every cumulative card still present and reading through GW4. |
| 4 | **Should-fix.** U-6e said an every-fixture-void gameweek renders `void` without saying whether Phase 2's result row exists — the CL10-as-terminal mistake round 6 removed, reappearing in a test. | §6.3a U-6e | U-6e is split: **U-6e-i** runs before the `all_fixtures_void` result is written, where the gameweek is CL10 and must render `all-called-off` with `waiting: true`; **U-6e-ii** runs once that clean void result exists and renders `void` with `voidReason === 'all_fixtures_void'` in every league row and no pot. |


## Sol round-9 findings mapping (v9 → v10)

Round 9 confirmed the two CL10/void items resolved (§9.1's rationale and the U-6e split) and returned the
two lease/rollout items as Partial, with one should-fix. Both blockers were escalated to Ananth before any
revision, because one adds DDL to Phase 4's migration and the other changes where the rollout gate runs;
both were ruled GO, the second with a compensating requirement.

**The round's false claim was mine, and it was a claim about the working tree:** v9 called
`{skipped:'leased'}` a *live* contract. It is not. `lib/sync-fpl.ts` returns
`{ran: false, reason: 'not due or leased'}` and `lib/espn-insights.ts` returns `{checked, updated}` with no
lease call at all; the cron route passes that through unchanged. Corrected to "the proposed Phase 4
contract", with today's shapes stated.

**Superseded by v11:** row 1's routine now reads `clock_timestamp()` after the lock rather than relying on
`now()`, and row 2's RO-2 checksum window is the target poller's, not the whole tick's. Read those two
cells as the round-9 rulings, not as the current text — §1.7c and §12 RO-2 are authoritative **[Z8]**.

| # | Finding | Section(s) changed | How v10 resolves it |
|---|---|---|---|
| 1 | **Blocker.** A reported lease outcome must identify the failed claim's *cause*, not a later snapshot. v9 read the row back after `claim_sync_lease` returned null; a holder releasing and advancing `next_due_at` in between makes the helper report `not_due` for a `leased` failure, and concurrent arming produces the reverse. Calling it "advisory" contradicted the reason-bearing contract. | new §1.7c, §0.1 helper table, §0.1 E1 + E2, §4.6, §12 P-30…P-36 | **Ruling: GO on the atomic routine.** New Phase-4-only `claim_phase4_lease(p_key, p_lease_seconds)` does `select … for update` → classify → claim in **one transaction** and returns `(outcome, token)`. `for update` is the fix: a second claimer blocks, then reads the winner's lease and returns `leased`, which is true when returned rather than a guess about a past moment. `not_due` is tested first so a dark key always reports `not_due`. Phase 1's `claim_sync_lease` is **untouched** and leaves Phase 4's approved RPC set, so a Phase 4 call to it is now itself an E1 failure. The routine repeats `arm_sync_key`'s hard-coded nine-key allowlist — scanned as a set against `PHASE4_SYNC_KEYS` **and against the other routine's copy** — and takes the full Phase 1 privilege pattern per decision #28: `security definer`, `search_path = ''`, EXECUTE revoked from `public`/`anon`/`authenticated`, granted to `service_role`. E2's approved-routine list grows from two names to three, body compared verbatim. `claimPhase4Lease` becomes a thin mapper with no comparison and no second query. **P-30…P-36** cover the three outcomes, byte-identical rows on both failures, the two-session concurrency case (exactly one `claimed`, the other `leased`, never two `claimed` and never `not_due`), the release/expiry/arming interleavings that broke v9, the rejected `fpl-sync` key, and the privilege grants. |
| 2 | **Blocker.** RO-1 could not both exercise the deployed caller and obey the scratch-row limit: making a poller due means writing `fixtures`; `pollTeamNews` fetches league-wide and Understat discovery writes ids across fixtures, so neither write set is confined to one scratch fixture; harness-only cells contradicted "against the deployed build"; and the FotMob row defined no setup, signal or cleanup. | §12 RO-1 (both halves + per-key table + scratch rule), §12 RO-2, §13 step 4 | **Ruling: GO on the harness, scratch-rows-only stays absolute** — the Phase 1 prod-write incident settled that shared reference tables are not isolated by league scoping, and a test's convenience does not reopen it. RO-1 splits: the **negative** half runs one real prod tick with the key at `'infinity'` and needs no seeding at all (a dark poller writes nothing, and a caller that ignores the lease cannot emit the field); the **positive** half runs on a **disposable backend wired to the exact deployed artifact** — same build SHA, same env, container DB from the full migration chain — and tears down after. The per-key table now gives each key its own due setup, its own **provider-specific** counter, and its **enumerated write set**, including the two fan-outs the reviewer named: `team_news` writes every due fixture of the seeded league, Understat writes the discovered provider-id rows as well as the xG row. `fotmob_slow` is fully defined (post-FT fixture, `FOTMOB_ENABLED` in the harness env, FotMob counter plus the slow-provider block) and has **no production cleanup because D7 gives it no production run**. **Compensating requirement, per Ananth:** new **RO-2** puts prod truth back immediately *after* each arming — one real tick, assert that key's `sync_state` row advanced (`last_run_at` moved, `next_due_at` in the future) and the E3/P-20 protected-table checksums are unchanged, `--revert` on failure before the next key. RO-1 proves the switch is real and the dark poller inert; RO-2 proves the live poller does its work and nothing else. |
| 3 | **Should-fix.** The plan called `{skipped:'leased'}` a live contract; the working tree has `syncFpl` returning `{ran:false, reason:'not due or leased'}` and `pollInsights` returning `{checked, updated}` with no lease call. | §4.6 | Described as **the proposed Phase 4 response contract**, with both current shapes stated as what exists today and the note that the deployed code has no lease outcome to report until those callers are rewritten — which is exactly what RO-1's negative half detects **[Z7]**. |

---

## Sol round-10 findings mapping (v10 → v11)

Round 10 confirmed the caller-shapes item resolved and returned the claim routine and the RO-1/RO-2 pair as
Partial: five blockers, three should-fixes. **Every finding was fallout from text v10 itself added** — the
routine, the split RO-1 and the new RO-2 — which is the pattern that put a convergence guard on this round.
Nothing needed escalation: no product ruling, no reach outside this document, and the one judgement call
(how tightly to scope RO-2's checksum window) was settled by Ananth in the same authorization.

**The round's false claim was mine again, and it was a claim about PostgreSQL:** v10 said the three-way
outcome is "true at the moment it is returned" while classifying with `now()`, which is transaction-stable.
A caller that blocked on the row lock for two seconds classified against its start time, so a lease that
expired one second in was still reported `leased`. The fix is one `clock_timestamp()` after `for update`.

| # | Round-10 finding | Sections touched | Resolution in v11 |
|---|---|---|---|
| 1 | **Blocker.** Phase 4 must have one authoritative claim path. §4.6 still told pollers to call `claim_sync_lease`, which E1 rejects in any Phase 4 file, and which cannot produce the three-way result. | §4.6 | The opening rule now names `claim_phase4_lease` (§1.7c) and states that **only the claim changes hands** — `renew_sync_lease` and the token-conditioned `release_sync_lease` / `release_sync_lease_jittered` stay Phase 1's routines, used unchanged. |
| 2 | **Blocker.** The classification time must be taken after the row lock; `now()` is transaction-stable, so a caller that waited returns a stale answer. | §1.7c routine body + rationale | One `v_now := clock_timestamp()` immediately after `for update`, used for both comparisons and for `lease_until` / `last_run_at`. The rationale is rewritten: `for update` **plus** `clock_timestamp()` is the whole fix, and v10's "true at the moment it is returned" is named as false. |
| 3 | **Blocker.** The concurrency tests forbade valid serialization orders — claim-first/arm-second correctly returns `not_due`, release-first/claim-second correctly returns `not_due`. | P-34, new P-34b | P-34 is now a six-row table with **one assertion per lock order**, driven by explicit barriers: claim-first/arm-second → `not_due`; arm-first/claim-second → `claimed`; claim-first/release-second → `leased`; release-first/claim-second → `not_due`; expired lease on a due key → `claimed`; two racing claims → exactly one `claimed`, the other `leased`. What must never happen in any order is two `claimed`. **P-34b** covers a claimer that waits longer than the lease it is waiting on. |
| 4 | **Blocker.** RO-1's enumerated write sets listed cache writes only, while a valid run must write the key's own `sync_state` row twice — so all nine positive cells failed on correct behaviour. FotMob had no `fixture_provider_ids` row, and E-2 says an unmapped fixture is never polled. | §12 RO-1 rule, FotMob cell, team-news cell | Every write set now includes **that key's own `sync_state` row**, stated once as a rule above the table, with P-20's "no *other* key's row moves" still holding. The FotMob cell seeds a `fixture_provider_ids` row (cheaper than driving discovery, which would add a second provider dependency); the team-news cell requires the FPL team mappings for both clubs, without which the poller yields a silent zero. |
| 5 | **Blocker.** RO-2 bracketed the whole production tick, which also runs FPL reconciliation, score polling, contest locking and settlement — all legitimate protected-table writers. It could not attribute a change to Phase 4. | §12 RO-2, §13 step 4 | **Ruling (Ananth): take the reviewer's scoping.** RO-2 now asserts over the **target poller's own `[started, finished]` window**, reported by the deployed tick from the poller's own `clock_timestamp()` calls, with a three-part mechanism: (1) row-level `updated_at` attribution for the protected tables that have the column — `fixtures`, `predictions`, `gameweek_entries`, `gameweek_picks`, `knockout_predictions`, `knockout_brackets`, all verified against the migrations; (2) checksums for the tables that do not, where a move must be **explained** by a non-zero earlier-stage counter or it means `--revert`; (3) arming during a quiescent window, confirmed from the tick's own zero counters. The limits are stated rather than papered over: a concurrent user write inside the window, and `updated_at` being a default rather than a trigger. The exact whole-schema diff stays on the harness, where E3/P-20 can be exact. |
| 6 | **Should-fix.** P-36 checked `anon` and `authenticated` but not `PUBLIC`; §12 never registered P-30…P-36; P-19g still said "two approved routines" after E2 grew to three. | P-36, §12 inventory, P-19g, acceptance E | P-36 now asserts `PUBLIC` has no EXECUTE — the grant a `security definer` routine gets by default, and the one that matters most. §12 registers **P-30…P-36** with their assertions; acceptance E names them. P-19g feeds the scanner **all three** approved routines verbatim. |
| 7 | **Should-fix.** The opening round-8 summary still said only two keys use the harness, while v10 moved every positive half there. | Opening summary, point 2 | Corrected to all nine positive halves on the disposable harness, with only the dark negative half on the shared prod DB, and the reason stated: making *any* poller due means writing a shared reference table. |
| 8 | **Should-fix.** Two sections were both numbered §1.7c, so references to §1.7c were ambiguous. | §1.7d heading | The jitter routine is renumbered **§1.7d**; §1.7c is the claim routine alone. |
| — | **FREEZE (round 11).** Round 11 returned 3 blockers, all inside the RO-1/RO-2 cluster: one carry-over (RO-1 omits the `provider_samples` write class) and two **new, arising from v11's own text** (RO-2's `updated_at` attribution is unsound — the columns are `default now()`, not trigger-maintained, and deletes escape; RO-2 is not executable — no approved routine returns a database-clock boundary and E1 rejects an unapproved RPC). | Header status line, carve-out box above §12 RO-1, pointer at §13 step 4 | **Plan closed at v11, status APPROVED-WITH-CARVE-OUT**, ratified by Ananth. Two of three findings were defects in text v11 itself added, which is the convergence signal the guard was set to catch: the document had begun generating its own defects, so the tail moves out of plan prose. Everything in this document is contract **except the RO-1/RO-2 rollout-assertion cluster**, which becomes an **implementation-time contract under decision #34** — write sets enumerated from the actual poller code, RO-2's attribution designed against the real tick response, both reviewed adversarially as their own slice, and **no arming until that review passes**. The RO-1/RO-2 prose is deliberately left unedited; the carve-out box supersedes it. Ten review rounds, r1 → r11. |
