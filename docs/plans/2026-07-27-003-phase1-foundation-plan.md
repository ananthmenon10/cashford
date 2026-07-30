# Phase 1 — Schema + data foundation. Deep implementation plan v5

v5 after Sol review round 4 (8/10 round-3 items verified; 3 remaining fixes folded in:
§4.3 rewritten to the is_current comparison model with exactly-one reconciliation call,
apply_score_update gains FOR UPDATE locking + settling/settled_at rejection,
league_competitions.eligible_from backfilled alongside member_competitions).
Owner: orchestrator (Fable). Implementer: Opus 5. Reviewer: GPT-5.6 Sol. Tests: Sonnet.

Goal: competitions and gameweeks exist as first-class data; PL 2026-27 ingests from FPL with full
postponement history; leagues participate in competitions; per-league gameweek pots are
provisioned; the World Cup data, engine, and screens are provably untouched.

## 0. Data model principle

The legacy per-fixture stack — `contests`, `predictions`, `contest_results`, per-match settlement,
`sync_contest_on_fixture_change` trigger — becomes **cup-format-only and is never written for PL**.
League format gets its own parallel stack; Phase 1 builds the container level only:

- `gameweek_contests` — one row per (league, gameweek): the pot. Phase 2 adds entries/picks tables.
- `gameweek_fixtures` — which fixtures belong to a gameweek, as history-preserving membership.
- "Never" is a DATABASE INVARIANT, not just runtime guards: a before-insert/update trigger on
  `contests` rejects any row whose fixture's competition format ≠ 'cup'. The three legacy
  functions (`lockDueContests`, `settleFinishedContests`, `settleContest`) ALSO get cup-only
  guards as defense against old/corrupted rows.

## 1. Migration `20260727000001_competitions_gameweeks.sql` (single transaction, additive, idempotent-guarded)

1. `competitions` (id uuid pk default gen_random_uuid(), slug text unique not null, name text not
   null, format text not null check (format in ('cup','league')), season text not null, espn_slug
   text, fpl_source boolean not null default false, status text not null check
   (status in ('preparing','active','archived')), created_at timestamptz not null default now()).
   Seed: ('wc2026','World Cup 2026','cup','2026','fifa.world',false,'archived'),
   ('pl-2026-27','Premier League 2026-27','league','2026-27','eng.1',true,**'preparing'**).
   `preparing` = data may sync but the competition is NOT selectable for league creation and no
   pots provision. PL flips to 'active' only in rollout step §7.6 after verified initial sync.
2. `gameweeks` (id uuid pk default gen_random_uuid(), competition_id uuid not null references
   competitions(id), number int not null, name text not null, deadline_at timestamptz, locked_at
   timestamptz, status text not null default 'upcoming' check (status in
   ('upcoming','open','locked','completed')), fpl_event_id int,
   unique (competition_id, number), unique (competition_id, fpl_event_id),
   unique (id, competition_id) ← composite target for cross-competition FKs,
   **partial unique index `one_open_gw_per_competition` on (competition_id) where status='open'**).
   Status is SCHEDULE state only (league-money state lives on gameweek_contests):
   - `open`: the earliest gameweek of the competition whose deadline_at > now(). At most one
     (enforced by the partial index; transitions happen in one transaction: complete/lock the
     old, open the new). ZERO open is valid (season over, or PL still preparing pre-GW1 sync).
   - `upcoming`: any later gameweek.
   - `locked`: deadline passed. Transition is by DB time comparison, not cron arrival: a gameweek
     is TREATED as locked whenever now() ≥ deadline_at; cron stamps locked_at lazily.
   - `completed`: now() ≥ deadline_at **AND** every ACTIVE membership points to a fixture with
     status='finished' and non-null final scores. The deadline condition prevents a zero-fixture
     gameweek from completing vacuously (round-3 finding). Fixtures in states
     `postponed`/`cancelled`/`abandoned` (the real fixture status values) must first have their
     membership voided under §4's reconciliation rules before the gameweek can complete —
     completion never counts a non-finished fixture.
   Deadline updates from FPL are accepted ONLY while now() < stored deadline_at AND locked_at is
   null AND no actively-member fixture has started; after that the stored deadline is frozen
   forever, even if cron lagged (no reopening, ever). An ACCEPTED deadline change updates the
   gameweek row AND every still-open gameweek_contest deadline snapshot for that gameweek **in
   the same transaction** (inside the §4 reconciliation routine). Locked pots are never updated.
3. `gameweek_fixtures` (**id uuid pk default gen_random_uuid()** ← every membership is its own
   row; A→B→A inserts a THIRD row, nothing mutates), gameweek_id uuid not null, fixture_id uuid
   not null, competition_id uuid not null, state text not null default 'active' check (state in
   ('active','void','excluded')), **is_current boolean not null default true** ← the fixture's
   CURRENT FPL assignment, independent of state (an `excluded` row is current — it is where FPL
   says the fixture lives now, even though it doesn't count), added_at timestamptz not null
   default now(), voided_at timestamptz, void_reason text,
   foreign key (gameweek_id, competition_id) references gameweeks(id, competition_id),
   **foreign key (fixture_id, competition_id) references fixtures(id, competition_id)** ← both
   sides proven same-competition (requires fixtures unique(id, competition_id), §1.6),
   **unique (id, fixture_id)** ← composite target so fixture_moves rows provably reference
   memberships of the SAME fixture,
   partial unique index one ACTIVE membership per fixture:
   `create unique index one_active_gw_per_fixture on gameweek_fixtures(fixture_id) where state='active'`,
   **partial unique index one CURRENT membership per fixture:
   `create unique index one_current_gw_per_fixture on gameweek_fixtures(fixture_id) where is_current`**,
   index (gameweek_id) where state='active'.
   States: `active` = counts for the gameweek (always is_current). `void` = was active, removed
   (postponement) — never is_current. `excluded` = FPL assigned this fixture to a gameweek AFTER
   that gameweek froze — is_current (it IS the current assignment) but never counts, never
   pickable (finding-2 rule, §4.3). Reconciliation compares FPL's event against the CURRENT row
   (whatever its state), so repeated observation of a late assignment is a no-op, and
   excluded→null / excluded→other-GW moves are representable: clear is_current on the old row,
   insert the new current row (or none for unassigned). Unassigned fixture = zero current rows.
   `fixtures.gameweek_id` is NOT added — membership is the only truth. `round` stays cup display
   data only and is NOT written for PL (see §1.6).
4. `gameweek_contests` (id uuid pk default gen_random_uuid(), league_id uuid not null references
   leagues(id), gameweek_id uuid not null, **competition_id uuid not null**, stake_inr int not
   null **check (stake_inr > 0)**, deadline_at timestamptz not null ← snapshot at creation
   (kept in sync with accepted pre-freeze deadline changes per §1.2), status text not null
   default 'open' check (status in ('open','locked','settling','settled','void')),
   created_at timestamptz not null default now(), settled_at timestamptz,
   unique (league_id, gameweek_id),
   foreign key (gameweek_id, competition_id) references gameweeks(id, competition_id),
   **foreign key (league_id, competition_id) references league_competitions(league_id,
   competition_id)** ← the league provably participates in the pot's competition.
   **Provisioned only when its gameweek opens** (stake snapshots at open; later league-stake
   changes affect only future gameweeks — decided rule).
5. `league_competitions` (league_id uuid not null references leagues(id), competition_id uuid not
   null references competitions(id), status text not null check (status in ('active','archived')),
   joined_at timestamptz not null default now(), eligible_from_gameweek_id uuid,
   pk (league_id, competition_id), **unique (league_id, competition_id) is implied by the pk and
   is the composite-FK target for §1.4**, partial unique index one ACTIVE competition per league,
   foreign key (eligible_from_gameweek_id, competition_id) references gameweeks(id,
   competition_id) ← eligibility boundary provably in the same competition.
   Backfill: every existing league → (wc2026, 'archived', eligible_from null).
6. **`member_competitions`** (league_id uuid not null, user_id uuid not null, competition_id uuid
   not null, **eligible_from_gameweek_id uuid** ← NULLABLE: null means "eligible from whenever
   the first/next gameweek opens" — required for joins while the competition has zero open
   gameweeks (valid state per §1.2); when the maintenance step opens a gameweek it backfills
   every null eligible_from_gameweek_id for that competition in **BOTH member_competitions AND
   league_competitions** (a league created during a zero-open window has the same null),
   active_from timestamptz not null default
   now(), left_at timestamptz, pk (league_id, user_id, competition_id),
   foreign key (league_id, user_id) references league_members(league_id, user_id) — or the
   equivalent existing membership key, implementer verifies actual PK/unique shape first,
   foreign key (eligible_from_gameweek_id, competition_id) references gameweeks(id, competition_id),
   foreign key (league_id, competition_id) references league_competitions(league_id, competition_id)).
   Per-member "before your time" boundary (mid-season joiners enter from the next open GW —
   rulebook requirement, no longer deferred). Written in the SAME transaction as joining a league
   (§6 join path) and backfilled for all existing members when a league activates a competition
   (create_league does this for the creating captain; join does it per joiner). WC backfill:
   none needed (wc2026 is archived; no eligibility semantics for cup format — rows only for
   league-format competitions).
7. `fixtures` changes: add `competition_id uuid references competitions(id)` nullable → classify
   & backfill (see §7 backfill safety) → set not null. Add **`unique (id, competition_id)`** ←
   composite-FK target (finding 3). Add `fpl_fixture_id int`,
   unique (competition_id, fpl_fixture_id) — season/provider-scoped, NOT globally unique.
   ALTER `external_id` DROP NOT NULL (keep unique index; all ESPN callers must skip null).
   ALTER `kickoff_at` DROP NOT NULL (postponed fixtures may have no date; such fixtures are never
   provisioned into polling and lock_at stays null).
   **ALTER `round` DROP NOT NULL** — league-format fixtures leave it null forever; FPL sync never
   writes it (no 'gw<n>' values; gameweek membership has exactly one source: gameweek_fixtures).
   The existing `round` CHECK stays as-is for non-null values (cup display data only).
   Add **`score_source text check (score_source in ('espn','fpl'))` and `score_observed_at
   timestamptz`** (both nullable) — provenance for §2's write predicates.
8. `teams`: ALTER `external_id` DROP NOT NULL (promoted clubs may briefly lack ESPN mapping).
   NEW `team_provider_ids` (team_id uuid not null references teams(id), provider text not null
   check (provider in ('fpl','espn','understat')), season text not null, provider_key text not
   null, pk (provider, season, provider_key), unique (team_id, provider, season)).
   **This table is CANONICAL for all provider identity, ESPN included.** Migration backfills an
   ESPN mapping row for every existing team with non-null external_id (provider='espn',
   season='2026' for WC teams). Runtime rule: whenever ESPN matching/normalization produces a
   team match, upsert the mapping row. All ESPN team lookups (score polling team resolution,
   knockout-team upsert in lib/espn.ts) move to this table in this phase. `teams.external_id`
   remains ONLY as a read-compatibility field for un-migrated display code; no new writes except
   the existing knockout upsert path which now ALSO writes the mapping row; column removal is a
   later-phase migration.
9. Ops tables:
   - `sync_state` (key text pk, last_run_at timestamptz, next_due_at timestamptz not null,
     lease_until timestamptz, **lease_token uuid**). Claim/renew/complete protocol (finding 8):
     * CLAIM: `update … set lease_until = now()+'5 min', lease_token = gen_random_uuid()
       where key=$1 and next_due_at <= now() and (lease_until is null or lease_until < now())
       returning lease_token` — no row ⇒ skip (either not due or another holder). The claim is
       BOTH the cadence gate and the single-flight lock.
     * RENEW (long runs): `update … set lease_until = now()+'5 min' where key=$1 and
       lease_token=$2 and lease_until > now() returning 1` — renew before expiry; a failed renew
       means the lease was lost: the holder must ABORT without further writes.
     * COMPLETE/RELEASE: `update … set last_run_at=now(), next_due_at=$3, lease_until=null,
       lease_token=null where key=$1 and lease_token=$2` — token-conditioned, so a stale holder
       can never update next_due_at or clear a new holder's lease.
   - `fixture_moves` (id uuid pk, fixture_id uuid not null references fixtures(id),
     old_membership_id uuid, new_membership_id uuid (either may be null: null→GW, GW→null),
     observed_at timestamptz not null default now(),
     **check (old_membership_id is not null or new_membership_id is not null)**,
     **foreign key (old_membership_id, fixture_id) references gameweek_fixtures(id, fixture_id)**,
     **foreign key (new_membership_id, fixture_id) references gameweek_fixtures(id, fixture_id)**
     ← both memberships provably belong to THIS fixture,
     **`unique nulls not distinct (old_membership_id, new_membership_id)`** — the NULLS NOT
     DISTINCT form is REQUIRED (plain unique treats nulls as distinct and would not dedupe
     null→GW or GW→null moves; Postgres 15+, available on this project).
   - `sync_issues` (id uuid pk, source text not null, kind text not null, ref text, detail jsonb,
     created_at timestamptz not null default now(), resolved_at timestamptz). Retention: Phase 6
     cleanup job; unbounded until then (low volume).
   - `result_revisions` (id uuid pk, fixture_id uuid not null references fixtures(id), old_home
     int, old_away int, new_home int, new_away int, source text not null, observed_at timestamptz
     not null default now()) — written whenever a FINISHED fixture's score changes on a later
     poll, in the SAME transaction as the score update. Phase 2 consumes for re-settlement.
     **Phase 1 scope limit (finding 11): score corrections are recorded+applied ONLY for fixtures
     with no settled legacy contest.** If a finished WC fixture with settled contests shows a
     changed score, write sync_issues('espn','settled-correction', …) and DO NOT update the
     fixture — regrading settled cup contests is out of Phase 1 scope, and updating the score
     without regrading would make displayed scores and money disagree.
10. Legacy-isolation triggers:
    - `sync_contest_on_fixture_change` gains an early return unless the fixture's competition
      format='cup' (subquery on competitions). PL kickoff churn never touches legacy contests.
    - NEW `contests_cup_only` before insert-or-update trigger on `contests`: raise exception if
      the fixture's competition format ≠ 'cup' (finding 15 — DB invariant, not just app guards).
11. RLS — in the SAME migration, for every new table: enable RLS on all. `competitions`,
    `gameweeks`, `gameweek_fixtures`: select to authenticated using(true). `gameweek_contests`,
    `league_competitions`, `member_competitions`: select using league_id in (select
    cashford.my_league_ids()). `sync_state`, `sync_issues`, `fixture_moves`, `result_revisions`,
    `team_provider_ids`: RLS enabled with NO policies (service-role only). No
    INSERT/UPDATE/DELETE policies anywhere — writes are service-role only, matching convention.
12. Indexes: gameweeks(competition_id, status, deadline_at); gameweek_fixtures(gameweek_id) where
    state='active'; gameweek_contests(gameweek_id); league_competitions(competition_id) where
    status='active'; fixtures(competition_id) where external_id is null (unmatched-ESPN worklist).
13. Database routines (finding 9 & 12 — the transaction boundaries have a real mechanism; plain
    Supabase client call chains are NOT transactions):
    - **`cashford.apply_fpl_reconciliation(snapshot jsonb)`** — service-role-only (revoke all
      client roles), set-based: takes the validated, diffed snapshot and in ONE transaction —
      **exactly ONE call per sync run, never batched** (round-3 finding: partial batches leave
      partial reconciliation if a later batch fails) — applies gameweek upserts + accepted
      deadline changes (incl. open-pot snapshot updates per §1.2), fixture upserts, membership
      current-row moves/voids/exclusions, and fixture_moves rows. A 380-fixture diff in one
      jsonb argument is small; one call also can't outlive the 5-min lease.
    - **`cashford.apply_score_update(p_fixture_id uuid, p_home int, p_away int, p_source text,
      p_status text default null)`** — service-role-only. Makes the §2 write predicates and the
      §1.9 revision/settled-contest rules ATOMIC (round-3 finding: pollScores currently writes
      fixtures directly, so predicate + revision + update could interleave). In one transaction:
      **first `SELECT … FOR UPDATE` the fixture row AND its legacy contest rows** (orders this
      routine against a concurrently running settlement claim), then re-check the source
      predicate against the stored score_source/score_observed_at; if the fixture is finished
      and the score changes, reject the correction when ANY related contest has
      `status='settling'` OR `settled_at IS NOT NULL` (covers settled 'void'/'cancelled' rows
      too, not just status='settled') — write sync_issues and return without touching the
      fixture; else write result_revisions + the score/status/provenance update together. ALL score writes (ESPN pollScores, FPL
      fallback in reconciliation) go through this routine (reconciliation may inline the same
      logic since it is already one transaction — implementer's choice, semantics identical).
      p_status: ESPN passes live/finished states; FPL may pass a TERMINAL status ONLY for
      fixtures with null external_id (see §5 fallback rule).
    - **`cashford.create_league(p_name text, p_slug text, p_stake int, p_competition_slug text)`**
      — SECURITY DEFINER, `set search_path = ''`, reads `auth.uid()` internally and rejects null;
      REVOKE EXECUTE from public and anon, GRANT only to authenticated. One transaction: league +
      captain membership + invite + league_competitions(active, eligible_from = current open GW,
      null while none open) + member_competitions row for the captain + gameweek_contest for the
      open GW if one exists. Validates the competition exists AND status='active' ('preparing'
      and 'archived' are rejected — finding 14). Failure ⇒ nothing persists.
      **RETURNS the row the success screen needs: (league_id, invite_token, short_code)** —
      implementer reads the current create action (app/leagues/new/actions.ts) for the exact
      invite shape and generates collision-safe values INSIDE the routine (retry loop on unique
      violation for the short code, same alphabet as today).
    - **`cashford.join_league(p_invite text)`** — SECURITY DEFINER, `set search_path = ''`,
      `auth.uid()` internally, REVOKE from public/anon, GRANT authenticated (same model as
      create_league). One transaction: validate invite → member row + member_competitions
      (eligible_from = current open GW at join time; null if none open) atomically. Returns
      league_id. Existing join action calls it.
    - **`cashford.activate_competition(p_slug text)`** — service-role-only. One transaction:
      run gameweek maintenance for the competition (open the correct current gameweek per §1.2)
      and THEN set status='active' (round-3 finding: flipping status before an open GW exists
      lets leagues be created with no pot to provision). Deployment step §7.6 calls this —
      never a bare status UPDATE.

## 2. Field ownership (encoded as write predicates, not prose — finding 10)

Every score write goes through one rule set, using `fixtures.score_source` + `score_observed_at`:
- **ESPN** may write scores whenever it has data for a matched fixture (live or final); each write
  sets score_source='espn', score_observed_at=now().
- **FPL** may write scores ONLY when `score_source is null` (never scored) **or**
  `score_source='fpl'` (updating its own earlier fallback) **or** the fixture has null
  external_id (unmatched — FPL is the only source). FPL NEVER overwrites an ESPN observation.
- A score change on an already-finished fixture (either source, subject to the predicates above)
  writes `result_revisions` + the fixture update in one transaction — EXCEPT the settled-contest
  carve-out in §1.9 (sync_issue instead, no write).
- FPL owns: gameweek assignment (`gameweek_fixtures`), deadlines, fixture existence, kickoff times.
- ESPN owns: live match state, events, insights.

## 3. `lib/fpl.ts` (pure adapter, no DB)

`fetchFplSnapshot()`: fetch bootstrap-static AND fixtures; validate BOTH before returning:
HTTP 200 within 10s timeout; exactly 38 unique events; 20 teams; 380 unique fixture ids; every
fixture's team_h/team_a ∈ teams; every non-null event ∈ events; season sanity (GW1 deadline
within 2026). Any failure → return null (caller writes nothing, logs sync_issues). Pure mappers
(unit-tested): `mapEvent`, `mapFixture` (null event and null kickoff are VALID outputs meaning
unassigned/undated), team list extraction.

## 4. `lib/sync-fpl.ts` (service-role; writes via the §1.13 DB routine)

Under a sync_state lease (`fpl-sync`, claim/renew/complete per §1.9):
1. Fetch + validate snapshot (§3). Diff against DB state in the app (reads only).
2. Teams: resolve via team_provider_ids(fpl, '2026-27') → hardcoded 20-name normalization map →
   insert new team (external_id null) + mapping row. Unresolvable name → sync_issues, skip its
   fixtures this run.
3. Apply the diff through `apply_fpl_reconciliation` — **exactly ONE call per sync run**.
   Reconciliation rules INSIDE the routine, per fixture whose FPL event differs from the
   gameweek of its **`is_current=true` membership row (whatever its state)** — no current row
   means currently unassigned:
   - Removing the current assignment is ALWAYS allowed. How the old current row is closed
     depends on its state: if it was `active` → set state='void' (reason 'moved'/'unassigned'),
     is_current=false, voided_at=now(); if it was `excluded` → clear is_current ONLY (it keeps
     state='excluded'; it was never counted, so it is not "voided").
   - Adding the destination membership as ACTIVE (is_current, state='active') is allowed only
     when the destination gameweek is NOT frozen (status in ('upcoming','open') and now() < its
     deadline). A late assignment (destination locked/completed, or deadline passed) inserts
     is_current with state='excluded' + a sync_issues('fpl','late-assignment') row — never
     active, never changes a completed GW (brief rule "fixture list freezes at deadline").
   - FPL event null ⇒ close the current row per its state as above, insert no new row.
   - Same-gameweek repeat observation (FPL event equals the current row's gameweek) is a no-op
     regardless of the current row's state.
   - Every applied move writes fixture_moves (deduped by membership ids).
   - Accepted deadline changes update gameweek + open pot snapshots atomically (§1.2).
4. Gameweek open/locked/completed maintenance per §1.2 rules (one-open invariant transactions).
5. Provisioning: for the OPEN gameweek only — for every league with active pl-2026-27
   participation and no gameweek_contest yet → insert (stake = league.default_stake_inr snapshot,
   deadline_at = gameweek.deadline_at). Idempotent by unique key; archived participations never;
   nothing provisions while the competition is 'preparing'.
6. Scores: FPL fallback writes obey §2 predicates strictly.
7. Cadence: on COMPLETE set next_due_at = +6h normally, +15m inside [deadline−48h, deadline].

## 5. `lib/espn-match.ts` (ESPN id matcher)

Bulk events from core API (paginated, limit=100 loop). Match rule: BOTH teams (ordered home/away
via team_provider_ids/espn or normalized name) AND kickoff within ±3h AND competition season.
Exactly one candidate → write fixtures.external_id (only if currently null — never overwrite)
AND upsert team_provider_ids espn rows for both teams (season '2026-27'). Zero or >1 →
sync_issues('espn-match', …). Launch gate: 100% of assigned fixtures matched OR explicit
FPL-score-fallback signoff (acceptance C below tracks the count).
**Fallback completeness rule (round-3 finding): a fixture with null external_id can never be
polled by ESPN, so for THOSE fixtures ONLY, FPL is allowed to set terminal status
(finished + final score) through `apply_score_update` (p_status gated on null external_id).
Otherwise an unmatched fixture could never finish and its gameweek could never complete.**

## 6. Runtime integration

- `pollScores`: derive slugs from fixtures needing polls (window query joins competitions for
  espn_slug), NOT from competition status — WC corrections keep working. Skip fixtures with null
  external_id. Team resolution via team_provider_ids (§1.8). Score writes per §2 predicates.
  **Finished-fixture polling horizon (finding 11): a finished fixture stays in the poll window
  for 48h after kickoff (correction watch), then drops out.** Corrections found in that window
  follow §1.9's rules (revision+update, or sync_issue if settled contests exist).
- `pollInsights`/cold-fill: pass espn_slug through (lib/espn-insights.ts parameterized); until
  that lands PL fixtures are excluded from insights polling by competition guard — NO hardcoded
  fifa.world call for a PL fixture ever.
- Legacy engine guards per §0 (runtime) + `contests_cup_only` trigger (DB).
- Cron tick order: syncFpl(lease per §1.9) → pollScores → lockDueContests(cup-only) →
  settleFinishedContests(cup-only) → gameweekMaintenance (open/lock/complete stamping) →
  pollInsights.
- League create (`app/leagues/new/actions.ts`): calls `cashford.create_league` (§1.13) through
  the authenticated client (SECURITY DEFINER handles privileges). Form submits explicit
  competition slug (UI: preselected PL — but PL only appears once status='active', §7).
- League join: transactional member + member_competitions write (§1.13).
- Debug page `/dev/gameweeks` (auth-gated): lists gameweeks (number, status, deadline IST, active
  fixture count, moved/unassigned/excluded counts) + provisioned pot count per league I belong to.

## 7. Deployment order (shared prod DB; two-step exposure — finding 14)

1. Snapshot: `scripts/phase1-preflight.mjs` exports current fixtures/teams/contests counts +
   per-row ids for WC classification; abort if any fixture id is not in the WC allowlist.
   Allowlist RESOLVED by live DB audit 2026-07-27: 106 rows = 104 real WC (group external_id
   760414–760485 + 32 knockout) + 2 QA seed rows (external_id 980001, 980002 — null team refs,
   from scripts/qa-seed). All 106 backfill to wc2026 (QA rows are cup-era test data; tagging
   them wc2026 keeps NOT NULL valid and changes no behavior). Preflight still aborts on any row
   outside this exact set. Checksum covers LEGACY COLUMNS ONLY (new columns obviously change).
2. Apply migration via Management API — **PL seeded status='preparing'**; run
   `scripts/verify-phase1-ddl.mjs` (tables, columns, constraints, triggers, routine privileges
   — incl. create_league revoked from anon/public — RLS state via pg_catalog queries). Also
   test the migration TWICE against a disposable local database first (idempotence).
3. Deploy code (trigger scoping + contests_cup_only + legacy guards + league-create/join via
   routines). PL is invisible in creation UI (preparing). sync_state seeded next_due_at =
   'infinity' (sync off).
4. `node scripts/sync-fpl-dryrun.mjs` — fetch+validate+diff, prints intended writes, writes
   nothing.
5. Manual single sync (`scripts/sync-fpl-once.mjs` sets next_due_at=now() then ticks), then
   `scripts/verify-phase1.mjs`: 38 GWs; 380 fixtures with active membership (or explicitly
   logged unassigned/excluded); GW deadlines match the fetched FPL snapshot (not hardcoded);
   legacy-column checksum of WC fixture rows unchanged; real leagues have zero
   gameweek_contests and zero new legacy contests; exactly ≤1 open GW.
6. **Activate:** call `cashford.activate_competition('pl-2026-27')` — opens the current gameweek
   and flips status to 'active' in ONE transaction (never a bare status update). PL appears in
   creation UI, provisioning becomes possible. Enable recurring sync (next_due_at = now()).
7. Browser verification (acceptance D), then delete P1 test league via script.

## 8. Acceptance criteria

A. `npm run typecheck && npm run build && npx vitest run` green; legacy settlement tests
   untouched-and-green; `git diff lib/settlement.ts` empty.
B. verify-phase1.mjs all assertions pass (§7.5 list).
C. ESPN mapping report: 380/380 matched, or unmatched list + explicit fallback decision.
D. Browser (Sonnet, axi session `worker-p1`): create P1 Test League via UI (competition line
   visible, PL preselected) → league has exactly ONE gameweek_contest (open GW) and no WC
   contests; /dev/gameweeks renders 38 rows with IST deadlines; full WC regression pass on an
   existing real league READ-ONLY (home, league tabs, one match page, dues, bracket, archive
   unaffected); login/logout.
E. Decisions log updated; implementation-notes.md has a Deviations section.

## 9. Test inventory (Sonnet authors; docs/testing/phase1-cases.md; runner `npm run test:phase1` + verify scripts)

Unit — fpl adapter: snapshot validation ×8 (ok, non-200, timeout, 37 events, duplicate events,
19 teams, 379/duplicate fixtures, bad refs); mapEvent ×3; mapFixture ×4 (normal, null event,
null kickoff, score fields).
Persistence (local pg or db-tagged): deadline change accepted pre-freeze updates GW + open pot
snapshots atomically ×1, rejected after stored deadline passed even if cron lagged ×1, rejected
after fixture started ×1, locked pot snapshot never updated ×1; GW transitions ×5 (open/lock/
complete, one-open invariant violated → constraint error, cron-late lock, zero-open valid,
completion blocked by postponed-not-yet-voided fixture); membership reconciliation ×9 (assign,
move pre-freeze, move to LOCKED destination → excluded + sync_issue, null→locked → excluded,
move affecting COMPLETED gameweek → excluded + completed GW unchanged, GW A→null→GW B,
**A→B→A creates a third row — history intact**, repeat observation dedupes fixture_moves by
membership ids, initial assignment old=null dedupes); provisioning ×6 (open-GW only, stake
snapshot immune to later league change, idempotent rerun, archived participation skipped,
preparing competition never provisions, new league gets exactly one); team resolution ×4 +
provider-table canonicalization ×2 (ESPN backfill rows exist; knockout upsert writes mapping);
ESPN matcher ×6 (unique, reversed sides rejected, two candidates logged, zero logged,
never-overwrite, pagination). Score-source predicates ×4 (FPL can't overwrite ESPN; FPL updates
own fallback; unmatched fixture takes FPL; ESPN overwrites FPL) + settled-correction carve-out ×1
(settled WC fixture score change → sync_issue, fixture unchanged).
Lease ×5 (claim honors next_due_at, second claim while leased skips, takeover after expiry,
stale holder's complete is a no-op — token mismatch, failed renew aborts).
Isolation: migration applied twice ×1; RLS ×6 (reference tables readable, other-league
gameweek_contests/member_competitions invisible, cannot write anything, service role can, ops
tables invisible, create_league not executable as anon); triggers ×3 (PL kickoff change leaves
legacy contests untouched; WC path unchanged; contests_cup_only rejects a PL contest insert even
as service role); legacy guards ×3 (all three functions no-op on league-format rows);
cross-competition FKs ×3 (fixture can't join other-competition GW; pot can't reference
other-competition GW; eligible_from can't cross competitions).
Sync failures: one endpoint down, empty payload, truncated JSON, concurrent syncs (lease), db
failure mid-reconciliation (routine transaction rolls back everything), score correction paths.
Integration: full syncFpl against a recorded real FPL snapshot (tests/fixtures/, checked in).

## Sol round-2 findings mapping
1→§1.3/§1.9 fixture_moves · 2→§4.3/§1.3 'excluded' · 3→§1.4/§1.5/§1.7 composite FKs ·
4→§1.7 round nullable · 5→§1.4 checks + §1.2 pot-snapshot sync · 6→§1.2 one-open index +
completion definition · 7→§1.8 canonical provider table · 8→§1.9 token lease protocol ·
9→§1.13 apply_fpl_reconciliation · 10→§2 write predicates + provenance columns ·
11→§6 48h horizon + §1.9 settled-correction carve-out · 12→§1.13 create_league security model ·
13→§1.6 member_competitions (un-deferred) · 14→§1.1 'preparing' + §7 two-step rollout ·
15→§1.10 contests_cup_only trigger.

## Sol round-3 findings mapping
Partial 1→§1.9 fixture_moves `unique nulls not distinct` · Partial 6→§1.2 completion requires
deadline passage · Partial 9→§1.13 one call per sync, no batching · Partial 10→§1.13
apply_score_update atomic routine · Partial 13→§1.6 eligible_from nullable ·
New 1→§1.3 is_current + one-current index + compare-against-current reconciliation ·
New 2→§1.3 unique(id,fixture_id) + §1.9 composite FKs + not-both-null check ·
New 3→§5 FPL terminal status for null-external_id fixtures via apply_score_update ·
New 4→§1.13 activate_competition + §7.6 · New 5→§1.13 create_league return contract +
join_league(p_invite) SECURITY DEFINER.
Additional test cases from round 3 (append to §9): move-dedupe with null old membership rerun ×1;
zero-fixture GW does not complete before deadline ×1; repeated late assignment is a no-op
(current-row comparison) ×1; excluded→other-GW and excluded→null representable ×2; FPL sets
terminal status ONLY when external_id null ×2 (allowed / rejected when matched);
activate_competition opens GW + activates atomically ×1; join_league invite validation +
eligibility row ×2; create_league returns working invite (short-code collision retry) ×1.
