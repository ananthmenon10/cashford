-- Cashford 2.0 — Phase 2: gameweek entries, picks, results, settlement protocol.
-- Plan: docs/plans/2026-07-27-005-phase2-engine-plan.md (v4)
--
-- Additive and idempotent-guarded: re-running the whole file is a no-op. One transaction.
--
-- The settlement MATH is not here. It lives in lib/gameweek-points.ts + lib/gameweek-settle.ts
-- and nowhere else. These routines capture a canonical input snapshot, and later validate and
-- persist the outcome the pure engine returned. SQL checks invariants; it never re-computes.
--
-- Lock ordering for every writer (§0.6), deadlock-free by construction:
--   0. the leagues row, FOR NO KEY UPDATE      (league lifecycle: leave, archive)
--   1. competition advisory gate    (reconciliation, maintenance, score updates)
--   2. gameweek advisory locks, ascending uuid
--   3. fixture rows for update, ascending uuid
--   4. contest rows, then league_competitions / member_competitions rows, ascending uuid
-- Single-gameweek paths (enter, edit, mirror, claim, finalize, abort) start at step 2.
--
-- Step 0 exists because Phase 1's join_league takes the leagues row FIRST and then inserts
-- member_competitions, which needs a FOREIGN-KEY lock on a league_competitions row. A lifecycle
-- writer that started at league_competitions and only reached leagues at the end closed a
-- cycle with join and Postgres aborted one side with 40P01. Two rules keep the order honest:
--   * every lifecycle writer (leave, archive) takes the leagues row before anything else, so it
--     meets join at the same first row rather than halfway down;
--   * the step-4 row locks are FOR NO KEY UPDATE, never FOR UPDATE. Nothing here deletes a
--     league_competitions / member_competitions row or changes its key, so FOR NO KEY UPDATE is
--     the correct strength — and it does not conflict with the FOR KEY SHARE lock that another
--     transaction's foreign-key insert needs. That keeps foreign-key waits out of the lock graph
--     entirely, while still excluding every other writer of those rows (FOR NO KEY UPDATE
--     conflicts with itself and with FOR UPDATE), so L9 serialization is unchanged.
--
-- The same strength rule applies to the leagues row itself, and that is why section 18d replaces
-- join_league: Phase 1 took it FOR UPDATE, which conflicts with FOR KEY SHARE, so maintenance
-- (holding the competition gate, then inserting a pot whose foreign key needs KEY SHARE on that
-- league) could deadlock against a repeated join waiting on a member_competitions row maintenance
-- had just updated. Rule: NO routine takes a leagues row stronger than FOR NO KEY UPDATE.

begin;

-- ============================================================
-- 1. Unique-key targets on Phase 1 tables (§0.0)
--    The composite FK web below is impossible without these.
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'gameweek_contests_id_league_key'
                   and conrelid = 'cashford.gameweek_contests'::regclass) then
    alter table cashford.gameweek_contests
      add constraint gameweek_contests_id_league_key unique (id, league_id);
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'gameweek_contests_id_scope_key'
                   and conrelid = 'cashford.gameweek_contests'::regclass) then
    alter table cashford.gameweek_contests
      add constraint gameweek_contests_id_scope_key
      unique (id, league_id, gameweek_id, competition_id);
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'gameweek_fixtures_id_scope_key'
                   and conrelid = 'cashford.gameweek_fixtures'::regclass) then
    alter table cashford.gameweek_fixtures
      add constraint gameweek_fixtures_id_scope_key
      unique (id, gameweek_id, fixture_id, competition_id);
  end if;
end $$;

-- ============================================================
-- 2. Concurrency spine on gameweek_contests (§0.6 + L7)
--    input_version   — bumped when the CANONICAL INPUT PROJECTION changes
--    input_version_txid — the transaction that last bumped it, so one transaction
--                      bumps a contest exactly once however many writes it makes
--    pending_cause   — why the contest is dirty; consumed by finalize as last_settle_cause
--    claim_*         — the stored settlement state machine (L7)
-- ============================================================
alter table cashford.gameweek_contests
  add column if not exists input_version       int not null default 0,
  add column if not exists input_version_txid  bigint,
  add column if not exists pending_cause       text,
  add column if not exists claim_token         uuid,
  add column if not exists claim_started_at    timestamptz,
  add column if not exists claim_input_version int,
  add column if not exists claim_prior_status  text;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'chk_gw_contest_pending_cause'
                   and conrelid = 'cashford.gameweek_contests'::regclass) then
    alter table cashford.gameweek_contests
      add constraint chk_gw_contest_pending_cause
      check (pending_cause in ('result_revision','membership_change','combined'));
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'chk_gw_contest_claim_prior_status'
                   and conrelid = 'cashford.gameweek_contests'::regclass) then
    alter table cashford.gameweek_contests
      add constraint chk_gw_contest_claim_prior_status
      check (claim_prior_status in ('locked','settled','void'));
  end if;

  -- A claim is all-or-nothing: token, start time and captured version travel together.
  if not exists (select 1 from pg_constraint
                 where conname = 'chk_gw_contest_claim_coherent'
                   and conrelid = 'cashford.gameweek_contests'::regclass) then
    alter table cashford.gameweek_contests
      add constraint chk_gw_contest_claim_coherent
      check ((claim_token is null) = (claim_started_at is null)
         and (claim_token is null) = (claim_input_version is null));
  end if;
end $$;

-- The dispatcher scans on these two predicates every tick.
create index if not exists idx_gameweek_contests_settleable
  on cashford.gameweek_contests (status) where status in ('locked','settling');
create index if not exists idx_gameweek_contests_claim_expiry
  on cashford.gameweek_contests (claim_started_at) where status = 'settling';

-- ============================================================
-- 3. gameweek_entries (§0.1)
--    'entered'      — complete pick set
--    'needs_update' — a pre-deadline fixture addition broke completeness (L8)
--    'locked_in'    — complete at the deadline; the ONLY status settlement reads
--    'invalid'      — incomplete at the deadline: visible, stakes nothing, wins nothing
--    No withdraw ⇒ no user-initiated deletion, ever.
-- ============================================================
create table if not exists cashford.gameweek_entries (
  id                  uuid primary key default gen_random_uuid(),
  gameweek_contest_id uuid not null,
  league_id           uuid not null,
  gameweek_id         uuid not null,
  competition_id      uuid not null,
  user_id             uuid not null references cashford.profiles(id) on delete restrict,
  status              text not null default 'entered'
                        check (status in ('entered','needs_update','locked_in','invalid')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (gameweek_contest_id, user_id),
  -- composite targets for the pick and result FKs below
  unique (id, gameweek_id, competition_id),
  unique (id, gameweek_contest_id),
  -- the entry's contest provably belongs to this league/gameweek/competition
  foreign key (gameweek_contest_id, league_id, gameweek_id, competition_id)
    references cashford.gameweek_contests (id, league_id, gameweek_id, competition_id),
  -- the entrant is provably an eligible member of THIS league's competition
  foreign key (league_id, user_id, competition_id)
    references cashford.member_competitions (league_id, user_id, competition_id)
);

create index if not exists idx_gameweek_entries_contest
  on cashford.gameweek_entries (gameweek_contest_id);
create index if not exists idx_gameweek_entries_user
  on cashford.gameweek_entries (user_id);
create index if not exists idx_gameweek_entries_gw_locked
  on cashford.gameweek_entries (gameweek_id) where status = 'locked_in';

-- ============================================================
-- 4. gameweek_picks (§0.2)
--    membership_id proves PROVENANCE (the fixture really was in this gameweek when picked).
--    SCORING AND COMPLETENESS MATCH ON fixture_id, never on membership_id being the current
--    active row: after void-then-return the old membership row persists so the FK stays valid
--    and the original pick counts again (L4).
-- ============================================================
create table if not exists cashford.gameweek_picks (
  id             uuid primary key default gen_random_uuid(),
  entry_id       uuid not null references cashford.gameweek_entries(id) on delete cascade,
  membership_id  uuid not null,
  gameweek_id    uuid not null,
  fixture_id     uuid not null,
  competition_id uuid not null,
  pred_home      int not null check (pred_home between 0 and 99),
  pred_away      int not null check (pred_away between 0 and 99),
  updated_at     timestamptz not null default now(),
  unique (entry_id, fixture_id),
  foreign key (entry_id, gameweek_id, competition_id)
    references cashford.gameweek_entries (id, gameweek_id, competition_id) on delete cascade,
  -- full scope: the pick's membership belongs to the SAME gameweek, fixture and competition
  foreign key (membership_id, gameweek_id, fixture_id, competition_id)
    references cashford.gameweek_fixtures (id, gameweek_id, fixture_id, competition_id)
);

create index if not exists idx_gameweek_picks_entry on cashford.gameweek_picks (entry_id);
create index if not exists idx_gameweek_picks_fixture on cashford.gameweek_picks (fixture_id);

-- ============================================================
-- 5. Results (§0.3) — normalized per-entry outcome + one contest-level snapshot.
--    Per-entry rows exist ONLY for outcome='settled'. History lives in the audit log and in
--    reversed transfers; these two tables are the replaceable CURRENT snapshot.
-- ============================================================
create table if not exists cashford.gameweek_entry_results (
  entry_id            uuid primary key
                        references cashford.gameweek_entries(id) on delete cascade,
  -- NOT NULL so the coupled FK actually binds; a null referencing column bypasses a
  -- composite FK, which would let an entry from contest A carry a result for contest B.
  gameweek_contest_id uuid not null,
  points              int not null,
  exacts              int not null,
  goal_error          int not null,
  net_inr             int not null,
  is_winner           boolean not null,
  per_fixture         jsonb not null,
  settled_version     int not null,
  settled_at          timestamptz not null default now(),
  foreign key (entry_id, gameweek_contest_id)
    references cashford.gameweek_entries (id, gameweek_contest_id) on delete cascade
);

create index if not exists idx_gameweek_entry_results_contest
  on cashford.gameweek_entry_results (gameweek_contest_id);

create table if not exists cashford.gameweek_results (
  gameweek_contest_id uuid primary key
                        references cashford.gameweek_contests(id) on delete restrict,
  outcome             text not null check (outcome in ('settled','void')),
  void_reason         text check (void_reason in ('no_entrants','single_entrant','all_fixtures_void')),
  tiebreak_used       text check (tiebreak_used in ('none','exacts','goalError','split')),
  pot_inr             int,
  -- the input_version this result CONSUMED; the dirty predicate reads it (§0.6)
  settled_version     int not null,
  -- UI-safe re-settle cause (league members read this row); full history is in the audit log
  last_settle_cause   text not null
                        check (last_settle_cause in ('initial','result_revision','membership_change','combined')),
  settled_at          timestamptz not null default now(),
  constraint chk_gameweek_result_shape check (
    (outcome = 'settled' and tiebreak_used is not null and void_reason is null)
    or (outcome = 'void' and void_reason is not null and tiebreak_used is null)
  )
);

-- ============================================================
-- 6. transfers — dual identity: legacy cup contest OR gameweek pot, never both (§0.4)
-- ============================================================
alter table cashford.transfers alter column contest_id drop not null;
alter table cashford.transfers add column if not exists gameweek_contest_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'chk_transfer_one_contest'
                   and conrelid = 'cashford.transfers'::regclass) then
    alter table cashford.transfers
      add constraint chk_transfer_one_contest
      check ((contest_id is null) <> (gameweek_contest_id is null));
  end if;

  -- The league provably matches the pot's league.
  if not exists (select 1 from pg_constraint
                 where conname = 'transfers_gameweek_contest_league_fkey'
                   and conrelid = 'cashford.transfers'::regclass) then
    alter table cashford.transfers
      add constraint transfers_gameweek_contest_league_fkey
      foreign key (gameweek_contest_id, league_id)
      references cashford.gameweek_contests (id, league_id);
  end if;

  -- Payer and receiver are provably entrants of THAT pot. MATCH SIMPLE: legacy rows carry a
  -- null gameweek_contest_id, so these constraints do not apply to them.
  if not exists (select 1 from pg_constraint
                 where conname = 'transfers_gameweek_payer_fkey'
                   and conrelid = 'cashford.transfers'::regclass) then
    alter table cashford.transfers
      add constraint transfers_gameweek_payer_fkey
      foreign key (gameweek_contest_id, from_user_id)
      references cashford.gameweek_entries (gameweek_contest_id, user_id);
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'transfers_gameweek_receiver_fkey'
                   and conrelid = 'cashford.transfers'::regclass) then
    alter table cashford.transfers
      add constraint transfers_gameweek_receiver_fkey
      foreign key (gameweek_contest_id, to_user_id)
      references cashford.gameweek_entries (gameweek_contest_id, user_id);
  end if;
end $$;

create index if not exists idx_transfers_gameweek_contest
  on cashford.transfers (gameweek_contest_id) where reversed = false;

-- ============================================================
-- 7. gameweek_audit_log (§0.5) — every claim / settle / void / release / re-settle
-- ============================================================
create table if not exists cashford.gameweek_audit_log (
  id                  uuid primary key default gen_random_uuid(),
  gameweek_contest_id uuid not null references cashford.gameweek_contests(id) on delete restrict,
  action              text not null,
  cause               text,
  input_version       int,
  detail              jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists idx_gameweek_audit_contest
  on cashford.gameweek_audit_log (gameweek_contest_id, created_at);

-- ============================================================
-- 8. Row Level Security — reads only; every write goes through a routine.
-- ============================================================
alter table cashford.gameweek_entries       enable row level security;
alter table cashford.gameweek_picks         enable row level security;
alter table cashford.gameweek_entry_results enable row level security;
alter table cashford.gameweek_results       enable row level security;
alter table cashford.gameweek_audit_log     enable row level security;

-- Entrant identity and count are public product info inside a league ("6 of 9 in").
drop policy if exists gameweek_entries_select on cashford.gameweek_entries;
create policy gameweek_entries_select on cashford.gameweek_entries
  for select to authenticated
  using (league_id in (select cashford.my_league_ids()));

-- THE REVEAL RULE LIVES HERE, not in the API: a direct authenticated query must not leak
-- another member's picks before the deadline.
drop policy if exists gameweek_picks_select on cashford.gameweek_picks;
create policy gameweek_picks_select on cashford.gameweek_picks
  for select to authenticated
  using (exists (
    select 1
      from cashford.gameweek_entries e
      join cashford.gameweek_contests gc on gc.id = e.gameweek_contest_id
     where e.id = gameweek_picks.entry_id
       and gc.league_id in (select cashford.my_league_ids())
       and (e.user_id = (select auth.uid()) or gc.deadline_at <= now())
  ));

drop policy if exists gameweek_entry_results_select on cashford.gameweek_entry_results;
create policy gameweek_entry_results_select on cashford.gameweek_entry_results
  for select to authenticated
  using (exists (
    select 1 from cashford.gameweek_contests gc
     where gc.id = gameweek_entry_results.gameweek_contest_id
       and gc.league_id in (select cashford.my_league_ids())
  ));

drop policy if exists gameweek_results_select on cashford.gameweek_results;
create policy gameweek_results_select on cashford.gameweek_results
  for select to authenticated
  using (exists (
    select 1 from cashford.gameweek_contests gc
     where gc.id = gameweek_results.gameweek_contest_id
       and gc.league_id in (select cashford.my_league_ids())
  ));

-- gameweek_audit_log: RLS enabled with NO policies → deny-all; service_role bypasses.

-- No INSERT/UPDATE/DELETE policies anywhere on the new tables. The schema's blanket
-- `grant all … to anon, authenticated` (20260618000002) would otherwise let a client attempt
-- writes that only RLS stops, so revoke the write privileges outright.
revoke insert, update, delete on cashford.gameweek_entries       from anon, authenticated;
revoke insert, update, delete on cashford.gameweek_picks         from anon, authenticated;
revoke insert, update, delete on cashford.gameweek_entry_results from anon, authenticated;
revoke insert, update, delete on cashford.gameweek_results       from anon, authenticated;
revoke all                    on cashford.gameweek_audit_log     from anon, authenticated;
grant all on cashford.gameweek_entries       to service_role;
grant all on cashford.gameweek_picks         to service_role;
grant all on cashford.gameweek_entry_results to service_role;
grant all on cashford.gameweek_results       to service_role;
grant all on cashford.gameweek_audit_log     to service_role;

-- The new tables are deliberately NOT added to supabase_realtime — picks especially: a
-- realtime subscription is not filtered by the reveal rule above.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'cashford'
                  and tablename = 'gameweek_picks') then
      execute 'alter publication supabase_realtime drop table cashford.gameweek_picks';
    end if;
  end if;
end $$;

-- ============================================================
-- 9. Lock helpers (§0.6) — one order for every writer.
-- ============================================================
create or replace function cashford.lock_competition_gate(p_competition_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_competition_id is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_competition_id::text, 1));
end;
$$;

-- Ascending uuid order, always. A loop (not `select … order by`) because the evaluation order
-- of a function in a target list is not guaranteed to follow ORDER BY.
create or replace function cashford.lock_gameweeks(p_gameweek_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  for v_id in
    select distinct u from unnest(p_gameweek_ids) u where u is not null order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_id::text, 0));
  end loop;
end;
$$;

-- ============================================================
-- 10. Effective membership rule (§0b) — ONE state per (gameweek, fixture).
--     Active wins over older void rows; void wins over a later excluded return;
--     excluded-only history is ignored entirely.
-- ============================================================
create or replace function cashford.gameweek_effective_fixtures(p_gameweek_id uuid)
returns table (fixture_id uuid, eff_state text)
language sql
stable
security definer
set search_path = ''
as $$
  select gf.fixture_id,
         case when bool_or(gf.state = 'active') then 'active' else 'void' end
    from cashford.gameweek_fixtures gf
   where gf.gameweek_id = p_gameweek_id
   group by gf.fixture_id
  having bool_or(gf.state = 'active') or bool_or(gf.state = 'void');
$$;

-- ============================================================
-- 11. input_version bump rule (§0.6)
--     Called ONLY when the canonical input projection of the gameweek actually changed:
--     (a) a fixture's effective state moved among active/void/absent,
--     (b) an effective-active fixture's stored scores changed,
--     (c) an effective-active fixture's status changed to or from 'finished'.
--     Repeated observations, excluded-only churn and non-member fixtures never call it.
--
--     input_version_txid makes this exactly-once per contest per transaction: a
--     reconciliation that changes membership AND scores bumps once, with cause 'combined'.
-- ============================================================
create or replace function cashford.bump_gameweek_input(p_gameweek_id uuid, p_cause text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows int;
begin
  if p_cause not in ('result_revision','membership_change') then
    raise exception 'bump_gameweek_input: bad cause %', p_cause;
  end if;

  update cashford.gameweek_contests gc
     set input_version = case
           when gc.input_version_txid is distinct from pg_current_xact_id()::text::bigint
           then gc.input_version + 1 else gc.input_version end,
         input_version_txid = pg_current_xact_id()::text::bigint,
         pending_cause = case
           when gc.pending_cause is null then p_cause
           when gc.pending_cause = p_cause then gc.pending_cause
           else 'combined' end
   where gc.gameweek_id = p_gameweek_id;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

-- ============================================================
-- 12. Entry completeness (L8)
--     Recomputed in both directions: a fixture ADDED to an open gameweek breaks completeness
--     ('needs_update'); a fixture VOIDED can restore it ('entered'). Only ever touches
--     pre-deadline statuses — 'locked_in' and 'invalid' are final.
-- ============================================================
create or replace function cashford.refresh_entry_completeness(p_gameweek_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows int;
begin
  with active_fx as (
    select ef.fixture_id from cashford.gameweek_effective_fixtures(p_gameweek_id) ef
     where ef.eff_state = 'active'
  ), want as (
    select e.id,
           case when not exists (
                  select 1 from active_fx a
                   where not exists (select 1 from cashford.gameweek_picks p
                                      where p.entry_id = e.id and p.fixture_id = a.fixture_id)
                ) then 'entered' else 'needs_update' end as status
      from cashford.gameweek_entries e
     where e.gameweek_id = p_gameweek_id
       and e.status in ('entered','needs_update')
  ), moved as (
    update cashford.gameweek_entries e
       set status = w.status, updated_at = now()
      from want w
     where e.id = w.id and e.status <> w.status
    returning 1
  ) select count(*) into v_rows from moved;

  return v_rows;
end;
$$;

-- ============================================================
-- 13. apply_score_update — REWRITTEN (§0.6)
--     The Phase 1 version locked the fixture row FIRST. That inversion would deadlock against
--     a settlement claim, which holds the gameweek advisory lock and then locks fixture rows.
--     Order now: competition gate → gameweek advisory locks (ascending) → fixture row →
--     legacy contests. Everything else about the Phase 1 predicates is unchanged.
-- ============================================================
create or replace function cashford.apply_score_update(
  p_fixture_id uuid,
  p_home       int,
  p_away       int,
  p_source     text,
  p_status     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  fx                record;
  r                 record;
  v_has_score       boolean;
  v_score_changed   boolean;
  v_status          text;
  v_status_rejected boolean := false;
  v_finished_flip   boolean;
  v_bumped          int := 0;
begin
  if p_source not in ('espn','fpl') then
    raise exception 'apply_score_update: unknown source %', p_source;
  end if;

  -- Step 1/2 of the lock order, BEFORE any row lock. Read the fixture's competition and the
  -- gameweeks it is a member of (any state), take the gate and the gameweek locks, then
  -- re-read everything under those locks.
  perform cashford.lock_competition_gate(
    (select f.competition_id from cashford.fixtures f where f.id = p_fixture_id));
  perform cashford.lock_gameweeks(
    (select array_agg(distinct gf.gameweek_id)
       from cashford.gameweek_fixtures gf where gf.fixture_id = p_fixture_id));

  -- Step 3/4: the fixture row, then its legacy contests — which orders this call against a
  -- concurrent legacy settlement claim (locked → settling).
  select * into fx from cashford.fixtures where id = p_fixture_id for update;
  if not found then
    return jsonb_build_object('applied', false, 'reason', 'fixture not found');
  end if;
  perform 1 from cashford.contests where fixture_id = p_fixture_id for update;

  -- §2: FPL never overwrites an ESPN observation on a fixture ESPN can actually see.
  if p_source = 'fpl' and fx.score_source = 'espn' and fx.external_id is not null then
    return jsonb_build_object('applied', false, 'reason', 'espn owns this score');
  end if;

  -- §5: FPL may set a TERMINAL status only for fixtures ESPN can never poll (external_id null),
  -- otherwise an unmatched fixture could never finish and its gameweek could never complete.
  v_status := coalesce(p_status, fx.status);
  if p_source = 'fpl'
     and p_status in ('finished','postponed','cancelled','abandoned')
     and fx.external_id is not null then
    v_status := fx.status;
    v_status_rejected := true;
  end if;

  v_has_score := p_home is not null and p_away is not null;
  v_score_changed := v_has_score
    and ((fx.ft_home is distinct from p_home) or (fx.ft_away is distinct from p_away));
  -- (c) readiness change: a status flip to or from 'finished' changes the projection even
  -- when the scores do not.
  v_finished_flip := (v_status = 'finished') <> (fx.status = 'finished');

  -- §1.9 Phase 1 scope limit: a settled CUP contest is never regraded here. Gameweek pots are
  -- different — a corrected score is exactly the re-settle path, and the bump below triggers it.
  if fx.status = 'finished' and v_score_changed then
    if exists (
      select 1 from cashford.contests c
       where c.fixture_id = p_fixture_id
         and (c.status = 'settling' or c.settled_at is not null)
    ) then
      insert into cashford.sync_issues (source, kind, ref, detail)
      values (p_source, 'settled-correction', p_fixture_id::text,
              jsonb_build_object('old_home', fx.ft_home, 'old_away', fx.ft_away,
                                 'new_home', p_home,     'new_away', p_away));
      return jsonb_build_object('applied', false, 'reason', 'settled contests exist');
    end if;

    insert into cashford.result_revisions
      (fixture_id, old_home, old_away, new_home, new_away, source)
    values (p_fixture_id, fx.ft_home, fx.ft_away, p_home, p_away, p_source);
  end if;

  if v_status_rejected then
    insert into cashford.sync_issues (source, kind, ref, detail)
    values (p_source, 'terminal-status-rejected', p_fixture_id::text,
            jsonb_build_object('requested_status', p_status, 'external_id', fx.external_id));
  end if;

  update cashford.fixtures
     set ft_home   = case when v_has_score then p_home else ft_home end,
         ft_away   = case when v_has_score then p_away else ft_away end,
         status    = v_status,
         finished_at = case when v_status = 'finished' and finished_at is null
                            then now() else finished_at end,
         score_source      = case when v_has_score then p_source else score_source end,
         score_observed_at = case when v_has_score then now() else score_observed_at end,
         updated_at = now()
   where id = p_fixture_id;

  -- Bump rule (b) and (c): only for gameweeks where this fixture is EFFECTIVE-ACTIVE.
  if v_score_changed or v_finished_flip then
    for r in
      select distinct gf.gameweek_id
        from cashford.gameweek_fixtures gf
       where gf.fixture_id = p_fixture_id and gf.state = 'active'
    loop
      v_bumped := v_bumped + cashford.bump_gameweek_input(r.gameweek_id, 'result_revision');
    end loop;
  end if;

  return jsonb_build_object('applied', true, 'score_changed', v_score_changed,
                            'status', v_status, 'status_rejected', v_status_rejected,
                            'readiness_changed', v_finished_flip,
                            'contests_bumped', v_bumped);
end;
$$;

-- ============================================================
-- 14. run_gameweek_maintenance — EXTENDED (L3, W1 voids, dirty-W1 path)
--     Everything Phase 1 did, plus: take the §0.6 locks up front; at the deadline resolve
--     entries to locked_in / invalid; write 0/1-entrant voids atomically without a claim; and
--     advance settled_version for a dirty W1 void that can never need compute.
-- ============================================================
create or replace function cashford.run_gameweek_maintenance(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status       text;
  v_open         uuid;
  v_completed    int := 0;
  v_locked       int := 0;
  v_pots         int := 0;
  v_pots_shut    int := 0;
  v_locked_in    int := 0;
  v_invalid      int := 0;
  v_w1_voids     int := 0;
  v_w1_refreshed int := 0;
  v_completeness int := 0;
  r              record;
begin
  select status into v_status from cashford.competitions where id = p_competition_id;
  if v_status is null then
    raise exception 'run_gameweek_maintenance: unknown competition %', p_competition_id;
  end if;

  -- §0.6 steps 1 and 2: the competition gate, then EVERY gameweek this run may touch, in
  -- ascending uuid order, up front.
  perform cashford.lock_competition_gate(p_competition_id);
  perform cashford.lock_gameweeks(
    (select array_agg(g.id) from cashford.gameweeks g where g.competition_id = p_competition_id));

  -- COMPLETE: deadline passed AND every ACTIVE membership points at a finished fixture with
  -- final scores. The deadline condition stops a zero-fixture gameweek completing vacuously.
  -- A postponed/cancelled/abandoned fixture must have its membership voided by reconciliation
  -- first — completion never counts a non-finished fixture.
  with done as (
    update cashford.gameweeks g
       set status = 'completed', locked_at = coalesce(g.locked_at, g.deadline_at)
     where g.competition_id = p_competition_id
       and g.status in ('open','locked')
       and g.deadline_at is not null and now() >= g.deadline_at
       and not exists (
         select 1 from cashford.gameweek_fixtures gf
           join cashford.fixtures f on f.id = gf.fixture_id
          where gf.gameweek_id = g.id and gf.state = 'active'
            and (f.status <> 'finished' or f.ft_home is null or f.ft_away is null)
       )
    returning 1
  ) select count(*) into v_completed from done;

  -- LOCK: deadline passed. Lazy stamping — a gameweek is TREATED as locked from the moment
  -- now() >= deadline_at regardless of when cron next arrives.
  with shut as (
    update cashford.gameweeks
       set status = 'locked', locked_at = coalesce(locked_at, now())
     where competition_id = p_competition_id
       and status in ('upcoming','open')
       and deadline_at is not null and now() >= deadline_at
    returning 1
  ) select count(*) into v_locked from shut;

  -- LOCK POTS: on the pot's OWN deadline_at snapshot (§1.2), never the gameweek's. A snapshot
  -- that drifted from its gameweek means something went wrong upstream, and members entered
  -- against the value they were shown — so that is the value that closes them. Keying off the
  -- snapshot instead of the gameweek's status also catches pots whose gameweek went straight
  -- to 'completed' in the block above.
  with shut_pots as (
    update cashford.gameweek_contests
       set status = 'locked'
     where competition_id = p_competition_id
       and status = 'open'
       and now() >= deadline_at
    returning 1
  ) select count(*) into v_pots_shut from shut_pots;

  -- L3 RESOLVE ENTRIES: at the deadline, a complete pick set locks in and stakes; an entry
  -- left incomplete by a fixture addition it never answered becomes 'invalid' — visible as a
  -- system-invalidated submission that stakes nothing and wins nothing (L8).
  with locked_pots as (
    select gc.id, gc.gameweek_id from cashford.gameweek_contests gc
     where gc.competition_id = p_competition_id and gc.status = 'locked'
  ), active_fx as (
    select lp.gameweek_id, ef.fixture_id
      from (select distinct gameweek_id from locked_pots) lp
      cross join lateral cashford.gameweek_effective_fixtures(lp.gameweek_id) ef
     where ef.eff_state = 'active'
  ), resolved as (
    update cashford.gameweek_entries e
       set status = case when not exists (
                           select 1 from active_fx a
                            where a.gameweek_id = e.gameweek_id
                              and not exists (select 1 from cashford.gameweek_picks p
                                               where p.entry_id = e.id
                                                 and p.fixture_id = a.fixture_id)
                         ) then 'locked_in' else 'invalid' end,
           updated_at = now()
      from locked_pots lp
     where e.gameweek_contest_id = lp.id
       and e.status in ('entered','needs_update')
    returning e.status
  )
  select count(*) filter (where status = 'locked_in'),
         count(*) filter (where status = 'invalid')
    into v_locked_in, v_invalid
    from resolved;

  -- W1 VOIDS, written here in the same transaction: a pot with fewer than 2 locked-in entries
  -- can never need compute, so it never goes near the claim path. No transfers, no per-entry
  -- result rows (§0.3), no waiting for results (W2 precedence puts entrant-count voids first).
  for r in
    select gc.id, gc.input_version,
           (select count(*) from cashford.gameweek_entries e
             where e.gameweek_contest_id = gc.id and e.status = 'locked_in') as n
      from cashford.gameweek_contests gc
     where gc.competition_id = p_competition_id
       and gc.status = 'locked'
       and not exists (select 1 from cashford.gameweek_results gr
                        where gr.gameweek_contest_id = gc.id)
  loop
    continue when r.n >= 2;

    insert into cashford.gameweek_results
      (gameweek_contest_id, outcome, void_reason, settled_version, last_settle_cause, pot_inr)
    values (r.id, 'void',
            case when r.n = 0 then 'no_entrants' else 'single_entrant' end,
            r.input_version, 'initial', 0);

    update cashford.gameweek_contests
       set status = 'void', settled_at = now(), pending_cause = null
     where id = r.id;

    insert into cashford.gameweek_audit_log
      (gameweek_contest_id, action, cause, input_version, detail)
    values (r.id, 'void', 'initial', r.input_version,
            jsonb_build_object('source', 'maintenance', 'locked_in', r.n,
                               'void_reason',
                               case when r.n = 0 then 'no_entrants' else 'single_entrant' end));
    v_w1_voids := v_w1_voids + 1;
  end loop;

  -- DIRTY W1 VOIDS: a 0/1-entrant void whose input moved on (a score landed, a fixture was
  -- voided) is still a 0/1-entrant void — the locked-in count cannot change after the
  -- deadline. Advance the consumed version so the dispatcher stops seeing it as dirty; never
  -- claim it.
  for r in
    select gc.id, gc.input_version, gc.pending_cause, gr.settled_version, gr.void_reason
      from cashford.gameweek_contests gc
      join cashford.gameweek_results gr on gr.gameweek_contest_id = gc.id
     where gc.competition_id = p_competition_id
       and gc.status = 'void'
       and gr.outcome = 'void'
       and gc.input_version > gr.settled_version
       and (select count(*) from cashford.gameweek_entries e
             where e.gameweek_contest_id = gc.id and e.status = 'locked_in') < 2
  loop
    update cashford.gameweek_results
       set settled_version = r.input_version,
           last_settle_cause = coalesce(r.pending_cause, 'result_revision'),
           settled_at = now()
     where gameweek_contest_id = r.id;

    update cashford.gameweek_contests set pending_cause = null where id = r.id;

    insert into cashford.gameweek_audit_log
      (gameweek_contest_id, action, cause, input_version, detail)
    values (r.id, 'void_refresh', coalesce(r.pending_cause, 'result_revision'), r.input_version,
            jsonb_build_object('source', 'maintenance', 'prior_version', r.settled_version,
                               'void_reason', r.void_reason));
    v_w1_refreshed := v_w1_refreshed + 1;
  end loop;

  -- OPEN: the earliest gameweek whose deadline is still in the future. Zero is valid.
  select id into v_open
    from cashford.gameweeks
   where competition_id = p_competition_id
     and status in ('upcoming','open')
     and deadline_at is not null and deadline_at > now()
   order by deadline_at, number
   limit 1;

  update cashford.gameweeks
     set status = 'upcoming'
   where competition_id = p_competition_id and status = 'open'
     and (v_open is null or id <> v_open);

  if v_open is not null then
    update cashford.gameweeks set status = 'open' where id = v_open and status <> 'open';

    -- A league or member that joined during a zero-open window carries a null boundary;
    -- opening a gameweek is where that resolves.
    update cashford.member_competitions
       set eligible_from_gameweek_id = v_open
     where competition_id = p_competition_id and eligible_from_gameweek_id is null;
    update cashford.league_competitions
       set eligible_from_gameweek_id = v_open
     where competition_id = p_competition_id and eligible_from_gameweek_id is null;

    -- Provision the pot for the OPEN gameweek only, and only once the competition is live.
    -- Stake snapshots here; a later league-stake change affects only future gameweeks.
    if v_status = 'active' then
      with made as (
        insert into cashford.gameweek_contests
          (league_id, gameweek_id, competition_id, stake_inr, deadline_at)
        select lc.league_id, g.id, p_competition_id, l.default_stake_inr, g.deadline_at
          from cashford.league_competitions lc
          join cashford.leagues l on l.id = lc.league_id
          join cashford.gameweeks g on g.id = v_open
         where lc.competition_id = p_competition_id
           and lc.status = 'active'
           and g.deadline_at is not null
        on conflict (league_id, gameweek_id) do nothing
        returning 1
      ) select count(*) into v_pots from made;
    end if;

    -- Keep pre-deadline entry statuses honest against the current fixture list (L8).
    v_completeness := cashford.refresh_entry_completeness(v_open);
  end if;

  return jsonb_build_object('open_gameweek_id', v_open, 'completed', v_completed,
                            'locked', v_locked, 'pots_provisioned', v_pots,
                            'pots_locked', v_pots_shut,
                            'entries_locked_in', v_locked_in, 'entries_invalid', v_invalid,
                            'w1_voids', v_w1_voids, 'w1_voids_refreshed', v_w1_refreshed,
                            'completeness_updated', v_completeness);
end;
$$;

-- ============================================================
-- 15. apply_fpl_reconciliation — MODIFIED (§0.6 gate + bump rule + L8 completeness)
--     Unchanged Phase 1 body, plus: the competition advisory gate and every gameweek lock up
--     front, a membership_change bump on each effective-state transition, and a completeness
--     refresh for every gameweek whose fixture list moved.
-- ============================================================
create or replace function cashford.apply_fpl_reconciliation(snapshot jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  comp              record;
  r                 record;
  v_new_id          uuid;
  v_frozen          boolean;
  v_gw_inserted     int := 0;
  v_deadlines       int := 0;
  v_fx_inserted     int := 0;
  v_fx_updated      int := 0;
  v_moves           int := 0;
  v_excluded        int := 0;
  v_scores          int := 0;
  v_bumped          int := 0;
  v_touched_gws     uuid[] := array[]::uuid[];
  v_gw              uuid;
begin
  select * into comp from cashford.competitions
   where slug = snapshot->>'competition_slug';
  if not found then
    raise exception 'apply_fpl_reconciliation: unknown competition %',
      snapshot->>'competition_slug';
  end if;
  if not comp.fpl_source then
    raise exception 'apply_fpl_reconciliation: % is not an FPL-sourced competition', comp.slug;
  end if;

  -- §0.6 steps 1 and 2. Reconciliation can touch any gameweek of the competition (and creates
  -- new ones below, which no other session can see yet), so lock the lot ascending up front.
  perform cashford.lock_competition_gate(comp.id);
  perform cashford.lock_gameweeks(
    (select array_agg(g.id) from cashford.gameweeks g where g.competition_id = comp.id));

  -- 1. New gameweeks.
  with added as (
    insert into cashford.gameweeks
      (competition_id, number, name, deadline_at, fpl_event_id, status)
    select comp.id, (e->>'number')::int, e->>'name',
           nullif(e->>'deadline_at','')::timestamptz, (e->>'fpl_event_id')::int, 'upcoming'
      from jsonb_array_elements(snapshot->'gameweeks') e
    on conflict (competition_id, fpl_event_id) do nothing
    returning 1
  ) select count(*) into v_gw_inserted from added;

  -- 2. Deadline changes. Accepted ONLY while the stored deadline is still in the future, the
  --    gameweek was never stamped locked, and no actively-member fixture has kicked off. After
  --    that the deadline is frozen forever, even if cron lagged — no reopening, ever.
  for r in
    select g.id, g.deadline_at, g.locked_at, g.name,
           nullif(e->>'deadline_at','')::timestamptz as new_deadline,
           e->>'name' as new_name
      from jsonb_array_elements(snapshot->'gameweeks') e
      join cashford.gameweeks g
        on g.competition_id = comp.id and g.fpl_event_id = (e->>'fpl_event_id')::int
  loop
    if r.new_name is distinct from r.name then
      update cashford.gameweeks set name = r.new_name where id = r.id;
    end if;

    if r.new_deadline is distinct from r.deadline_at then
      if r.deadline_at is null
         or (r.locked_at is null and now() < r.deadline_at
             and not exists (
               select 1 from cashford.gameweek_fixtures gf
                 join cashford.fixtures f on f.id = gf.fixture_id
                where gf.gameweek_id = r.id and gf.state = 'active'
                  and f.kickoff_at is not null and f.kickoff_at <= now()
             ))
      then
        update cashford.gameweeks set deadline_at = r.new_deadline where id = r.id;
        -- Open pots track an accepted change in the same transaction. Locked pots never do.
        update cashford.gameweek_contests
           set deadline_at = r.new_deadline
         where gameweek_id = r.id and status = 'open';
        v_deadlines := v_deadlines + 1;
      else
        insert into cashford.sync_issues (source, kind, ref, detail)
        values ('fpl', 'deadline-frozen', r.id::text,
                jsonb_build_object('stored', r.deadline_at, 'proposed', r.new_deadline));
      end if;
    end if;
  end loop;

  -- 3. Fixtures: insert new, then refresh kickoff/teams on existing ones.
  with added as (
    insert into cashford.fixtures
      (competition_id, fpl_fixture_id, kickoff_at, home_team_id, away_team_id)
    select comp.id, (e->>'fpl_fixture_id')::int, nullif(e->>'kickoff_at','')::timestamptz,
           (e->>'home_team_id')::uuid, (e->>'away_team_id')::uuid
      from jsonb_array_elements(snapshot->'fixtures') e
    on conflict (competition_id, fpl_fixture_id) do nothing
    returning 1
  ) select count(*) into v_fx_inserted from added;

  with src as (
    select (e->>'fpl_fixture_id')::int as fpl_fixture_id,
           nullif(e->>'kickoff_at','')::timestamptz as kickoff_at,
           (e->>'home_team_id')::uuid as home_team_id,
           (e->>'away_team_id')::uuid as away_team_id
      from jsonb_array_elements(snapshot->'fixtures') e
  ), touched as (
    update cashford.fixtures f
       set kickoff_at = s.kickoff_at,
           home_team_id = s.home_team_id,
           away_team_id = s.away_team_id,
           updated_at = now()
      from src s
     where f.competition_id = comp.id
       and f.fpl_fixture_id = s.fpl_fixture_id
       and (f.kickoff_at   is distinct from s.kickoff_at
         or f.home_team_id is distinct from s.home_team_id
         or f.away_team_id is distinct from s.away_team_id)
    returning 1
  ) select count(*) into v_fx_updated from touched;

  -- 4. Membership. Compare FPL's event against the fixture's CURRENT row whatever its state,
  --    so a repeated observation of a late assignment is a no-op and excluded→null /
  --    excluded→other-gameweek moves are representable.
  for r in
    select f.id as fixture_id,
           tgw.id as target_gw_id, tgw.status as target_status, tgw.deadline_at as target_deadline,
           cur.id as cur_id, cur.gameweek_id as cur_gw_id, cur.state as cur_state
      from jsonb_array_elements(snapshot->'fixtures') e
      join cashford.fixtures f
        on f.competition_id = comp.id and f.fpl_fixture_id = (e->>'fpl_fixture_id')::int
      left join cashford.gameweeks tgw
        on tgw.competition_id = comp.id
       and tgw.fpl_event_id = nullif(e->>'fpl_event_id','')::int
      left join cashford.gameweek_fixtures cur
        on cur.fixture_id = f.id and cur.is_current
  loop
    -- Same gameweek (or still unassigned) → nothing to do.
    continue when r.target_gw_id is not distinct from r.cur_gw_id;

    -- Closing the current assignment is ALWAYS allowed. How depends on its state: an active
    -- row is voided; an excluded row was never counted, so it only loses is_current.
    if r.cur_id is not null then
      if r.cur_state = 'active' then
        update cashford.gameweek_fixtures
           set state = 'void', is_current = false, voided_at = now(),
               void_reason = case when r.target_gw_id is null then 'unassigned' else 'moved' end
         where id = r.cur_id;
        -- Bump rule (a): active → void changes the effective state of the OLD gameweek.
        v_bumped := v_bumped + cashford.bump_gameweek_input(r.cur_gw_id, 'membership_change');
        v_touched_gws := v_touched_gws || r.cur_gw_id;
      else
        update cashford.gameweek_fixtures set is_current = false where id = r.cur_id;
        -- Excluded-only history churn is NOT a projection change: no bump.
      end if;
    end if;

    v_new_id := null;
    if r.target_gw_id is not null then
      -- A destination that has frozen (locked/completed, or its deadline has passed) accepts
      -- the fixture as the CURRENT assignment but never as an active one: the fixture list
      -- freezes at the deadline, and a completed gameweek is never changed.
      v_frozen := not (r.target_status in ('upcoming','open')
                       and (r.target_deadline is null or now() < r.target_deadline));

      insert into cashford.gameweek_fixtures
        (gameweek_id, fixture_id, competition_id, state, is_current)
      values (r.target_gw_id, r.fixture_id, comp.id,
              case when v_frozen then 'excluded' else 'active' end, true)
      returning id into v_new_id;

      if v_frozen then
        v_excluded := v_excluded + 1;
        insert into cashford.sync_issues (source, kind, ref, detail)
        values ('fpl', 'late-assignment', r.fixture_id::text,
                jsonb_build_object('gameweek_id', r.target_gw_id,
                                   'gameweek_status', r.target_status,
                                   'deadline_at', r.target_deadline));
      else
        -- Bump rule (a): absent (or void) → active in the NEW gameweek.
        v_bumped := v_bumped + cashford.bump_gameweek_input(r.target_gw_id, 'membership_change');
        v_touched_gws := v_touched_gws || r.target_gw_id;
      end if;
    end if;

    insert into cashford.fixture_moves (fixture_id, old_membership_id, new_membership_id)
    values (r.fixture_id, r.cur_id, v_new_id)
    on conflict do nothing;
    v_moves := v_moves + 1;
  end loop;

  -- L8: a fixture added to an OPEN gameweek breaks completeness for entries already in;
  -- a fixture voided can restore it. Both directions, once per touched gameweek.
  -- Driven by a query, not FOREACH: array_agg over an empty v_touched_gws returns NULL, and
  -- FOREACH over a null array is a hard error that would abort the whole reconciliation.
  for v_gw in select distinct u from unnest(v_touched_gws) u
  loop
    perform cashford.refresh_entry_completeness(v_gw);
  end loop;

  -- 5. FPL score fallback, through the same predicates as every other score write. Score-side
  --    bumps happen inside apply_score_update; a run that changes membership AND scores bumps
  --    each contest once, with cause 'combined'.
  for r in
    select f.id as fixture_id,
           (e->>'home_score')::int as home_score,
           (e->>'away_score')::int as away_score,
           coalesce((e->>'finished')::boolean, false) as finished
      from jsonb_array_elements(snapshot->'fixtures') e
      join cashford.fixtures f
        on f.competition_id = comp.id and f.fpl_fixture_id = (e->>'fpl_fixture_id')::int
     where e->>'home_score' is not null and e->>'away_score' is not null
  loop
    if (cashford.apply_score_update(
          r.fixture_id, r.home_score, r.away_score, 'fpl',
          case when r.finished then 'finished' else null end
        ) ->> 'applied')::boolean then
      v_scores := v_scores + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'gameweeks_inserted', v_gw_inserted, 'deadlines_updated', v_deadlines,
    'fixtures_inserted', v_fx_inserted, 'fixtures_updated', v_fx_updated,
    'memberships_moved', v_moves, 'late_assignments', v_excluded,
    'scores_applied', v_scores, 'contests_bumped', v_bumped
  );
end;
$$;

-- ============================================================
-- 16. Entry + edit (L1, L2, L9) — one transaction each.
--     The internal routine holds the whole rule set; the two public wrappers differ only in
--     whether an entry must already exist. Every check the API makes is repeated here,
--     because `authenticated` can call these routines directly.
-- ============================================================
create or replace function cashford.write_gameweek_entry(
  p_league_id        uuid,
  p_gameweek_id      uuid,
  p_picks            jsonb,
  p_require_existing boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_contest  record;
  v_gw       record;
  v_lc       record;
  v_mc       record;
  v_lc_from  int;
  v_mc_from  int;
  v_entry_id uuid;
  v_existing boolean;
  v_active   int;
  v_given    int;
  v_distinct int;
  v_missing  int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_league_id is null or p_gameweek_id is null then
    raise exception 'league and gameweek are required';
  end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' then
    raise exception 'picks must be an array';
  end if;

  -- §0.6 step 2. Single-gameweek path, so no competition gate.
  perform cashford.lock_gameweeks(array[p_gameweek_id]);

  -- Step 4: the contest row first.
  select * into v_contest from cashford.gameweek_contests
   where league_id = p_league_id and gameweek_id = p_gameweek_id
   for update;
  if not found then
    raise exception 'no pot for this league and gameweek';
  end if;

  select * into v_gw from cashford.gameweeks where id = p_gameweek_id;
  if v_gw.competition_id <> v_contest.competition_id then
    raise exception 'gameweek does not belong to this pot''s competition';
  end if;

  -- L1: the deadline is checked AFTER the locks, on clock_timestamp() — now() is
  -- transaction-start time, so a request that waited on a lock past the deadline must still
  -- be rejected.
  if v_contest.status <> 'open' then
    raise exception 'this gameweek is closed';
  end if;
  if clock_timestamp() >= v_contest.deadline_at then
    raise exception 'the deadline has passed';
  end if;

  -- L9 + leave/archive serialization: lock the eligibility rows while validating, so an entry
  -- validated as eligible cannot interleave with a concurrent leave or archive.
  -- FOR NO KEY UPDATE, not FOR UPDATE — see the lock-order note at the top of this file.
  select * into v_lc from cashford.league_competitions
   where league_id = p_league_id and competition_id = v_contest.competition_id
   for no key update;
  if not found or v_lc.status <> 'active' then
    raise exception 'this league is not playing this competition';
  end if;

  -- Read AFTER the league_competitions lock: archive_league takes that same lock before it
  -- touches either row, so this cannot see a half-archived league.
  if (select status from cashford.leagues where id = p_league_id) = 'archived' then
    raise exception 'this league is archived';
  end if;

  select * into v_mc from cashford.member_competitions
   where league_id = p_league_id and user_id = v_uid
     and competition_id = v_contest.competition_id
   for no key update;
  if not found then raise exception 'you are not a member of this league'; end if;
  if v_mc.left_at is not null then raise exception 'you have left this league'; end if;

  -- Eligibility compares gameweek NUMBERS within the competition, not uuids. A NULL boundary
  -- at either level is NOT YET ELIGIBLE (pending backfill) — never "eligible from the start".
  select g.number into v_lc_from from cashford.gameweeks g
   where g.id = v_lc.eligible_from_gameweek_id;
  select g.number into v_mc_from from cashford.gameweeks g
   where g.id = v_mc.eligible_from_gameweek_id;
  if v_lc_from is null or v_lc_from > v_gw.number then
    raise exception 'this league is not eligible for this gameweek yet';
  end if;
  if v_mc_from is null or v_mc_from > v_gw.number then
    raise exception 'you joined after this gameweek started';
  end if;

  -- L1 completeness: a pick for EVERY effective-active fixture, and nothing else. Extras are
  -- rejected loudly rather than silently dropped — a pick for an excluded or other-gameweek
  -- fixture means the client is working from a stale fixture list.
  --
  -- p_picks is re-expanded with jsonb_to_recordset in each query below rather than staged in a
  -- temp table: an ON COMMIT DROP temp table invalidates this function's cached plans between
  -- transactions, and pg_temp is not on the (deliberately empty) search_path.
  select count(*), count(distinct (e->>'fixture_id')) into v_given, v_distinct
    from jsonb_array_elements(p_picks) e;
  if v_given <> v_distinct then
    raise exception 'two predictions for the same fixture';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_picks)
                    as x(fixture_id uuid, pred_home int, pred_away int)
     where x.fixture_id is null or x.pred_home is null or x.pred_away is null
        or x.pred_home not between 0 and 99 or x.pred_away not between 0 and 99
  ) then
    raise exception 'every prediction must be a whole number between 0 and 99';
  end if;

  select count(*) into v_active
    from cashford.gameweek_effective_fixtures(p_gameweek_id) ef
   where ef.eff_state = 'active';
  if v_active = 0 then
    raise exception 'this gameweek has no fixtures to predict';
  end if;

  select count(*) into v_missing
    from cashford.gameweek_effective_fixtures(p_gameweek_id) ef
   where ef.eff_state = 'active'
     and not exists (select 1 from jsonb_to_recordset(p_picks) as x(fixture_id uuid)
                      where x.fixture_id = ef.fixture_id);
  if v_missing > 0 then
    raise exception 'a prediction is missing for % of % fixtures', v_missing, v_active;
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_picks) as x(fixture_id uuid)
     where not exists (select 1 from cashford.gameweek_effective_fixtures(p_gameweek_id) ef
                        where ef.fixture_id = x.fixture_id and ef.eff_state = 'active')
  ) then
    raise exception 'a prediction refers to a fixture that is not in this gameweek';
  end if;

  select id into v_entry_id from cashford.gameweek_entries
   where gameweek_contest_id = v_contest.id and user_id = v_uid
   for update;
  v_existing := v_entry_id is not null;

  if p_require_existing and not v_existing then
    raise exception 'you have not entered this gameweek yet';
  end if;

  if not v_existing then
    insert into cashford.gameweek_entries
      (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
    values (v_contest.id, p_league_id, p_gameweek_id, v_contest.competition_id, v_uid, 'entered')
    returning id into v_entry_id;
  else
    -- 'locked_in' and 'invalid' are post-deadline states; the deadline check above already
    -- rules them out, so anything here is 'entered' or 'needs_update' and becomes complete.
    update cashford.gameweek_entries
       set status = 'entered', updated_at = now()
     where id = v_entry_id;
  end if;

  -- L2/L4: replace the picks for the fixtures that are effective-active NOW, and only those.
  -- A pick for a fixture that has since gone void is KEPT: L4 promises that if the fixture
  -- returns before the deadline the original prediction still counts, and deleting it here
  -- would leave the entry incomplete and eventually invalid. The entry row is permanent.
  delete from cashford.gameweek_picks p
   where p.entry_id = v_entry_id
     and exists (select 1 from cashford.gameweek_effective_fixtures(p_gameweek_id) ef
                  where ef.fixture_id = p.fixture_id and ef.eff_state = 'active');
  insert into cashford.gameweek_picks
    (entry_id, membership_id, gameweek_id, fixture_id, competition_id, pred_home, pred_away)
  select v_entry_id, gf.id, p_gameweek_id, x.fixture_id, v_contest.competition_id,
         x.pred_home, x.pred_away
    from jsonb_to_recordset(p_picks) as x(fixture_id uuid, pred_home int, pred_away int)
    join cashford.gameweek_fixtures gf
      on gf.gameweek_id = p_gameweek_id and gf.fixture_id = x.fixture_id
     and gf.state = 'active';

  return jsonb_build_object('entry_id', v_entry_id, 'status', 'entered',
                            'picks', v_given, 'created', not v_existing,
                            'gameweek_contest_id', v_contest.id);
end;
$$;

create or replace function cashford.enter_gameweek(
  p_league_id uuid, p_gameweek_id uuid, p_picks jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select cashford.write_gameweek_entry(p_league_id, p_gameweek_id, p_picks, false);
$$;

create or replace function cashford.update_gameweek_picks(
  p_league_id uuid, p_gameweek_id uuid, p_picks jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select cashford.write_gameweek_entry(p_league_id, p_gameweek_id, p_picks, true);
$$;

-- ============================================================
-- 17. mirror (§7) — copy MY entry for this gameweek into other leagues, atomically.
--     The accepted stake TRAVELS IN THE REQUEST, so consent is provable: every target's
--     accepted_stake_inr is compared with the pot's stored stake after the locks. Validation
--     runs for ALL targets first; one error and nothing is written.
-- ============================================================
create or replace function cashford.mirror_gameweek_entry(
  p_from_league_id uuid,
  p_gameweek_id    uuid,
  p_targets        jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_gw        record;
  v_src       record;
  v_target    record;
  v_contest   record;
  v_lc        record;
  v_mc        record;
  v_lc_from   int;
  v_mc_from   int;
  v_errors    jsonb := '[]'::jsonb;
  v_created   jsonb := '[]'::jsonb;
  v_err       text;
  v_entry_id  uuid;
  v_n         int;
  v_distinct  int;
  v_active    int;
  v_copied_active int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_targets is null or jsonb_typeof(p_targets) <> 'array'
     or jsonb_array_length(p_targets) = 0 then
    raise exception 'pick at least one league to mirror into';
  end if;

  perform cashford.lock_gameweeks(array[p_gameweek_id]);
  select * into v_gw from cashford.gameweeks where id = p_gameweek_id;
  if not found then raise exception 'unknown gameweek'; end if;

  -- Counted under the gameweek lock, and before anything is validated: with no fixtures left
  -- to predict there is nothing to mirror, and the completeness test in pass 1 would otherwise
  -- pass vacuously and let a hollow entry be created.
  select count(*) into v_active
    from cashford.gameweek_effective_fixtures(p_gameweek_id) ef
   where ef.eff_state = 'active';
  if v_active = 0 then
    raise exception 'this gameweek has no fixtures to predict';
  end if;

  -- The source entry must be MINE, in this gameweek, and complete.
  select e.* into v_src
    from cashford.gameweek_entries e
   where e.league_id = p_from_league_id and e.gameweek_id = p_gameweek_id and e.user_id = v_uid;
  if not found then raise exception 'you have not entered this gameweek in that league'; end if;
  if v_src.status <> 'entered' then
    raise exception 'finish your predictions in the source league first';
  end if;

  select count(*), count(distinct (t->>'league_id')) into v_n, v_distinct
    from jsonb_array_elements(p_targets) t;
  if v_n <> v_distinct then
    raise exception 'the same league appears twice';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_targets) as t(league_id uuid)
              where t.league_id = p_from_league_id) then
    raise exception 'the source league cannot also be a target';
  end if;

  -- Step 4: contest rows in ascending uuid order, before any of them is read.
  perform 1 from cashford.gameweek_contests gc
    where gc.gameweek_id = p_gameweek_id
      and gc.league_id in (select t.league_id from jsonb_to_recordset(p_targets)
                                                     as t(league_id uuid))
    order by gc.id for update;

  -- PASS 1 — validate every target. Writes nothing.
  for v_target in
    select t.league_id, t.accepted_stake_inr,
           (select gc.id from cashford.gameweek_contests gc
             where gc.league_id = t.league_id and gc.gameweek_id = p_gameweek_id) as contest_id
      from jsonb_to_recordset(p_targets) as t(league_id uuid, accepted_stake_inr int)
     order by t.league_id
  loop
    v_err := null;

    select * into v_contest from cashford.gameweek_contests where id = v_target.contest_id;
    if v_target.contest_id is null then
      v_err := 'no pot for this league in this gameweek';
    elsif v_contest.status <> 'open' then
      v_err := 'this gameweek is closed';
    elsif clock_timestamp() >= v_contest.deadline_at then
      v_err := 'the deadline has passed';
    elsif v_target.accepted_stake_inr is distinct from v_contest.stake_inr then
      v_err := format('the stake is ₹%s, not ₹%s — reload and try again',
                      v_contest.stake_inr, coalesce(v_target.accepted_stake_inr::text, 'none'));
    end if;

    if v_err is null then
      select * into v_lc from cashford.league_competitions
       where league_id = v_target.league_id and competition_id = v_contest.competition_id
       for no key update;
      if not found or v_lc.status <> 'active' then
        v_err := 'this league is not playing this competition';
      elsif (select status from cashford.leagues where id = v_target.league_id) = 'archived' then
        -- Read after the lock above; archive_league holds it while it moves both rows.
        v_err := 'this league is archived';
      end if;
    end if;

    if v_err is null then
      select * into v_mc from cashford.member_competitions
       where league_id = v_target.league_id and user_id = v_uid
         and competition_id = v_contest.competition_id
       for no key update;
      if not found then
        v_err := 'you are not a member of this league';
      elsif v_mc.left_at is not null then
        v_err := 'you have left this league';
      else
        select g.number into v_lc_from from cashford.gameweeks g
         where g.id = v_lc.eligible_from_gameweek_id;
        select g.number into v_mc_from from cashford.gameweeks g
         where g.id = v_mc.eligible_from_gameweek_id;
        if v_lc_from is null or v_lc_from > v_gw.number then
          v_err := 'this league is not eligible for this gameweek yet';
        elsif v_mc_from is null or v_mc_from > v_gw.number then
          v_err := 'you joined after this gameweek started';
        end if;
      end if;
    end if;

    -- Same gameweek, so the source picks cover the target's fixture list by construction —
    -- but check it rather than assume it.
    if v_err is null and exists (
      select 1 from cashford.gameweek_effective_fixtures(p_gameweek_id) ef
       where ef.eff_state = 'active'
         and not exists (select 1 from cashford.gameweek_picks p
                          where p.entry_id = v_src.id and p.fixture_id = ef.fixture_id)
    ) then
      v_err := 'your predictions are out of date — reload and try again';
    end if;

    if v_err is not null then
      v_errors := v_errors || jsonb_build_object('league_id', v_target.league_id, 'error', v_err);
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors);
  end if;

  -- PASS 2 — all-or-nothing write.
  for v_target in
    select t.league_id,
           (select gc.id from cashford.gameweek_contests gc
             where gc.league_id = t.league_id and gc.gameweek_id = p_gameweek_id) as contest_id
      from jsonb_to_recordset(p_targets) as t(league_id uuid)
     order by t.league_id
  loop
    select * into v_contest from cashford.gameweek_contests where id = v_target.contest_id;

    select id into v_entry_id from cashford.gameweek_entries
     where gameweek_contest_id = v_contest.id and user_id = v_uid;
    if v_entry_id is null then
      insert into cashford.gameweek_entries
        (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
      values (v_contest.id, v_target.league_id, p_gameweek_id, v_contest.competition_id,
              v_uid, 'entered')
      returning id into v_entry_id;
    else
      update cashford.gameweek_entries set status = 'entered', updated_at = now()
       where id = v_entry_id;
    end if;

    -- Copy EVERY source pick, membership provenance included, and replace only the target's
    -- picks for the same fixtures. A target pick for a fixture the source never predicted is
    -- retained rather than wiped (L4: a void fixture's old pick counts again if it returns).
    delete from cashford.gameweek_picks p
     where p.entry_id = v_entry_id
       and exists (select 1 from cashford.gameweek_picks sp
                    where sp.entry_id = v_src.id and sp.fixture_id = p.fixture_id);

    insert into cashford.gameweek_picks
      (entry_id, membership_id, gameweek_id, fixture_id, competition_id, pred_home, pred_away)
    select v_entry_id, sp.membership_id, p_gameweek_id, sp.fixture_id, v_contest.competition_id,
           sp.pred_home, sp.pred_away
      from cashford.gameweek_picks sp
     where sp.entry_id = v_src.id;

    get diagnostics v_n = row_count;

    -- The write must have produced a complete entry. Pass 1 proved the source was complete;
    -- this proves the copy landed, so mirror can never report success on a hollow entry.
    select count(*) into v_copied_active
      from cashford.gameweek_picks p
      join cashford.gameweek_effective_fixtures(p_gameweek_id) ef
        on ef.fixture_id = p.fixture_id and ef.eff_state = 'active'
     where p.entry_id = v_entry_id;
    if v_copied_active <> v_active then
      raise exception 'mirror wrote % of % predictions for league %',
        v_copied_active, v_active, v_target.league_id;
    end if;

    v_created := v_created || jsonb_build_object('league_id', v_target.league_id,
                                                'entry_id', v_entry_id, 'picks', v_n);
  end loop;

  return jsonb_build_object('ok', true, 'mirrored', v_created);
end;
$$;

-- ============================================================
-- 18. Settlement state machine (L7). Service-role only.
--     claim → (pure TS computes) → finalize, with abort for compute failures.
-- ============================================================

-- RELEASE-OR-RECLAIM RULE. The candidate scan reports an expired claim with NO entrant and NO
-- readiness gate, because reporting it is the only way a claim abandoned by a dead worker ever
-- gets cleared. The other side of that bargain is that claim_gameweek_settlement must never
-- refuse an expired row and leave it in 'settling': the row stays a rank-0 candidate on every
-- future pass and everything dirty or ready behind it starves. So every refusal reachable while
-- status = 'settling' releases the claim first, through this one routine.
--
-- The caller already holds the contest row FOR UPDATE, so this only writes. It restores the
-- status the claim was taken from and returns it.
create or replace function cashford.release_expired_gameweek_claim(p_contest_id uuid, p_why text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  gc        record;
  v_restore text;
begin
  select * into gc from cashford.gameweek_contests where id = p_contest_id for update;
  if gc.id is null then
    raise exception 'release_expired_gameweek_claim: unknown contest %', p_contest_id;
  end if;
  v_restore := coalesce(gc.claim_prior_status, 'locked');

  update cashford.gameweek_contests
     set status = v_restore,
         claim_token = null, claim_started_at = null, claim_input_version = null,
         claim_prior_status = null
   where id = p_contest_id;

  insert into cashford.gameweek_audit_log
    (gameweek_contest_id, action, cause, input_version, detail)
  values (p_contest_id, 'abort', gc.pending_cause, gc.claim_input_version,
          jsonb_build_object('restored_status', v_restore, 'released', p_why));

  return v_restore;
end;
$$;

create or replace function cashford.claim_gameweek_settlement(p_contest_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gw_id     uuid;
  gc          record;
  gr          record;
  v_locked_in int;
  v_ready     boolean;
  v_dirty     boolean;
  v_has_result boolean;
  v_expired   boolean;
  v_token     uuid;
  v_prior     text;
  v_cause     text;
  v_entries   jsonb;
  v_results   jsonb;
begin
  select gameweek_id into v_gw_id from cashford.gameweek_contests where id = p_contest_id;
  if v_gw_id is null then
    return jsonb_build_object('claimed', false, 'reason', 'unknown contest');
  end if;

  -- §0.6 step 2, then step 3: the effective fixture rows, ascending, so no score can move
  -- between the readiness check and the snapshot.
  perform cashford.lock_gameweeks(array[v_gw_id]);
  perform 1 from cashford.fixtures f
    where f.id in (select ef.fixture_id from cashford.gameweek_effective_fixtures(v_gw_id) ef)
    order by f.id for update;

  -- Step 4, and the re-read of everything under the locks.
  select * into gc from cashford.gameweek_contests where id = p_contest_id for update;
  select * into gr from cashford.gameweek_results where gameweek_contest_id = p_contest_id;
  -- Never `gr is null`: for a record that tests whether EVERY field is null, and a settled row
  -- has a null void_reason. The primary key is the only honest presence test.
  v_has_result := gr.gameweek_contest_id is not null;

  select count(*) into v_locked_in from cashford.gameweek_entries
   where gameweek_contest_id = p_contest_id and status = 'locked_in';

  -- A settled or void contest with no result row is corrupt: never claim it, flag it.
  -- Filed ONCE per corrupt row: the row stays corrupt until a human fixes it, and an insert on
  -- every tick would bury the issue list under thousands of copies of the same finding. The
  -- candidate scan reads the same unresolved-issue test, so a flagged row also stops occupying
  -- the bounded queue. Resolving the issue puts the row back in the queue, which is what an
  -- operator who has repaired the data wants.
  if gc.status in ('settled','void') and not v_has_result then
    insert into cashford.sync_issues (source, kind, ref, detail)
    select 'gameweek', 'missing-result-row', p_contest_id::text,
           jsonb_build_object('status', gc.status, 'input_version', gc.input_version)
     where not exists (
       select 1 from cashford.sync_issues si
        where si.source = 'gameweek' and si.kind = 'missing-result-row'
          and si.ref = p_contest_id::text and si.resolved_at is null);
    return jsonb_build_object('claimed', false, 'reason', 'corrupt: no result row');
  end if;

  -- Expiry is decided BEFORE any other validation, because every refusal below has to release
  -- an abandoned claim rather than refuse it (see the release-or-reclaim rule above). A
  -- 'settling' row with no claim stamp cannot have a live worker either — the triad is written
  -- in one statement — so it counts as abandoned too, otherwise it is stuck for good.
  v_expired := gc.status = 'settling'
               and (gc.claim_started_at is null
                    or gc.claim_started_at < now() - interval '10 minutes');

  -- The claim path handles ONLY contests with ≥2 locked-in entries. 0/1-entrant voids are
  -- written by maintenance (L3) and refreshed there when they go dirty.
  if v_locked_in < 2 then
    -- But an abandoned claim on a 0/1-entrant pot still has to come out of 'settling'. Refusing
    -- it here is what left 40 such rows sitting at rank 0 forever. Maintenance owns the void
    -- itself; this only hands the row back.
    if v_expired then
      v_prior := cashford.release_expired_gameweek_claim(p_contest_id, 'expired-under-min-entrants');
      return jsonb_build_object('claimed', false,
                                'reason', 'released expired claim: fewer than 2 locked-in entries',
                                'released', true, 'locked_in', v_locked_in, 'status', v_prior);
    end if;
    return jsonb_build_object('claimed', false, 'reason', 'fewer than 2 locked-in entries',
                              'locked_in', v_locked_in);
  end if;

  -- READINESS applies to initial, dirty and expired claims alike: every effective-ACTIVE
  -- fixture finished with both scores. A finished→live correction makes a dirty contest
  -- unready and it simply waits.
  select not exists (
    select 1 from cashford.gameweek_effective_fixtures(v_gw_id) ef
      join cashford.fixtures f on f.id = ef.fixture_id
     where ef.eff_state = 'active'
       and (f.status <> 'finished' or f.ft_home is null or f.ft_away is null)
  ) into v_ready;

  v_dirty   := v_has_result and gc.input_version > gr.settled_version;

  if not v_ready then
    -- An abandoned claim has to be released even when the data is no longer ready, or a
    -- worker crash followed by a finished→live correction leaves the pot stamped 'settling'
    -- forever: every later tick would return 'not ready' and never reach the reclaim branch.
    if v_expired then
      v_prior := cashford.release_expired_gameweek_claim(p_contest_id, 'expired-unready');
      return jsonb_build_object('claimed', false, 'reason', 'released expired claim: not ready',
                                'released', true, 'status', v_prior);
    end if;
    return jsonb_build_object('claimed', false, 'reason', 'not ready');
  end if;

  if gc.status = 'locked' and not v_has_result then
    v_prior := 'locked';
  elsif gc.status in ('settled','void') and v_dirty then
    v_prior := gc.status;
  elsif v_expired then
    -- Reclaiming an abandoned claim: keep whatever status it must be restored to.
    v_prior := coalesce(gc.claim_prior_status, 'locked');
  else
    return jsonb_build_object('claimed', false, 'reason',
      case when gc.status = 'settling' then 'already settling' else 'nothing to settle' end);
  end if;

  -- The cause finalize will record. A first settle is 'initial' whatever churn the contest saw
  -- while it was still open; only a contest that already has a result can be re-settled.
  v_cause := case when v_has_result then coalesce(gc.pending_cause, 'result_revision')
                  else 'initial' end;

  v_token := gen_random_uuid();
  update cashford.gameweek_contests
     set status = 'settling', claim_token = v_token, claim_started_at = now(),
         claim_input_version = gc.input_version, claim_prior_status = v_prior
   where id = p_contest_id;

  insert into cashford.gameweek_audit_log
    (gameweek_contest_id, action, cause, input_version, detail)
  values (p_contest_id, 'claim', v_cause, gc.input_version,
          jsonb_build_object('prior_status', v_prior, 'locked_in', v_locked_in,
                             'reclaimed', v_expired));

  -- The canonical input snapshot: locked-in entries with their picks, the effective fixture
  -- results per §0b, and the stake. Deterministically ordered.
  select coalesce(jsonb_agg(x order by x->>'user_id'), '[]'::jsonb) into v_entries
    from (
      select jsonb_build_object(
               'entry_id', e.id, 'user_id', e.user_id,
               'picks', coalesce((
                 select jsonb_agg(jsonb_build_object('fixture_id', p.fixture_id,
                                                     'pred_home', p.pred_home,
                                                     'pred_away', p.pred_away)
                                  order by p.fixture_id)
                   from cashford.gameweek_picks p where p.entry_id = e.id
               ), '[]'::jsonb)) as x
        from cashford.gameweek_entries e
       where e.gameweek_contest_id = p_contest_id and e.status = 'locked_in'
    ) s;

  select coalesce(jsonb_agg(x order by x->>'fixture_id'), '[]'::jsonb) into v_results
    from (
      select case when ef.eff_state = 'active'
                  then jsonb_build_object('fixture_id', ef.fixture_id, 'state', 'final',
                                          'home', f.ft_home, 'away', f.ft_away)
                  else jsonb_build_object('fixture_id', ef.fixture_id, 'state', 'void')
             end as x
        from cashford.gameweek_effective_fixtures(v_gw_id) ef
        join cashford.fixtures f on f.id = ef.fixture_id
    ) s;

  return jsonb_build_object(
    'claimed', true, 'token', v_token, 'version', gc.input_version,
    'gameweek_contest_id', p_contest_id, 'league_id', gc.league_id, 'gameweek_id', v_gw_id,
    'stake_inr', gc.stake_inr, 'prior_status', v_prior, 'cause', v_cause,
    'entries', v_entries, 'results', v_results);
end;
$$;

-- Token-conditioned release for a compute failure. Crash recovery is the expired-claim scan.
create or replace function cashford.abort_gameweek_settlement(p_contest_id uuid, p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare gc record;
begin
  perform cashford.lock_gameweeks(
    array[(select gameweek_id from cashford.gameweek_contests where id = p_contest_id)]);
  select * into gc from cashford.gameweek_contests where id = p_contest_id for update;
  if not found then return jsonb_build_object('released', false, 'reason', 'unknown contest'); end if;
  if gc.status <> 'settling' or gc.claim_token is distinct from p_token then
    return jsonb_build_object('released', false, 'reason', 'stale token');
  end if;

  update cashford.gameweek_contests
     set status = coalesce(claim_prior_status, 'locked'),
         claim_token = null, claim_started_at = null, claim_input_version = null,
         claim_prior_status = null
   where id = p_contest_id;

  insert into cashford.gameweek_audit_log
    (gameweek_contest_id, action, cause, input_version, detail)
  values (p_contest_id, 'abort', gc.pending_cause, gc.claim_input_version,
          jsonb_build_object('restored_status', coalesce(gc.claim_prior_status, 'locked')));

  return jsonb_build_object('released', true,
                            'status', coalesce(gc.claim_prior_status, 'locked'));
end;
$$;

-- Writes ONLY when the claim is still ours AND the input has not moved. Never RAISEs after
-- changing state: an exception would roll the release back.
create or replace function cashford.finalize_gameweek_settlement(
  p_contest_id uuid,
  p_token      uuid,
  p_version    int,
  p_outcome    jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  gc            record;
  v_kind        text;
  v_cause       text;
  v_had_result  boolean;
  v_locked_in   int;
  v_entry_rows  int;
  v_distinct    int;
  v_winners     int;
  v_losers      int;
  v_stake       int;
  v_bad         text;
  v_reversed    int;
  v_inserted    int;
begin
  perform cashford.lock_gameweeks(
    array[(select gameweek_id from cashford.gameweek_contests where id = p_contest_id)]);
  select * into gc from cashford.gameweek_contests where id = p_contest_id for update;
  if not found then
    return jsonb_build_object('result', 'stale', 'reason', 'unknown contest');
  end if;

  -- Old or unknown token: change NOTHING.
  if gc.status <> 'settling' or gc.claim_token is null or gc.claim_token <> p_token then
    return jsonb_build_object('result', 'stale', 'reason', 'not the current claim');
  end if;

  -- Same token, but the input moved while we computed: release the claim, restore the status
  -- the claim found, and tell the worker to retry. Return, never raise.
  if p_version is distinct from gc.claim_input_version
     or p_version is distinct from gc.input_version then
    update cashford.gameweek_contests
       set status = coalesce(claim_prior_status, 'locked'),
           claim_token = null, claim_started_at = null, claim_input_version = null,
           claim_prior_status = null
     where id = p_contest_id;

    insert into cashford.gameweek_audit_log
      (gameweek_contest_id, action, cause, input_version, detail)
    values (p_contest_id, 'release', gc.pending_cause, gc.input_version,
            jsonb_build_object('claimed_version', gc.claim_input_version,
                               'offered_version', p_version,
                               'current_version', gc.input_version,
                               'restored_status', coalesce(gc.claim_prior_status, 'locked')));

    return jsonb_build_object('result', 'retry', 'reason', 'input changed while computing',
                              'current_version', gc.input_version);
  end if;

  v_kind := p_outcome->>'kind';
  if v_kind not in ('settled','void') then
    raise exception 'finalize: unknown outcome kind %', coalesce(v_kind, 'null');
  end if;

  v_stake := gc.stake_inr;
  v_had_result := exists (select 1 from cashford.gameweek_results
                           where gameweek_contest_id = p_contest_id);
  -- A first settle is 'initial'; a re-settle carries whatever dirtied it.
  v_cause := case when v_had_result then coalesce(gc.pending_cause, 'result_revision')
                  else 'initial' end;

  select count(*) into v_locked_in from cashford.gameweek_entries
   where gameweek_contest_id = p_contest_id and status = 'locked_in';

  -- M5: money history is never deleted. Prior transfers are reversed, and the new version's
  -- rows are inserted alongside them. Dues reads non-reversed rows only.
  update cashford.transfers set reversed = true
   where gameweek_contest_id = p_contest_id and reversed = false;
  get diagnostics v_reversed = row_count;

  if v_kind = 'void' then
    -- The per-entry snapshot is replaceable state, not history: a settled→void correction
    -- deletes it. Transfers and audit rows are what "never delete" protects.
    delete from cashford.gameweek_entry_results where gameweek_contest_id = p_contest_id;

    insert into cashford.gameweek_results
      (gameweek_contest_id, outcome, void_reason, tiebreak_used, pot_inr,
       settled_version, last_settle_cause, settled_at)
    values (p_contest_id, 'void', p_outcome->>'reason', null, 0,
            p_version, v_cause, now())
    on conflict (gameweek_contest_id) do update
      set outcome = 'void', void_reason = excluded.void_reason, tiebreak_used = null,
          pot_inr = 0, settled_version = excluded.settled_version,
          last_settle_cause = excluded.last_settle_cause, settled_at = now();

    update cashford.gameweek_contests
       set status = 'void', settled_at = now(), pending_cause = null,
           claim_token = null, claim_started_at = null, claim_input_version = null,
           claim_prior_status = null
     where id = p_contest_id;

    insert into cashford.gameweek_audit_log
      (gameweek_contest_id, action, cause, input_version, detail)
    values (p_contest_id, 'void', v_cause, p_version,
            jsonb_build_object('reason', p_outcome->>'reason',
                               'transfers_reversed', v_reversed,
                               'prior_status', gc.claim_prior_status));

    return jsonb_build_object('result', 'void', 'reason', p_outcome->>'reason',
                              'transfers_reversed', v_reversed);
  end if;

  -- ---- settled: validate the invariants the engine claims to have kept (M3) ----
  -- Both payload arrays are re-expanded per query for the plan-cache reason described in
  -- write_gameweek_entry.
  select count(*), count(*) filter (where o.is_winner), count(*) filter (where not o.is_winner),
         count(distinct o.user_id)
    into v_entry_rows, v_winners, v_losers, v_distinct
    from jsonb_to_recordset(p_outcome->'entries') as o(user_id uuid, is_winner boolean);

  -- Per-entry rows complete, distinct, and every one a locked-in entrant of THIS pot.
  if v_entry_rows <> v_locked_in or v_distinct <> v_locked_in then
    raise exception 'finalize: % result rows (% distinct) for % locked-in entries',
      v_entry_rows, v_distinct, v_locked_in;
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_outcome->'entries') as o(user_id uuid)
     where not exists (select 1 from cashford.gameweek_entries e
                        where e.gameweek_contest_id = p_contest_id
                          and e.user_id = o.user_id and e.status = 'locked_in')
  ) then
    raise exception 'finalize: a result row is not a locked-in entrant of this pot';
  end if;
  if v_winners < 1 then
    raise exception 'finalize: a settled outcome needs at least one winner';
  end if;
  if p_outcome->>'tiebreak_used' not in ('none','exacts','goalError','split') then
    raise exception 'finalize: bad tiebreak_used %', coalesce(p_outcome->>'tiebreak_used','null');
  end if;

  -- Every money invariant in one pass (M1/M3): positive amounts, losers pay and winners
  -- receive, each loser's outbound total is exactly the stake, the pot is stake × losers,
  -- Σnet = 0, and each stored net matches the transfers it came from.
  with o as (
    select * from jsonb_to_recordset(p_outcome->'entries')
                     as x(user_id uuid, net_inr int, is_winner boolean)
  ), t as (
    select * from jsonb_to_recordset(coalesce(p_outcome->'transfers', '[]'::jsonb))
                     as x(from_user_id uuid, to_user_id uuid, amount_inr int)
  )
  select string_agg(distinct msg, '; ') into v_bad from (
    select 'a transfer amount is not a positive whole number' as msg
      from t where t.amount_inr is null or t.amount_inr <= 0
    union all
    select 'a transfer comes from a non-loser' from t
     where not exists (select 1 from o where o.user_id = t.from_user_id and not o.is_winner)
    union all
    select 'a transfer goes to a non-winner' from t
     where not exists (select 1 from o where o.user_id = t.to_user_id and o.is_winner)
    union all
    select format('a loser pays %s, not the %s stake',
                  coalesce((select sum(t2.amount_inr) from t t2
                             where t2.from_user_id = o.user_id), 0), v_stake)
      from o where not o.is_winner
        and coalesce((select sum(t2.amount_inr) from t t2
                       where t2.from_user_id = o.user_id), 0) <> v_stake
    union all
    select format('transferred %s, expected %s',
                  (select coalesce(sum(amount_inr), 0) from t), v_stake::bigint * v_losers)
     where (select coalesce(sum(amount_inr), 0) from t) <> v_stake::bigint * v_losers
    union all
    select format('nets sum to %s, not 0', (select coalesce(sum(net_inr), 0) from o))
     where (select coalesce(sum(net_inr), 0) from o) <> 0
    union all
    select 'a stored net does not match its transfers' from o
     where o.net_inr <> coalesce((select sum(x.amount_inr) from t x
                                   where x.to_user_id = o.user_id), 0)
                      - coalesce((select sum(x.amount_inr) from t x
                                   where x.from_user_id = o.user_id), 0)
  ) bad;
  if v_bad is not null then
    raise exception 'finalize: %', v_bad;
  end if;

  -- The totals above are necessary but not sufficient: ₹98/₹1/₹1 to three winners sums to the
  -- stake and nets to zero while breaking M3's split. So derive the exact matrix here —
  -- winners ordered by user_id, floor(stake / winners) each, the leftover ₹1s to the first
  -- winners, zero rows dropped — and demand the payload equals it pair for pair.
  with o as (
    select * from jsonb_to_recordset(p_outcome->'entries')
                     as x(user_id uuid, is_winner boolean)
  ), w as (
    select user_id, (row_number() over (order by user_id) - 1)::int as idx
      from o where is_winner
  ), l as (
    select user_id from o where not is_winner
  ), expected as (
    select l.user_id as from_user_id, w.user_id as to_user_id,
           (v_stake / v_winners) + case when w.idx < v_stake % v_winners then 1 else 0 end
             as amount_inr
      from l cross join w
  ), exp_nz as (
    select * from expected where amount_inr > 0
  ), supplied as (
    select from_user_id, to_user_id, sum(amount_inr)::bigint as amount_inr, count(*)::int as n_rows
      from jsonb_to_recordset(coalesce(p_outcome->'transfers', '[]'::jsonb))
             as x(from_user_id uuid, to_user_id uuid, amount_inr int)
     group by 1, 2
  )
  select string_agg(distinct msg, '; ') into v_bad from (
    select format('%s duplicate transfer rows for one payer/payee pair',
                  (select count(*) from supplied where n_rows > 1)) as msg
     where exists (select 1 from supplied where n_rows > 1)
    union all
    select format('%s expected transfers are missing',
                  (select count(*) from exp_nz e
                    where not exists (select 1 from supplied s
                                       where s.from_user_id = e.from_user_id
                                         and s.to_user_id = e.to_user_id)))
     where exists (select 1 from exp_nz e
                    where not exists (select 1 from supplied s
                                       where s.from_user_id = e.from_user_id
                                         and s.to_user_id = e.to_user_id))
    union all
    select format('%s transfers are not in the expected split',
                  (select count(*) from supplied s
                    where not exists (select 1 from exp_nz e
                                       where e.from_user_id = s.from_user_id
                                         and e.to_user_id = s.to_user_id)))
     where exists (select 1 from supplied s
                    where not exists (select 1 from exp_nz e
                                       where e.from_user_id = s.from_user_id
                                         and e.to_user_id = s.to_user_id))
    union all
    select format('a transfer pays %s where the split expects %s', s.amount_inr, e.amount_inr)
      from supplied s join exp_nz e
        on e.from_user_id = s.from_user_id and e.to_user_id = s.to_user_id
     where s.amount_inr <> e.amount_inr
  ) bad;
  if v_bad is not null then
    raise exception 'finalize: %', v_bad;
  end if;

  -- M1: the gross pot is stake × entrants, derived here and never taken on trust — a worker
  -- regression that sends the right transfers with pot_inr: 1 must not reach the UI.
  if p_outcome ? 'pot_inr'
     and (p_outcome->>'pot_inr')::bigint is distinct from (v_stake::bigint * v_entry_rows) then
    raise exception 'finalize: pot_inr % but stake % × % entrants is %',
      p_outcome->>'pot_inr', v_stake, v_entry_rows, v_stake::bigint * v_entry_rows;
  end if;

  -- ---- write ----
  delete from cashford.gameweek_entry_results where gameweek_contest_id = p_contest_id;
  insert into cashford.gameweek_entry_results
    (entry_id, gameweek_contest_id, points, exacts, goal_error, net_inr, is_winner,
     per_fixture, settled_version, settled_at)
  select e.id, p_contest_id, o.points, o.exacts, o.goal_error, o.net_inr, o.is_winner,
         o.per_fixture, p_version, now()
    from jsonb_to_recordset(p_outcome->'entries')
           as o(user_id uuid, points int, exacts int, goal_error int,
                net_inr int, is_winner boolean, per_fixture jsonb)
    join cashford.gameweek_entries e
      on e.gameweek_contest_id = p_contest_id and e.user_id = o.user_id;

  insert into cashford.transfers
    (gameweek_contest_id, league_id, from_user_id, to_user_id, amount_inr)
  select p_contest_id, gc.league_id, t.from_user_id, t.to_user_id, t.amount_inr
    from jsonb_to_recordset(coalesce(p_outcome->'transfers', '[]'::jsonb))
           as t(from_user_id uuid, to_user_id uuid, amount_inr int);
  get diagnostics v_inserted = row_count;

  insert into cashford.gameweek_results
    (gameweek_contest_id, outcome, void_reason, tiebreak_used, pot_inr,
     settled_version, last_settle_cause, settled_at)
  values (p_contest_id, 'settled', null, p_outcome->>'tiebreak_used',
          coalesce((p_outcome->>'pot_inr')::int, v_stake * v_entry_rows),
          p_version, v_cause, now())
  on conflict (gameweek_contest_id) do update
    set outcome = 'settled', void_reason = null, tiebreak_used = excluded.tiebreak_used,
        pot_inr = excluded.pot_inr, settled_version = excluded.settled_version,
        last_settle_cause = excluded.last_settle_cause, settled_at = now();

  update cashford.gameweek_contests
     set status = 'settled', settled_at = now(), pending_cause = null,
         claim_token = null, claim_started_at = null, claim_input_version = null,
         claim_prior_status = null
   where id = p_contest_id;

  insert into cashford.gameweek_audit_log
    (gameweek_contest_id, action, cause, input_version, detail)
  values (p_contest_id, 'settle', v_cause, p_version,
          jsonb_build_object('winners', v_winners, 'losers', v_losers,
                             'transfers_inserted', v_inserted,
                             'transfers_reversed', v_reversed,
                             'tiebreak_used', p_outcome->>'tiebreak_used',
                             'prior_status', gc.claim_prior_status,
                             'diagnostics', p_outcome->'diagnostics'));

  return jsonb_build_object('result', 'settled', 'winners', v_winners, 'losers', v_losers,
                            'transfers_inserted', v_inserted,
                            'transfers_reversed', v_reversed, 'cause', v_cause);
end;
$$;

-- ============================================================
-- 18b. Dispatcher scan (§0.6). The worker cannot do this filtering in the client: a LIMIT
--      applied before the predicates lets clean rows crowd out the one contest that needs
--      work, and two columns on two tables cannot be compared in a PostgREST filter at all.
--      Every predicate the claim routine re-checks under its locks is applied here first, so
--      the limit only ever discards real candidates.
--
--      PROGRESS INVARIANT. Filtering before the limit is not enough on its own. A corrupt row
--      (settled/void with no result row) cannot be repaired by the worker — the claim routine
--      only files a sync_issue — so it stays a candidate for as long as the bad data exists.
--      With enough of them they fill the limit on every pass and a real expired claim or a
--      dirty pot never gets dispatched: money stays wrong indefinitely. Two changes bound it:
--        * a corrupt row drops out of the queue once its unresolved sync_issue exists, which is
--          after its FIRST dispatch, so it consumes the queue once and not forever; and
--        * corrupt ranks LAST, below every money-bearing reason, so even a corrupt row that has
--          not been filed yet cannot displace work that moves rupees.
--      Together: every actionable contest is reached within ceil(unfiled_corrupt / limit) + 1
--      passes, and one tick's worth of corrupt rows is the whole of it.
--
--      'expired' is the other reason the worker cannot always clear, and it ranks FIRST, so the
--      same trap applies with nothing below it to protect: 40 expired claims on 0/1-entrant pots
--      used to be refused rather than released and came back at rank 0 on every pass. The rule
--      is now that a refusal can never leave a row in 'settling' — see the release-or-reclaim
--      rule in section 18 — so each expired row is claimed or released on FIRST contact and
--      leaves this queue. Bound: every actionable contest is reached within
--      ceil((unfiled_corrupt + stuck_expired) / limit) + 1 passes.
-- ============================================================

-- Supports both the not-exists test below and the claim routine's file-once check.
create index if not exists idx_sync_issues_open_ref
  on cashford.sync_issues (kind, ref) where resolved_at is null;

create or replace function cashford.gameweek_settlement_candidates(p_limit int default 40)
returns table (gameweek_contest_id uuid, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select gc.id, gc.gameweek_id, gc.status, gc.input_version, gc.deadline_at,
           gc.claim_started_at, gr.gameweek_contest_id is not null as has_result,
           gr.settled_version
      from cashford.gameweek_contests gc
      left join cashford.gameweek_results gr on gr.gameweek_contest_id = gc.id
     where gc.status in ('locked','settling','settled','void')
  ), scored as (
    select c.id, c.gameweek_id, c.deadline_at,
           case
             -- Same test as the claim routine, including the missing-stamp case: the two must
             -- agree or a row this scan calls expired is one the claim routine refuses, which
             -- puts it back here next pass and forever after.
             when c.status = 'settling'
              and (c.claim_started_at is null
                   or c.claim_started_at < now() - interval '10 minutes')  then 'expired'
             when c.status in ('settled','void') and not c.has_result   then 'corrupt'
             when c.status in ('settled','void') and c.has_result
              and c.input_version > c.settled_version                   then 'dirty'
             when c.status = 'locked' and not c.has_result              then 'ready'
           end as reason
      from c
  ), gated as (
    select s.id, s.deadline_at, s.reason
      from scored s
     where s.reason is not null
       -- A corrupt row is only worth dispatching while its finding is still unfiled: the worker
       -- cannot repair it, so a second dispatch would do nothing but re-read it. Dropping it
       -- here is what stops a pile of corrupt rows from owning the queue forever.
       and (s.reason <> 'corrupt'
            or not exists (
              select 1 from cashford.sync_issues si
               where si.source = 'gameweek' and si.kind = 'missing-result-row'
                 and si.ref = s.id::text and si.resolved_at is null))
       -- 'corrupt' needs no readiness test (the claim routine files the sync_issue), and an
       -- 'expired' claim must be reported even when the data is no longer ready — that is the
       -- only path that releases it.
       and (s.reason in ('corrupt','expired')
            or ((select count(*) from cashford.gameweek_entries e
                  where e.gameweek_contest_id = s.id and e.status = 'locked_in') >= 2
                and not exists (
                  select 1 from cashford.gameweek_effective_fixtures(s.gameweek_id) ef
                    join cashford.fixtures f on f.id = ef.fixture_id
                   where ef.eff_state = 'active'
                     and (f.status <> 'finished' or f.ft_home is null or f.ft_away is null))))
  )
  select g.id, g.reason
    from gated g
   -- Money first: an expired claim is a pot stuck mid-settlement, a dirty pot is wrong money on
   -- screen, a ready pot is unpaid money. A corrupt row only produces a diagnostic, so it goes
   -- last however old it is. Within a reason, oldest deadline first so nothing starves.
   order by case g.reason when 'expired' then 0 when 'dirty' then 1
                          when 'ready'   then 2 else 3 end,
            g.deadline_at, g.id
   limit greatest(coalesce(p_limit, 40), 1);
$$;

-- ============================================================
-- 18c. Leave and archive (L9 serialization).
--      Both writers take the SAME rows in the SAME order as enter/mirror, so an entry that has
--      already validated its eligibility cannot interleave with a leave or an archive. Neither
--      routine deletes anything: removal sets left_at, archive flips status.
--
--      league_members.left_at is Phase 5's column (§1.1 M2), landed here because the leave
--      routine has nowhere else to record a departure and deleting the row breaks the
--      member_competitions foreign key. Only the column and these two routines land now — the
--      my_league_ids() redefinition (M3), rejoin (M4) and the member-count changes stay in
--      Phase 5, and a null left_at means "current member", so every existing reader is unaffected.
-- ============================================================
alter table cashford.league_members add column if not exists left_at timestamptz;

create or replace function cashford.leave_league(p_league_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp   uuid;
  v_closed int;
  v_rows   int;
begin
  if p_league_id is null or p_user_id is null then
    raise exception 'leave_league: league and user are required';
  end if;

  -- Step 0. join_league locks this row first and then inserts league_members and
  -- member_competitions; leave writes those same rows. Meeting join here — before anything
  -- else — is what makes the two serialize instead of deadlocking.
  perform 1 from cashford.leagues where id = p_league_id for no key update;

  for v_comp in select competition_id from cashford.league_competitions
                 where league_id = p_league_id order by competition_id
  loop
    perform cashford.lock_competition_gate(v_comp);
  end loop;

  perform 1 from cashford.league_competitions
   where league_id = p_league_id order by competition_id for no key update;
  perform 1 from cashford.member_competitions
   where league_id = p_league_id and user_id = p_user_id
   order by competition_id for no key update;

  if not exists (select 1 from cashford.league_members
                  where league_id = p_league_id and user_id = p_user_id) then
    raise exception 'leave_league: not a member of this league';
  end if;

  update cashford.member_competitions set left_at = now()
   where league_id = p_league_id and user_id = p_user_id and left_at is null;
  get diagnostics v_closed = row_count;

  update cashford.league_members set left_at = now()
   where league_id = p_league_id and user_id = p_user_id and left_at is null;
  get diagnostics v_rows = row_count;

  return jsonb_build_object('left', true, 'already_left', v_rows = 0,
                            'competitions_closed', v_closed);
end;
$$;

create or replace function cashford.archive_league(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_comp     uuid;
  v_archived int;
begin
  if p_league_id is null then raise exception 'archive_league: league is required'; end if;

  -- Step 0, and it is also the row this routine updates last. Taking it up front (the same
  -- first row join_league takes) is the fix for the join/archive 40P01: previously archive held
  -- league_competitions and waited for join's leagues lock while join waited for a foreign-key
  -- lock on archive's league_competitions row.
  perform 1 from cashford.leagues where id = p_league_id for no key update;

  for v_comp in select competition_id from cashford.league_competitions
                 where league_id = p_league_id order by competition_id
  loop
    perform cashford.lock_competition_gate(v_comp);
  end loop;

  perform 1 from cashford.league_competitions
   where league_id = p_league_id order by competition_id for no key update;

  if not exists (select 1 from cashford.leagues where id = p_league_id) then
    raise exception 'archive_league: unknown league';
  end if;

  -- The competition row is what enter/mirror check, so it has to move with the league. Leaving
  -- it 'active' is what let members keep entering an archived league.
  update cashford.league_competitions set status = 'archived'
   where league_id = p_league_id and status = 'active';
  get diagnostics v_archived = row_count;

  update cashford.leagues set status = 'archived' where id = p_league_id;

  return jsonb_build_object('archived', true, 'competitions_archived', v_archived);
end;
$$;

-- ============================================================
-- 18d. join_league — REPLACED, lock strength only (§0.6).
--      Byte-for-byte the Phase 1 body except one word: the leagues row is taken FOR NO KEY
--      UPDATE instead of FOR UPDATE. No reordering, no new statement, no semantic change.
--
--      Why it has to change. A current member can call this again (the join screen detects an
--      existing membership and Phase 1 still invoked the routine), and then the
--      member_competitions insert lands on a row that already exists. A unique-index insert waits
--      for any transaction that has just written the matching row, so the repeated join parks
--      there — holding the leagues row. Meanwhile run_gameweek_maintenance, which resolved that
--      member's null eligibility boundary a moment earlier, goes on to provision the open
--      gameweek's pot; that insert's foreign key needs FOR KEY SHARE on the same leagues row, and
--      FOR UPDATE refuses it. Each side waits for the other: 40P01, with a member's eligibility
--      and a league's pot in the balance.
--
--      FOR NO KEY UPDATE still conflicts with FOR UPDATE and with itself, so join versus join and
--      join versus leave/archive serialize exactly as before (L9 unchanged, and the archived-league
--      check below still cannot race an archive). It only stops blocking foreign-key readers, which
--      is what takes maintenance out of the cycle. Replacing the routine here rather than editing
--      Phase 1 keeps the applied migration untouched; this file is the one that introduced the
--      writers it now has to coexist with.
-- ============================================================
create or replace function cashford.join_league(p_invite text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_inv    record;
  v_league record;
  v_comp   record;
  v_open   uuid;
begin
  if v_uid is null then raise exception 'join_league: not authenticated'; end if;
  if p_invite is null or btrim(p_invite) = '' then raise exception 'join_league: no invite'; end if;

  select * into v_inv from cashford.league_invites where token = p_invite;
  if not found then
    select * into v_inv from cashford.league_invites
     where short_code = upper(btrim(p_invite));
  end if;
  if not found then raise exception 'join_league: invite not found'; end if;
  if v_inv.revoked_at is not null then raise exception 'join_league: invite revoked'; end if;

  -- Step 0, at the strength the rest of this file uses. See the header note.
  select * into v_league from cashford.leagues where id = v_inv.league_id for no key update;
  if v_league.status = 'archived' then
    raise exception 'join_league: league is archived';
  end if;

  insert into cashford.league_members (league_id, user_id) values (v_league.id, v_uid)
  on conflict (league_id, user_id) do nothing;

  for v_comp in
    select lc.competition_id
      from cashford.league_competitions lc
      join cashford.competitions c on c.id = lc.competition_id
     where lc.league_id = v_league.id and lc.status = 'active' and c.format = 'league'
  loop
    -- Mid-season joiners enter from the gameweek that is open at join time; null while none is.
    -- Same reason as create_league for checking database time: a stale 'open' stamp during cron
    -- lag would make a joiner eligible for a gameweek whose deadline has already passed.
    select g.id into v_open from cashford.gameweeks g
     where g.competition_id = v_comp.competition_id and g.status = 'open'
       and g.deadline_at is not null and g.deadline_at > now();

    insert into cashford.member_competitions
      (league_id, user_id, competition_id, eligible_from_gameweek_id)
    values (v_league.id, v_uid, v_comp.competition_id, v_open)
    on conflict (league_id, user_id, competition_id) do nothing;
  end loop;

  return v_league.id;
end;
$$;

-- ============================================================
-- 19. Routine privileges
--     Postgres grants EXECUTE to PUBLIC on new functions and this schema's DEFAULT PRIVILEGES
--     grant everything to anon/authenticated, so every routine needs an explicit revoke.
-- ============================================================
revoke all on function cashford.lock_competition_gate(uuid)            from public, anon, authenticated;
revoke all on function cashford.lock_gameweeks(uuid[])                 from public, anon, authenticated;
revoke all on function cashford.gameweek_effective_fixtures(uuid)      from public, anon, authenticated;
revoke all on function cashford.bump_gameweek_input(uuid, text)        from public, anon, authenticated;
revoke all on function cashford.refresh_entry_completeness(uuid)       from public, anon, authenticated;
revoke all on function cashford.write_gameweek_entry(uuid, uuid, jsonb, boolean)
                                                                       from public, anon, authenticated;
revoke all on function cashford.gameweek_settlement_candidates(int)    from public, anon, authenticated;
revoke all on function cashford.leave_league(uuid, uuid)               from public, anon, authenticated;
revoke all on function cashford.archive_league(uuid)                   from public, anon, authenticated;
revoke all on function cashford.claim_gameweek_settlement(uuid)        from public, anon, authenticated;
revoke all on function cashford.release_expired_gameweek_claim(uuid, text)
                                                                       from public, anon, authenticated;
revoke all on function cashford.abort_gameweek_settlement(uuid, uuid)  from public, anon, authenticated;
revoke all on function cashford.finalize_gameweek_settlement(uuid, uuid, int, jsonb)
                                                                       from public, anon, authenticated;

grant execute on function cashford.lock_competition_gate(uuid)           to service_role;
grant execute on function cashford.lock_gameweeks(uuid[])                to service_role;
grant execute on function cashford.gameweek_effective_fixtures(uuid)     to service_role;
grant execute on function cashford.bump_gameweek_input(uuid, text)       to service_role;
grant execute on function cashford.refresh_entry_completeness(uuid)      to service_role;
grant execute on function cashford.gameweek_settlement_candidates(int)   to service_role;
grant execute on function cashford.leave_league(uuid, uuid)              to service_role;
grant execute on function cashford.archive_league(uuid)                  to service_role;
grant execute on function cashford.claim_gameweek_settlement(uuid)       to service_role;
grant execute on function cashford.release_expired_gameweek_claim(uuid, text) to service_role;
grant execute on function cashford.abort_gameweek_settlement(uuid, uuid) to service_role;
grant execute on function cashford.finalize_gameweek_settlement(uuid, uuid, int, jsonb)
                                                                         to service_role;

-- User-facing routines: authenticated only (SECURITY DEFINER supplies the privileges).
revoke all on function cashford.enter_gameweek(uuid, uuid, jsonb)         from public, anon;
revoke all on function cashford.update_gameweek_picks(uuid, uuid, jsonb)  from public, anon;
revoke all on function cashford.mirror_gameweek_entry(uuid, uuid, jsonb)  from public, anon;
-- Re-stated because 18d replaced the routine; CREATE OR REPLACE keeps the old ACL, so this only
-- makes the intended grant explicit in the file that now owns the body.
revoke all on function cashford.join_league(text)                         from public, anon;
grant execute on function cashford.join_league(text)                        to authenticated, service_role;
grant execute on function cashford.enter_gameweek(uuid, uuid, jsonb)        to authenticated, service_role;
grant execute on function cashford.update_gameweek_picks(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function cashford.mirror_gameweek_entry(uuid, uuid, jsonb) to authenticated, service_role;

commit;
