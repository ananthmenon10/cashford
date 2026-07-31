# Phase 2 — Gameweek engine. Deep implementation plan v4

v4 after Sol review round 2 (6/14 closed; 8 gaps + 7 new findings — all folded in; round-2
mapping at bottom). v3 was after round 1 (14 findings).
Owner: orchestrator. Implementer: Opus 5. Reviewer: Sol. Tests: Sonnet (authors from THIS doc,
not from the implementation).

Phase 1 as-built context (migration 20260727000001, Sol-approved): `gameweek_contests` (pot per
league×GW: stake_inr snapshot, deadline_at snapshot, status open/locked/settling/settled/void,
composite FKs), `gameweek_fixtures` (uuid-pk membership history, states active/void/excluded,
is_current, one-active + one-current partial indexes, unique(id,fixture_id)), `member_competitions`
(per-member eligible_from, left_at), `result_revisions`, lease-tokened `sync_state`, routines
`apply_fpl_reconciliation` / `apply_score_update` / `create_league` / `join_league` /
`activate_competition` / `run_gameweek_maintenance`.

## 0. Schema (Phase 2 migration `2026…_gameweek_entries.sql`)

0. **Unique-key targets added to Phase 1 tables in THIS migration** (the FK web below is
   impossible without them — round-2 finding 1):
   `gameweek_contests unique (id, league_id)` and
   `unique (id, league_id, gameweek_id, competition_id)`;
   `gameweek_fixtures unique (id, gameweek_id, fixture_id, competition_id)`;
   `gameweek_entries unique (id, gameweek_id, competition_id)` and
   `unique (id, gameweek_contest_id)` (declared with the table below).
1. **`gameweek_entries`** (id uuid pk, gameweek_contest_id uuid not null, league_id uuid not
   null, gameweek_id uuid not null, competition_id uuid not null, user_id uuid not null
   references profiles(id), status text not null default 'entered' check (status in
   ('entered','needs_update','locked_in','invalid')), created_at timestamptz not null default
   now(), unique (gameweek_contest_id, user_id),
   composite FK (gameweek_contest_id, league_id, gameweek_id, competition_id) →
   gameweek_contests(id, league_id, gameweek_id, competition_id),
   composite FK (league_id, user_id, competition_id) → member_competitions ← the entrant is
   provably an eligible member of this league's competition).
   Status semantics (§L8 below): 'entered' = complete; 'needs_update' = a pre-deadline fixture
   addition invalidated completeness; at lock, complete entries → 'locked_in', incomplete →
   'invalid' (visible, stakes nothing). Settlement reads ONLY 'locked_in'. No withdraw ⇒ no
   user-initiated deletion, ever.
2. **`gameweek_picks`** (id uuid pk, entry_id uuid not null references gameweek_entries(id) on
   delete cascade, membership_id uuid not null, gameweek_id uuid not null, fixture_id uuid not
   null, competition_id uuid not null, pred_home int not null check (pred_home between 0 and 99),
   pred_away int not null check (pred_away between 0 and 99), updated_at timestamptz not null
   default now(), unique (entry_id, fixture_id),
   composite FK (entry_id, gameweek_id, competition_id) →
   gameweek_entries(id, gameweek_id, competition_id),
   composite FK (membership_id, gameweek_id, fixture_id, competition_id) →
   gameweek_fixtures(id, gameweek_id, fixture_id, competition_id) ← the pick's membership
   provably belongs to the SAME gameweek and competition as the entry (full-scope, round-2 fix).
   **Normative completeness/scoring rule (L4): a pick counts when its fixture_id matches an
   effective-active fixture of the gameweek — NEVER require pick.membership_id to equal the
   current active membership id. The membership FK proves provenance (the fixture really was in
   this GW when picked); after void-then-return the old membership row persists so the FK stays
   valid, and the pick counts again by fixture_id.**
3. **`gameweek_entry_results`** (entry_id pk, **gameweek_contest_id uuid NOT NULL** ← declared
   non-null so the coupled FK actually binds (a null referencing column would bypass a
   composite FK), **coupled composite FK (entry_id, gameweek_contest_id) →
   gameweek_entries(id, gameweek_contest_id)** ← an entry from contest A can never carry a
   result row pointing at contest B; test BOTH a null contest id and an entry/contest mismatch,
   points int not null,
   exacts int not null, goal_error int not null, net_inr int not null, is_winner boolean not
   null, per_fixture jsonb not null ← verdict rows, settled_version int not null) — NORMALIZED
   per-entry outcome (replaces the draft's winners uuid[] + blob; winners are provably entrants
   by construction). Plus **`gameweek_results`** (gameweek_contest_id pk/fk, outcome text not
   null check (outcome in ('settled','void')), void_reason text check (void_reason in
   ('no_entrants','single_entrant','all_fixtures_void')), tiebreak_used text check
   (tiebreak_used in ('none','exacts','goalError','split')) ← nullable, required when
   outcome='settled', settled_version int not null ← the input_version this result CONSUMED
   (dirty predicate reads it, §0.6), **last_settle_cause text not null check (last_settle_cause
   in ('initial','result_revision','membership_change','combined'))** ← the UI-safe re-settle
   cause (league members may read this row; the service-only audit log keeps the full history —
   added for Phase 3 finding 3), settled_at timestamptz not null default now()) — one
   current snapshot; history lives in audit + reversed transfers. **Per-entry result rows exist
   ONLY for outcome='settled'; void outcomes write gameweek_results + audit and nothing else.**
4. **`transfers` changes**: ALTER contest_id DROP NOT NULL; ADD gameweek_contest_id uuid;
   CHECK (exactly one of contest_id / gameweek_contest_id is non-null); composite FK
   (gameweek_contest_id, league_id) → gameweek_contests — league provably matches; payer and
   receiver FKs to gameweek_entries via (gameweek_contest_id, user_id) for gameweek rows.
   Existing Dues/simplifyDebts queries: **Phase 2 updates the Dues aggregation to UNION legacy
   `contest_results` net with `gameweek_entry_results.net_inr`** (this is in-scope — the
   acceptance "pot lands in Dues" is honest only with this change). Home-tab net + analytics
   composition is Phase 3/5 and is listed there.
5. **`gameweek_audit_log`** (id, gameweek_contest_id fk, action text, cause text, input_version
   int, detail jsonb, created_at) — every claim/settle/void/re-settle writes one row with cause
   ('initial'|'result_revision'|'membership_change') and version.
6. **Concurrency spine**:
   - `gameweek_contests.input_version int not null default 0`. **Executable bump rule** — the
     version increments exactly once per affected contest per transaction when the CANONICAL
     INPUT PROJECTION changes: (a) a fixture's effective state (per §0b) transitions among
     active/void/absent; (b) an effective-active fixture's stored scores change; (c) an
     effective-active fixture's status changes to or from 'finished' (readiness change, even
     with unchanged scores). NO bump for repeated observations, excluded-only history churn, or
     changes to non-member fixtures. One reconciliation changing membership AND scores bumps
     once with cause 'combined'.
   - **Dirty predicate**: a contest is dirty iff `input_version >
     gameweek_results.settled_version` (no results row yet + status settled/void is corrupt →
     sync_issue).
   - **Dispatcher states (complete):** the worker claims a contest ONLY when it has ≥2
     locked_in entries AND is ready (every effective-active fixture finished with scores —
     required for INITIAL, DIRTY, and EXPIRED claims alike; a finished→live status correction
     makes a dirty contest unready, and it simply waits). Expired 'settling' rows (
     claim_started_at > 10 min): lock, re-read; reclaim only if ready, else clear the claim and
     restore `claim_prior_status` (a new column stamped at claim time — 'locked', 'settled', or
     'void'). **Dirty W1 voids (<2 locked_in) never claim: a maintenance path advances
     settled_version to the current input_version, writes an audit row, and leaves the outcome
     void — atomic, no compute needed.**
   - Phase 2 migration MODIFIES `apply_fpl_reconciliation` and `apply_score_update` to apply
     the bump rule (both direct ESPN calls and reconciliation-internal writes).
   - **Lock ordering protocol — ONE order for every writer, deadlock-free by construction:**
     1. Competition advisory gate `pg_advisory_xact_lock(hashtextextended(competition_id::text, 1))`
        for reconciliation, maintenance, and score updates (not needed for single-GW
        entry/settle paths, which start at step 2).
     2. Affected gameweek advisory locks in ASCENDING UUID order
        (`pg_advisory_xact_lock(hashtextextended(gameweek_id::text, 0))`).
     3. Fixture rows FOR UPDATE in ascending UUID order.
     4. Contest rows, then league_competitions/member_competitions rows, each in ascending
        UUID order.
     `apply_score_update` is REWRITTEN in this migration to take the gameweek advisory lock(s)
     of the fixture's memberships BEFORE its fixture row lock (currently it locks the fixture
     first — that inversion would deadlock against settlement claims). Maintenance locks every
     gameweek it may touch, ascending, up front. After acquiring locks, every writer RE-READS
     membership/deadline state before acting. Writers: enter/edit-picks, mirror, settlement
     claim + finalize + abort, maintenance, reconciliation, score updates, leave/archive
     (step 4 rows).
7. **RLS** (enabled on all new tables in the migration):
   - gameweek_entries: select where league member (contest's league ∈ my_league_ids()) —
     entrant identity/count is public product info ("6 of 9 in").
   - gameweek_picks: select where (entry is mine) OR (contest deadline_at ≤ now()) — the
     REVEAL RULE LIVES IN RLS, not the API (a direct authenticated Supabase query must not
     leak picks pre-deadline). Implemented via exists-join through entries→contests.
   - gameweek_entry_results / gameweek_results / transfers additions: league members read.
   - gameweek_audit_log: no policies (service only). No INSERT/UPDATE/DELETE policies anywhere;
     writes via routines. New tables are NOT added to any realtime publication (picks
     especially). All routines: SECURITY DEFINER, set search_path='', fully-qualified names,
     REVOKE from public/anon, GRANT authenticated only for the user-facing ones.

## 0b. Effective membership rule (settlement input; replaces every "lock snapshot" mention)

Phase 1 history can hold MULTIPLE rows per (gameweek, fixture) (A→B→A). Settlement derives ONE
effective state per (gameweek_id, fixture_id):
- If an ACTIVE row exists → counted, needs the fixture final.
- Else if ANY historical row is void → counts once as VOID (P2 verdict for everyone).
- Excluded-only history → ignored entirely.
Active wins over older void rows; void wins over a later excluded return. The settle trigger
(L6): contest locked AND every effective-ACTIVE fixture is status='finished' with both scores
non-null.

## 1. Value objects (pure layer — lib/gameweek-points.ts, lib/gameweek-settle.ts)

```ts
type Pick = { fixtureId: string; predHome: number; predAway: number }        // 0..99 ints
type FixtureResult =                                                          // strict union
  | { fixtureId: string; state: 'final'; home: number; away: number }        // both required
  | { fixtureId: string; state: 'void' }
type Entry = { userId: string; picks: Pick[] }              // locked_in entries only (§L8)
type GwInput = { entries: Entry[]; results: FixtureResult[]; stakeInr: number }
type UserScore = { userId: string; points: number; exacts: number; goalError: number;
                   perFixture: Array<{fixtureId: string; verdict: 'exact'|'result'|'miss'|'void'; pts: 0|1|3}> }
type GwOutcome =
  | { kind: 'settled'; scores: UserScore[]; winners: string[]; potInr: number;
      transfers: Array<{fromUserId: string; toUserId: string; amountInr: number}>;
      tiebreakUsed: 'none'|'exacts'|'goalError'|'split'; diagnostics: string[] }
  | { kind: 'void'; reason: 'no_entrants'|'single_entrant'|'all_fixtures_void' }
```
INPUT VALIDATION (throws, never guesses): stakeInr positive integer; unique userIds; unique
fixtureIds per entry AND in results; every pick's predictions 0..99 ints. A locked_in entry
MISSING a pick for a counted final fixture is INVALID INPUT (loud error — §L8 makes it
impossible; if it happens the data is corrupt). Extra picks with no result (stale, e.g. fixture
left the GW) score nothing and emit a diagnostics entry. Outputs (scores, winners, transfers)
are deterministically sorted (userId asc, fixtureId asc) before returning.

## 2. Points rules (LOCKED — from rulebook)

P1. Per counted final fixture: exact scoreline → 3 pts. Correct result (sign of home−away
    matches) but not exact → 1 pt. Else 0. Exact implies result; award is 3, never 4.
P2. Void fixtures: verdict 'void', 0 pts, excluded from exacts count AND goalError for everyone.
P3. GW points = Σ per-fixture pts over counted final fixtures only.
P4. Stale picks (no matching result): diagnostics + ignored (see §1 validation). Results for
    fixtures no entrant picked: valid (everyone scores 0/verdict 'miss'? NO — a result nobody
    picked simply contributes nothing to anyone; with §L8 this can only be a fixture that was
    active but every entry predates… impossible for locked_in entries — treat as invalid input,
    same loud-error rule).

## 3. Winner + tiebreak rules (LOCKED)

W1. 0 locked_in entries → void('no_entrants'). Exactly 1 → void('single_entrant') — no
    transfers (ante is notional until settlement).
W2. All effective fixtures void → void('all_fixtures_void'), regardless of entry count.
    Void PRECEDENCE: no_entrants > single_entrant > all_fixtures_void. 0/1-entrant contests
    void AT LOCK, without waiting for results.
W3. Candidates = max points. |1| → winner, tiebreakUsed='none'.
W4. Else filter by max exacts. |1| → winner, tiebreakUsed='exacts'.
W5. Else filter by MIN goalError = Σ over counted final fixtures of
    |predHome−actualHome| + |predAway−actualAway|. |1| → winner, tiebreakUsed='goalError'.
W6. Else all remaining split, tiebreakUsed='split'. If ALL entrants tie: everyone wins,
    transfers = [] (explicitly legal).
W7. "Everyone scored 0" is NOT special: W3–W6 still select the closest wrong predictions.

## 4. Money rules (LOCKED)

M1. Winners pay nothing. Each loser pays exactly `stake`. Total transferred = stake × loserCount.
    Gross pot metadata = stake × entrantCount (display only).
M2. Single winner receives stake × loserCount.
M3. Split among k winners — PER LOSER (matches lib/settlement.ts convention exactly): for each
    loser, sort winners by userId asc; base = floor(stake/k); remainder = stake mod k; the
    first `remainder` winners get base+1, the rest get base. Zero-value transfer rows are
    omitted. Invariants (asserted in code AND in the finalize routine): every loser's outbound
    total = stake; Σnet = 0; every emitted amount is a positive integer. Works when k > stake
    (base 0, only remainder rows).
M4. transfers emitted as loser→winner rows into `transfers` with gameweek_contest_id (§0.4).
M5. RE-SETTLE NEVER DELETES MONEY HISTORY: prior gameweek transfers for the contest are marked
    reversed=true; the new settlement version's transfers are inserted; gameweek_results/
    entry_results are updated to the new snapshot with **settled_version = claim_input_version
    (the version the claim captured — NOT +1 arithmetic: input may have advanced by more than
    one, and writing anything less than the consumed version leaves the contest dirty
    forever)**; audit row records cause + versions.
    Dues consumes non-reversed rows (existing `reversed` semantics). Test changed-winner AND
    unchanged-winner corrections.

## 5. Lifecycle rules

L1. Entry allowed while contest deadline_at > clock_timestamp() CHECKED INSIDE the routine
    AFTER taking the gameweek advisory lock + contest row lock (a request that waited on a lock
    past the deadline is rejected — `now()` is transaction-start time, so use
    clock_timestamp()). Entry requires a pick for EVERY effective-active fixture. One
    transaction: entry + picks.
L2. Edits: replace picks any time pre-deadline (same lock + clock rule); entry row permanent.
L3. Lock: at deadline (run_gameweek_maintenance extension, under §0.6 locks): entries with
    complete pick sets → 'locked_in'; incomplete ('needs_update' never resolved) → 'invalid'.
    **Immediate W1 voids (0/1 locked_in) are written BY MAINTENANCE in the same transaction:
    gameweek_results (outcome='void', void_reason, settled_version=input_version) + status=
    'void' + audit row — no transfers, no entry-result rows, no claim needed.** The L7 claim
    path handles only contests with ≥2 locked_in entries (its readiness gate — all
    effective-active fixtures final — applies only there; all-void W2 contests become ready
    trivially and settle through claim/finalize returning kind:'void').
L4. Fixture voided after entries exist: picks stay stored; effective state void ⇒ P2. If it
    returns pre-deadline (new active membership), the effective state is active again and the
    ORIGINAL picks count (they reference the fixture; pick rows survive membership churn —
    completeness is evaluated against effective-active fixtures, and a pick's membership_id
    reference may point to the older membership row; completeness check matches on fixture_id).
L5. Fixture added to the GW post-deadline: Phase 1 guarantees state='excluded' ⇒ ignored (§0b).
L6. Settle trigger: locked AND every effective-active fixture finished with scores (§0b). Also
    re-settle trigger: settled/void contest marked dirty by input_version bump (result
    revision OR membership change) → reclaim per M5.
L7. Settlement protocol — STORED state machine on gameweek_contests: columns `claim_token uuid`,
    `claim_started_at timestamptz`, `claim_input_version int` (all null when not settling).
    Three service-only routines + pure TS compute (the TS engine is the ONLY place the math
    lives; SQL validates invariants but never re-computes):
    1. `claim_gameweek_settlement(contest_id)`: locks per §0.6 order; verify claimable (initial
       ready, dirty, or expired-settling per the §0.6 worker predicate); set status='settling',
       claim_token=gen_random_uuid(), claim_started_at=now(),
       claim_input_version=input_version; capture and return the canonical input snapshot
       (locked_in entries+picks, effective fixture results per §0b, stake) + token + version.
    2. TS computes GwOutcome from the snapshot (pure, golden-tested).
    3. `finalize_gameweek_settlement(contest_id, token, version, outcome)`: locks per §0.6;
       writes ONLY when status='settling' AND token = stored claim_token AND version =
       claim_input_version AND version = current input_version. On same-token version mismatch
       (input changed mid-compute): clear the claim, restore status to 'locked' (or leave
       settled+dirty for a re-settle), and RETURN a retry result — never RAISE after changing
       state (an exception would roll the release back). On old/unknown token: change NOTHING,
       return stale. On version-mismatch release, restore `claim_prior_status` ('locked',
       'settled', or 'void'). On SETTLED success: VALIDATE money invariants (M3 list, winners ⊆
       entrant set, per-entry rows complete) and write entry_results + results
       (settled_version=version) + transfers (reversal rule on re-settle) + status='settled' +
       audit + clear claim columns, all atomically.
       **VOID success branch (outcome kind:'void', e.g. W2 all-void — including a re-settle
       flipping settled→void):** reverse any prior non-reversed transfers for the contest,
       DELETE the current gameweek_entry_results snapshot rows (the replaceable current
       snapshot — "never delete" protects transfer and audit HISTORY, not snapshots), upsert
       the void gameweek_results row (outcome='void', reason, settled_version=version,
       tiebreak null), status='void', audit, clear claim — atomically.
    4. `abort_gameweek_settlement(contest_id, token)`: token-conditioned claim release for
       compute failures, restoring claim_prior_status (crash recovery is the expired-claim
       scan).
L8. COMPLETENESS RULE (product decision — logged): if FPL adds an ACTIVE fixture to an open GW
    after entries exist, affected entries flip to 'needs_update'; the UI/API surfaces the
    missing pick; an edit restores 'entered'. At the deadline, entries still incomplete become
    'invalid': visible as a system-invalidated submission, stakes NOTHING, wins nothing. This
    is not withdrawal (user never chose it) and no one is charged for a fixture they never saw.
L9. Eligibility (enforced inside enter routine): league_competitions row active AND its
    eligible_from gameweek NUMBER ≤ target gameweek number (same competition, compare numbers
    not UUIDs); member_competitions row with left_at null AND its eligible_from number ≤ target
    number; NULL eligible_from (either level) = NOT YET ELIGIBLE (pending backfill), never
    "eligible from the start". **Leave/archive serialization: enter and mirror lock the
    matching league_competitions and member_competitions rows (§0.6 step 4) while validating;
    every leave/archive mutation locks the same rows in the same order first — an entry
    validated as eligible cannot interleave with a concurrent leave.** Post-lock
    departure/archival does NOT remove an entrant from settlement (entry snapshot is the
    truth); leaving sets left_at, never deletes money history.

## 6. Case matrix (Sonnet: every row ≥1 test; docs/testing/phase2-cases.md)

Points: exact win/draw/loss ×3 · result-only home/away/draw ×3 · miss ×2 · 0-0 exact · 4-3
exact · void excluded from all three aggregates · stale pick diagnostics · invalid-input set
(missing pick for counted fixture, dup fixture in results, dup user, final missing a score,
non-integer stake, pred out of range) each throws.
Tiebreak: unique max · exacts breaks 2-way · 3-way partial then goalError · goalError breaks ·
split 2-way · split 3-way with per-loser remainders 1 and 2 (ascending userId) · all-zero week
winner via goalError · identical picks → guaranteed split · ALL entrants tie → everyone wins,
zero transfers.
Money: 2 entrants · 7 single winner · split with remainder · k > stake · zero-value rows
omitted · property test (500 random GWs): Σnet=0, integers, each loser pays exactly stake,
total = stake×losers · deterministic output ordering.
Void: 0 entrants · 1 entrant · all fixtures void · precedence (0 entrants AND all void →
no_entrants; 1 entrant AND all void → single_entrant) · 9-of-10 void settles on 1 final ·
0/1-entrant voids at lock before results · zero-active-fixture GW rejects entry.
Lifecycle/persistence: enter/edit pre-deadline · deadline race (request locks pre-deadline,
clock passes mid-wait → rejected) · complete-entry enforcement (9/10 picks; pick for excluded
fixture; pick for other-GW fixture) · L4 void-then-return (original picks count) ·
active→void→active and active→void→excluded collapse (effective rule §0b, incl. duplicate
history rows) · L5 excluded ignored · L8 flow (addition → needs_update → edit → locked_in;
unresolved → invalid, stakes nothing, visible) · L9 eligibility grid (null/current/future
boundary × league/member level, late join at deadline±ε, departed member, archived league,
post-lock departure still settled) · settle only when effective-active all final · claim/
finalize (token mismatch, version bump mid-compute rejects finalize, abandoned-claim reclaim
after expiry, double claim) · re-settle changed winner + unchanged winner (reversed rows kept,
no dup active transfers, Σ non-reversed net = 0, audit chain) · multiple revisions · one
revision fans to N leagues · sync-vs-entry and sync-vs-settle serialization (advisory lock) ·
blank GW (4 fixtures) · double GW (12, one team twice).
Security: RLS pick reveal before/at/after deadline via DIRECT authenticated queries · other
league invisible · cross-league/cross-competition FK attack rows rejected · routines not
executable by anon · realtime publication excludes picks · service-only settlement routines.
Integration (API/DB smoke, scratch league ZZ-TEST-*, ordered cleanup; NO browser — entry UI is
Phase 3): 5 users enter via routines, one skips, one goes needs_update and resolves, scripted
scores land, settle, verify transfers + Dues aggregation, then a revision flips the winner →
re-settle with reversal; verify Σ and visibility end-state.

## 7. API surface (route handlers, Expo-ready — NO server actions for new mutations)

- POST /api/gw/enter {leagueId, gameweekId, picks[]} · POST /api/gw/picks (edit) — handlers use
  the SESSION-SCOPED server client so auth.uid() inside the routines is the real user (service
  role is reserved for settlement/sync). Zod is the OUTER check only (shape, UUID format, dup
  fixture ids, extra fields, 0..99); the routine re-validates EVERYTHING (membership,
  eligibility, completeness, deadline by clock_timestamp after locks, active fixtures,
  league/gameweek pair coherence).
- POST /api/gw/mirror {fromLeagueId, gameweekId, targets: [{leagueId, acceptedStakeInr}]} —
  ONE atomic routine; the accepted stake TRAVELS IN THE REQUEST (consent is provable): after
  the §0.6 locks, each target's acceptedStakeInr is compared to the contest's stored stake_inr
  — any mismatch (stale UI, stake changed) returns the per-target error list and writes
  NOTHING. Validates membership, eligibility, competition, completeness, and deadline
  independently per target; all-or-nothing; duplicate target leagueIds rejected.
- GET /api/gw/contest?league&gw → contest state for UI (status, pot, entrant count, my entry
  status incl. needs_update, deadline).

## 8. Sequencing + acceptance

1. Pure modules + full unit matrix green (no DB).
2. §0 migration (disposable-Postgres tested twice, like Phase 1).
3. DB layer: entry/edit routines, claim/finalize, maintenance extension (L3), reconciliation/
   score-update modifications (input_version), Dues aggregation update.
4. API routes.
5. Integration smoke `scripts/verify-phase2.mjs` per §6 Integration (shared DB, scratch league,
   ordered cleanup; explicitly NO browser step — that moves to Phase 3 with the entry UI).
Acceptance: all §6 green via `npm run test:phase2`; verify-phase2.mjs passes; legacy suites
untouched-and-green; Phase 1 suites still green; typecheck/build green.

## Sol round-2 findings mapping
Gap 1/New 1→§0.0 unique targets + full-scope pick FKs + coupled result FK · Gap 2→§0.2 ·
Gap 4/New 3→L7 stored state machine (claim_token/claim_started_at/claim_input_version,
non-raising release, abort routine, expired-settling scan) · Gap 6/New 2→§0.6 lock ordering
protocol (competition gate → gameweeks asc → fixtures asc → contest/eligibility rows;
apply_score_update rewritten to comply) · Gap 7/New 4→§0.6 executable bump rule + dirty
predicate + settled_version consumed marker · Gap 10/New 6→L9 leave/archive row-lock
serialization · Gap 11/New 7→§7 mirror targets carry acceptedStakeInr · Gap 12/New 5→L3
maintenance writes W1 voids atomically (no claim, no entry-result rows); claim path = ≥2
entries only · L4 conclusion→§0.2 normative fixture_id rule.
Round-2 test additions (append to §6): entry-vs-leave and mirror-vs-archive races ·
apply_score_update direct-call vs claim deadlock ordering · finalize with old token no-ops ·
finalize same-token stale version releases without raising · expired settling reclaim ·
readiness bump (status flip finished↔live, scores unchanged) dirties · combined-cause single
bump · W1 void written by maintenance with no entry-result rows · mirror stale-stake mismatch
writes nothing.

## Sol round-1 findings mapping
1→§0.4/§0.3 (transfers dual-id, entry_results, Dues aggregation in-scope) · 2→§0.1/§0.2
composite FKs + §0.3 normalization · 3→§0.7 RLS reveal + no realtime + hygiene · 4→§5 L7
claim/compute/finalize protocol · 5→§0b effective rule · 6→§0.6 advisory lock + input_version ·
7→§0.6 (apply_score_update/reconciliation bump+dirty) + L6 re-settle trigger · 8→M5 reversal,
never delete · 9→L8 needs_update/invalid (PRODUCT DECISION, logged in decisions log) ·
10→L9 precise eligibility · 11→§7 session-client + clock_timestamp + full re-validation +
atomic mirror · 12→§0.3 outcome/void_reason + W1/W2 precedence + void-at-lock ·
13→M3 per-loser split + invariants · 14→§1 strict unions/validation/determinism + §6 expanded
matrix + §8 no-browser acceptance.
