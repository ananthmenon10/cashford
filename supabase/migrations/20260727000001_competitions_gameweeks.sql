-- Cashford 2.0 — Phase 1: competitions, gameweeks, FPL ingest foundation.
-- Plan: docs/plans/2026-07-27-003-phase1-foundation-plan.md (v5)
--
-- Additive and idempotent-guarded: re-running the whole file is a no-op. One transaction.
-- The legacy per-fixture stack (contests / predictions / contest_results / settlement) becomes
-- CUP-FORMAT-ONLY and is never written for a league-format competition. That is enforced here as
-- a database invariant (trg_contests_cup_only), not just by application guards.
--
-- Premier League is seeded status='preparing': data may sync, but the competition is not
-- selectable for league creation and no pots provision until cashford.activate_competition()
-- runs as the final rollout step.

begin;

-- ============================================================
-- 1. competitions
-- ============================================================
create table if not exists cashford.competitions (
  id         uuid primary key default gen_random_uuid(),
  slug       text unique not null,
  name       text not null,
  format     text not null check (format in ('cup','league')),
  season     text not null,
  espn_slug  text,
  fpl_source boolean not null default false,
  status     text not null check (status in ('preparing','active','archived')),
  created_at timestamptz not null default now()
);

insert into cashford.competitions (slug, name, format, season, espn_slug, fpl_source, status)
values
  ('wc2026',     'World Cup 2026',      'cup',    '2026',    'fifa.world', false, 'archived'),
  ('pl-2026-27', 'Premier League 2026-27', 'league', '2026-27', 'eng.1',   true,  'preparing')
on conflict (slug) do nothing;

-- ============================================================
-- 2. gameweeks — SCHEDULE state only (league-money state lives on gameweek_contests)
-- ============================================================
create table if not exists cashford.gameweeks (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references cashford.competitions(id),
  number         int  not null,
  name           text not null,
  deadline_at    timestamptz,
  locked_at      timestamptz,
  status         text not null default 'upcoming'
                   check (status in ('upcoming','open','locked','completed')),
  fpl_event_id   int,
  unique (competition_id, number),
  unique (competition_id, fpl_event_id),
  unique (id, competition_id)          -- composite target for cross-competition FKs
);

-- At most ONE open gameweek per competition. Zero open is valid (season over, or the
-- competition is still preparing pre-GW1). Transitions happen in one transaction.
create unique index if not exists one_open_gw_per_competition
  on cashford.gameweeks (competition_id) where status = 'open';
create index if not exists idx_gameweeks_comp_status_deadline
  on cashford.gameweeks (competition_id, status, deadline_at);

-- ============================================================
-- 3. fixtures — competition tagging + FPL identity + score provenance
-- ============================================================
alter table cashford.fixtures
  add column if not exists competition_id uuid references cashford.competitions(id);

-- Every pre-existing fixture is World Cup 2026 (preflight asserts the id allowlist).
update cashford.fixtures
   set competition_id = (select id from cashford.competitions where slug = 'wc2026')
 where competition_id is null;

alter table cashford.fixtures alter column competition_id set not null;

alter table cashford.fixtures add column if not exists fpl_fixture_id    int;
alter table cashford.fixtures add column if not exists score_source      text;
alter table cashford.fixtures add column if not exists score_observed_at timestamptz;

do $$
begin
  -- composite-FK target: proves a gameweek membership and its fixture share a competition
  if not exists (select 1 from pg_constraint
                 where conname = 'fixtures_id_competition_key'
                   and conrelid = 'cashford.fixtures'::regclass) then
    alter table cashford.fixtures
      add constraint fixtures_id_competition_key unique (id, competition_id);
  end if;

  -- FPL ids are season/provider scoped, NOT globally unique
  if not exists (select 1 from pg_constraint
                 where conname = 'fixtures_competition_fpl_fixture_key'
                   and conrelid = 'cashford.fixtures'::regclass) then
    alter table cashford.fixtures
      add constraint fixtures_competition_fpl_fixture_key unique (competition_id, fpl_fixture_id);
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'chk_score_source'
                   and conrelid = 'cashford.fixtures'::regclass) then
    alter table cashford.fixtures
      add constraint chk_score_source check (score_source in ('espn','fpl'));
  end if;
end $$;

-- A league-format fixture may have no ESPN id (unmatched), no date (postponed/TBC) and never
-- has a cup `round`. The existing round CHECK still applies to non-null values.
alter table cashford.fixtures alter column external_id drop not null;
alter table cashford.fixtures alter column kickoff_at  drop not null;
alter table cashford.fixtures alter column round       drop not null;

-- Unmatched-ESPN worklist.
create index if not exists idx_fixtures_unmatched
  on cashford.fixtures (competition_id) where external_id is null;

-- ============================================================
-- 4. teams + team_provider_ids (CANONICAL provider identity, ESPN included)
-- ============================================================
alter table cashford.teams alter column external_id drop not null;

create table if not exists cashford.team_provider_ids (
  team_id      uuid not null references cashford.teams(id) on delete restrict,
  provider     text not null check (provider in ('fpl','espn','understat')),
  season       text not null,
  provider_key text not null,
  primary key (provider, season, provider_key),
  unique (team_id, provider, season)
);

-- Backfill an ESPN mapping for every team that already has one (WC teams, season '2026').
insert into cashford.team_provider_ids (team_id, provider, season, provider_key)
select t.id, 'espn', '2026', t.external_id::text
  from cashford.teams t
 where t.external_id is not null
on conflict do nothing;

-- ============================================================
-- 5. gameweek_fixtures — history-preserving membership
--    Every membership is its own row. A→B→A inserts a THIRD row; nothing mutates in place.
--      active   = counts for the gameweek (always is_current)
--      void     = was active, removed (postponement) — never is_current
--      excluded = FPL assigned it after the gameweek froze — is_current but never counts
-- ============================================================
create table if not exists cashford.gameweek_fixtures (
  id             uuid primary key default gen_random_uuid(),
  gameweek_id    uuid not null,
  fixture_id     uuid not null,
  competition_id uuid not null,
  state          text not null default 'active' check (state in ('active','void','excluded')),
  is_current     boolean not null default true,   -- the fixture's CURRENT FPL assignment
  added_at       timestamptz not null default now(),
  voided_at      timestamptz,
  void_reason    text,
  foreign key (gameweek_id, competition_id)
    references cashford.gameweeks (id, competition_id),
  foreign key (fixture_id, competition_id)
    references cashford.fixtures (id, competition_id),
  unique (id, fixture_id)   -- composite target: fixture_moves rows reference THIS fixture
);

create unique index if not exists one_active_gw_per_fixture
  on cashford.gameweek_fixtures (fixture_id) where state = 'active';
create unique index if not exists one_current_gw_per_fixture
  on cashford.gameweek_fixtures (fixture_id) where is_current;
create index if not exists idx_gameweek_fixtures_gw_active
  on cashford.gameweek_fixtures (gameweek_id) where state = 'active';

-- ============================================================
-- 6. league_competitions
-- ============================================================
create table if not exists cashford.league_competitions (
  league_id                 uuid not null references cashford.leagues(id) on delete restrict,
  competition_id            uuid not null references cashford.competitions(id),
  status                    text not null check (status in ('active','archived')),
  joined_at                 timestamptz not null default now(),
  eligible_from_gameweek_id uuid,
  primary key (league_id, competition_id),
  foreign key (eligible_from_gameweek_id, competition_id)
    references cashford.gameweeks (id, competition_id)
);

create unique index if not exists one_active_competition_per_league
  on cashford.league_competitions (league_id) where status = 'active';
create index if not exists idx_league_competitions_active
  on cashford.league_competitions (competition_id) where status = 'active';

-- Every existing league played the World Cup; that competition is now archived.
insert into cashford.league_competitions (league_id, competition_id, status)
select l.id, (select id from cashford.competitions where slug = 'wc2026'), 'archived'
  from cashford.leagues l
on conflict do nothing;

-- ============================================================
-- 7. gameweek_contests — the per-league pot. Provisioned only when its gameweek OPENS.
-- ============================================================
create table if not exists cashford.gameweek_contests (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references cashford.leagues(id) on delete restrict,
  gameweek_id    uuid not null,
  competition_id uuid not null,
  stake_inr      int  not null check (stake_inr > 0),
  deadline_at    timestamptz not null,   -- snapshot at creation (§1.2 keeps it in sync pre-freeze)
  status         text not null default 'open'
                   check (status in ('open','locked','settling','settled','void')),
  created_at     timestamptz not null default now(),
  settled_at     timestamptz,
  unique (league_id, gameweek_id),
  foreign key (gameweek_id, competition_id)
    references cashford.gameweeks (id, competition_id),
  foreign key (league_id, competition_id)
    references cashford.league_competitions (league_id, competition_id)
);

create index if not exists idx_gameweek_contests_gw on cashford.gameweek_contests (gameweek_id);

-- ============================================================
-- 8. member_competitions — per-member "before your time" boundary
--    eligible_from_gameweek_id NULL = eligible from whenever the next gameweek opens
--    (valid while the competition has zero open gameweeks; backfilled by maintenance).
-- ============================================================
create table if not exists cashford.member_competitions (
  league_id                 uuid not null,
  user_id                   uuid not null,
  competition_id            uuid not null,
  eligible_from_gameweek_id uuid,
  active_from               timestamptz not null default now(),
  left_at                   timestamptz,
  primary key (league_id, user_id, competition_id),
  foreign key (league_id, user_id)
    references cashford.league_members (league_id, user_id),
  foreign key (eligible_from_gameweek_id, competition_id)
    references cashford.gameweeks (id, competition_id),
  foreign key (league_id, competition_id)
    references cashford.league_competitions (league_id, competition_id)
);

-- ============================================================
-- 9. Ops tables
-- ============================================================

-- Cadence gate AND single-flight lock in one row. See claim/renew/release routines below.
create table if not exists cashford.sync_state (
  key         text primary key,
  last_run_at timestamptz,
  next_due_at timestamptz not null,
  lease_until timestamptz,
  lease_token uuid
);

-- Sync starts OFF; §7.6 (activate_competition + next_due_at = now()) turns it on.
insert into cashford.sync_state (key, next_due_at) values ('fpl-sync', 'infinity')
on conflict (key) do nothing;

create table if not exists cashford.fixture_moves (
  id                uuid primary key default gen_random_uuid(),
  fixture_id        uuid not null references cashford.fixtures(id) on delete restrict,
  old_membership_id uuid,
  new_membership_id uuid,
  observed_at       timestamptz not null default now(),
  constraint chk_move_not_both_null
    check (old_membership_id is not null or new_membership_id is not null),
  foreign key (old_membership_id, fixture_id)
    references cashford.gameweek_fixtures (id, fixture_id),
  foreign key (new_membership_id, fixture_id)
    references cashford.gameweek_fixtures (id, fixture_id),
  -- NULLS NOT DISTINCT is required: plain unique treats nulls as distinct and would not
  -- dedupe null→GW (initial assignment) or GW→null (unassignment) observations.
  unique nulls not distinct (old_membership_id, new_membership_id)
);
create index if not exists idx_fixture_moves_fixture on cashford.fixture_moves (fixture_id);

create table if not exists cashford.sync_issues (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  kind        text not null,
  ref         text,
  detail      jsonb,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_sync_issues_open
  on cashford.sync_issues (created_at) where resolved_at is null;

create table if not exists cashford.result_revisions (
  id          uuid primary key default gen_random_uuid(),
  fixture_id  uuid not null references cashford.fixtures(id) on delete restrict,
  old_home    int,
  old_away    int,
  new_home    int,
  new_away    int,
  source      text not null,
  observed_at timestamptz not null default now()
);
create index if not exists idx_result_revisions_fixture on cashford.result_revisions (fixture_id);

-- ============================================================
-- 10. Legacy isolation — the "never written for league format" invariant
-- ============================================================

-- Scope the existing fixture→contest sync trigger to cup competitions. Premier League
-- kickoff/status churn must never touch a legacy contest.
create or replace function cashford.sync_contest_on_fixture_change()
returns trigger
language plpgsql
set search_path = cashford
as $$
begin
  if not exists (
    select 1 from cashford.competitions c
     where c.id = new.competition_id and c.format = 'cup'
  ) then
    return new;
  end if;

  if new.kickoff_at is distinct from old.kickoff_at
     or new.status is distinct from old.status then

    update cashford.contests
       set lock_at = new.kickoff_at
     where fixture_id = new.id and status = 'open';

    if new.status in ('postponed','cancelled','abandoned') then
      update cashford.contests
         set status = 'cancelled', void_reason = 'match_' || new.status
       where fixture_id = new.id and status in ('open','locked');

    elsif new.status = 'scheduled'
          and new.kickoff_at > now() then
      update cashford.contests
         set status = 'open', lock_at = new.kickoff_at
       where fixture_id = new.id and status = 'locked';
    end if;
  end if;
  return new;
end;
$$;

-- DB invariant: a contest may only ever exist for a cup-format fixture.
create or replace function cashford.enforce_contests_cup_only()
returns trigger
language plpgsql
set search_path = cashford
as $$
begin
  if not exists (
    select 1 from cashford.fixtures f
      join cashford.competitions c on c.id = f.competition_id
     where f.id = new.fixture_id and c.format = 'cup'
  ) then
    raise exception 'contests are cup-format only (fixture % is not in a cup competition)',
      new.fixture_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contests_cup_only on cashford.contests;
create trigger trg_contests_cup_only
  before insert or update on cashford.contests
  for each row execute function cashford.enforce_contests_cup_only();

-- ============================================================
-- 11. Row Level Security — reads only; every write is service-role.
-- ============================================================
alter table cashford.competitions       enable row level security;
alter table cashford.gameweeks          enable row level security;
alter table cashford.gameweek_fixtures  enable row level security;
alter table cashford.gameweek_contests  enable row level security;
alter table cashford.league_competitions enable row level security;
alter table cashford.member_competitions enable row level security;
alter table cashford.team_provider_ids  enable row level security;
alter table cashford.sync_state         enable row level security;
alter table cashford.sync_issues        enable row level security;
alter table cashford.fixture_moves      enable row level security;
alter table cashford.result_revisions   enable row level security;

drop policy if exists competitions_select on cashford.competitions;
create policy competitions_select on cashford.competitions
  for select to authenticated using (true);

drop policy if exists gameweeks_select on cashford.gameweeks;
create policy gameweeks_select on cashford.gameweeks
  for select to authenticated using (true);

drop policy if exists gameweek_fixtures_select on cashford.gameweek_fixtures;
create policy gameweek_fixtures_select on cashford.gameweek_fixtures
  for select to authenticated using (true);

drop policy if exists gameweek_contests_select on cashford.gameweek_contests;
create policy gameweek_contests_select on cashford.gameweek_contests
  for select to authenticated
  using (league_id in (select cashford.my_league_ids()));

drop policy if exists league_competitions_select on cashford.league_competitions;
create policy league_competitions_select on cashford.league_competitions
  for select to authenticated
  using (league_id in (select cashford.my_league_ids()));

drop policy if exists member_competitions_select on cashford.member_competitions;
create policy member_competitions_select on cashford.member_competitions
  for select to authenticated
  using (league_id in (select cashford.my_league_ids()));

-- team_provider_ids, sync_state, sync_issues, fixture_moves, result_revisions:
-- RLS enabled with NO policies → deny-all to anon/authenticated; service_role bypasses.

-- ============================================================
-- 12. Database routines
--     Transaction boundaries need a real mechanism — a chain of Supabase client calls is
--     not a transaction. Every multi-write invariant in the plan lives in one of these.
-- ============================================================

-- ---- sync lease (§1.9): claim is BOTH the cadence gate and the single-flight lock ----

create or replace function cashford.claim_sync_lease(p_key text, p_ttl interval default interval '5 minutes')
returns uuid
language sql
security definer
set search_path = ''
as $$
  update cashford.sync_state
     set lease_until = now() + p_ttl,
         lease_token = gen_random_uuid()
   where key = p_key
     and next_due_at <= now()
     and (lease_until is null or lease_until < now())
  returning lease_token;
$$;

create or replace function cashford.renew_sync_lease(p_key text, p_token uuid,
                                                    p_ttl interval default interval '5 minutes')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_ok int;
begin
  update cashford.sync_state
     set lease_until = now() + p_ttl
   where key = p_key and lease_token = p_token and lease_until > now();
  get diagnostics v_ok = row_count;
  return v_ok = 1;   -- false ⇒ the lease was lost: the holder must abort without writing
end;
$$;

create or replace function cashford.release_sync_lease(p_key text, p_token uuid, p_next_due timestamptz)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_ok int;
begin
  -- Token-conditioned: a stale holder can never move next_due_at or clear a new holder's lease.
  update cashford.sync_state
     set last_run_at = now(), next_due_at = p_next_due,
         lease_until = null, lease_token = null
   where key = p_key and lease_token = p_token;
  get diagnostics v_ok = row_count;
  return v_ok = 1;
end;
$$;

-- ---- score writes (§2 predicates + §1.9 revision / settled-contest rules, atomically) ----

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
  fx               record;
  v_has_score      boolean;
  v_score_changed  boolean;
  v_status         text;
  v_status_rejected boolean := false;
begin
  if p_source not in ('espn','fpl') then
    raise exception 'apply_score_update: unknown source %', p_source;
  end if;

  -- Lock the fixture AND its legacy contests: orders this call against a concurrent
  -- settlement claim (locked → settling).
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

  -- §1.9 Phase 1 scope limit: a settled cup contest is never regraded here, and updating the
  -- score without regrading would make the displayed result and the money disagree.
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

  return jsonb_build_object('applied', true, 'score_changed', v_score_changed,
                            'status', v_status, 'status_rejected', v_status_rejected);
end;
$$;

-- ---- gameweek schedule maintenance (§1.2 / §4.4 / §4.5) ----
-- complete → lock → open (one-open invariant holds because demotions run first) → eligibility
-- backfill → pot provisioning. Idempotent; safe to run every tick.

create or replace function cashford.run_gameweek_maintenance(p_competition_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status     text;
  v_open       uuid;
  v_completed  int := 0;
  v_locked     int := 0;
  v_pots       int := 0;
  v_pots_shut  int := 0;
begin
  select status into v_status from cashford.competitions where id = p_competition_id;
  if v_status is null then
    raise exception 'run_gameweek_maintenance: unknown competition %', p_competition_id;
  end if;

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
  end if;

  return jsonb_build_object('open_gameweek_id', v_open, 'completed', v_completed,
                            'locked', v_locked, 'pots_provisioned', v_pots,
                            'pots_locked', v_pots_shut);
end;
$$;

-- ---- FPL reconciliation (§4.3) — EXACTLY ONE call per sync run, never batched ----
-- A partial batch would leave partial reconciliation if a later batch failed.
--
-- snapshot shape (already validated + team-resolved by lib/sync-fpl.ts):
-- {
--   "competition_slug": "pl-2026-27",
--   "gameweeks": [ { "fpl_event_id":1, "number":1, "name":"Gameweek 1",
--                    "deadline_at":"2026-08-14T17:30:00Z" } ],
--   "fixtures":  [ { "fpl_fixture_id":1, "fpl_event_id":1|null, "kickoff_at":"…"|null,
--                    "home_team_id":"uuid", "away_team_id":"uuid",
--                    "finished":true|false, "home_score":int|null, "away_score":int|null } ]
-- }

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
      else
        update cashford.gameweek_fixtures set is_current = false where id = r.cur_id;
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
      end if;
    end if;

    insert into cashford.fixture_moves (fixture_id, old_membership_id, new_membership_id)
    values (r.fixture_id, r.cur_id, v_new_id)
    on conflict do nothing;
    v_moves := v_moves + 1;
  end loop;

  -- 5. FPL score fallback, through the same predicates as every other score write.
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
    'scores_applied', v_scores
  );
end;
$$;

-- ---- competition activation (§7.6) — never a bare status UPDATE ----
-- Maintenance runs first so an open gameweek exists before leagues can be created against the
-- competition; it runs again after the flip because provisioning only happens once active.

create or replace function cashford.activate_competition(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid; v_result jsonb;
begin
  select id into v_id from cashford.competitions where slug = p_slug for update;
  if v_id is null then
    raise exception 'activate_competition: unknown competition %', p_slug;
  end if;

  perform cashford.run_gameweek_maintenance(v_id);
  update cashford.competitions set status = 'active' where id = v_id;
  v_result := cashford.run_gameweek_maintenance(v_id);

  return v_result || jsonb_build_object('slug', p_slug, 'status', 'active');
end;
$$;

-- ---- league create / join (§1.13) — one transaction each, auth.uid() read internally ----

create or replace function cashford.create_league(
  p_name            text,
  p_slug            text,
  p_stake           int,
  p_competition_slug text
)
returns table (league_id uuid, invite_token text, short_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_comp  record;
  v_league uuid;
  v_token text;
  v_code  text;
  v_open  uuid;
  v_try   int := 0;
  v_name  text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'create_league: not authenticated'; end if;
  if v_name = '' then raise exception 'League name is required.'; end if;
  if length(v_name) > 60 then raise exception 'League name must be 60 chars or fewer.'; end if;
  if p_stake is null or p_stake < 50 then raise exception 'Stake must be at least ₹50.'; end if;
  if p_stake > 1000000 then raise exception 'Stake is too high.'; end if;
  if p_slug is null or p_slug !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' or length(p_slug) < 3
     or length(p_slug) > 40 then
    raise exception 'Invalid league URL.';
  end if;
  -- authenticated can call this directly, so every check the action makes is repeated here.
  -- Keep this list in step with RESERVED_SLUGS in lib/validation.ts.
  if p_slug = any (array['new','create','settings','login','rules','api','j','join',
                         'change-password','leagues','signup']) then
    raise exception 'That URL is reserved — pick another.';
  end if;

  select * into v_comp from cashford.competitions where slug = p_competition_slug;
  if not found then
    raise exception 'create_league: unknown competition %', p_competition_slug;
  end if;
  -- 'preparing' and 'archived' are both rejected: a competition must be live to be joined.
  if v_comp.status <> 'active' then
    raise exception 'create_league: competition % is not active', p_competition_slug;
  end if;

  insert into cashford.leagues (name, slug, default_stake_inr, created_by)
  values (v_name, p_slug, p_stake, v_uid)
  returning id into v_league;

  insert into cashford.league_members (league_id, user_id) values (v_league, v_uid);

  -- Invite: opaque 48-hex-char token (192 bits, the same entropy as lib/invite.ts's 24 random
  -- bytes) + 8-char Crockford base32 short code (no I/L/O/U), same alphabet as lib/invite.ts.
  -- Retry on collision.
  loop
    v_try := v_try + 1;
    v_token := substr(replace(gen_random_uuid()::text, '-', '')
                      || replace(gen_random_uuid()::text, '-', ''), 1, 48);
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr('0123456789ABCDEFGHJKMNPQRSTVWXYZ',
                                 1 + floor(random() * 32)::int, 1);
    end loop;
    begin
      insert into cashford.league_invites (league_id, token, short_code, created_by)
      values (v_league, v_token, v_code, v_uid);
      exit;
    exception when unique_violation then
      if v_try >= 5 then raise; end if;
    end;
  end loop;

  -- 'open' alone is not enough: under cron lag a gameweek stays stamped open past its deadline,
  -- and provisioning an already-expired pot would take a stake nobody can still enter against.
  -- Database time decides. Null here is valid — it means "from whenever the next one opens".
  select g.id into v_open from cashford.gameweeks g
   where g.competition_id = v_comp.id and g.status = 'open'
     and g.deadline_at is not null and g.deadline_at > now();

  insert into cashford.league_competitions
    (league_id, competition_id, status, eligible_from_gameweek_id)
  values (v_league, v_comp.id, 'active', v_open);

  -- Eligibility boundaries are league-format semantics only.
  if v_comp.format = 'league' then
    insert into cashford.member_competitions
      (league_id, user_id, competition_id, eligible_from_gameweek_id)
    values (v_league, v_uid, v_comp.id, v_open);

    insert into cashford.gameweek_contests
      (league_id, gameweek_id, competition_id, stake_inr, deadline_at)
    select v_league, g.id, v_comp.id, p_stake, g.deadline_at
      from cashford.gameweeks g
     where g.id = v_open and g.deadline_at is not null;
  end if;

  return query select v_league, v_token, v_code;
end;
$$;

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

  select * into v_league from cashford.leagues where id = v_inv.league_id for update;
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
-- 13. Routine privileges
--     The schema's DEFAULT PRIVILEGES grant everything to anon/authenticated, and Postgres
--     grants EXECUTE to PUBLIC on new functions — so every routine here needs an explicit revoke.
-- ============================================================
revoke all on function cashford.claim_sync_lease(text, interval)          from public, anon, authenticated;
revoke all on function cashford.renew_sync_lease(text, uuid, interval)    from public, anon, authenticated;
revoke all on function cashford.release_sync_lease(text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function cashford.apply_score_update(uuid, int, int, text, text) from public, anon, authenticated;
revoke all on function cashford.run_gameweek_maintenance(uuid)            from public, anon, authenticated;
revoke all on function cashford.apply_fpl_reconciliation(jsonb)           from public, anon, authenticated;
revoke all on function cashford.activate_competition(text)                from public, anon, authenticated;

grant execute on function cashford.claim_sync_lease(text, interval)          to service_role;
grant execute on function cashford.renew_sync_lease(text, uuid, interval)    to service_role;
grant execute on function cashford.release_sync_lease(text, uuid, timestamptz) to service_role;
grant execute on function cashford.apply_score_update(uuid, int, int, text, text) to service_role;
grant execute on function cashford.run_gameweek_maintenance(uuid)            to service_role;
grant execute on function cashford.apply_fpl_reconciliation(jsonb)           to service_role;
grant execute on function cashford.activate_competition(text)                to service_role;

-- User-facing routines: authenticated only (SECURITY DEFINER supplies the privileges).
revoke all on function cashford.create_league(text, text, int, text) from public, anon;
revoke all on function cashford.join_league(text)                   from public, anon;
grant execute on function cashford.create_league(text, text, int, text) to authenticated, service_role;
grant execute on function cashford.join_league(text)                    to authenticated, service_role;

commit;
