-- Cashford — Knockout Circle: per-slot bracket predictions + per-user bracket header.
-- Plan: docs/plans/2026-07-01-001-feat-knockout-circle-radial-bracket-plan.md (Deepening §B).
-- Additive-only; safe on the shared DB. All objects in schema `cashford`.
--
-- Two tables:
--   knockout_predictions — one row per (user, tournament, slot_key); the user's picks
--     for circle slots (rings 1..5). Auto-locked (finished) games are NEVER written
--     here (the write RLS forbids post-kickoff writes), so every row is genuine skill.
--   knockout_brackets — one header row per (user, tournament); owns lock state + the
--     opaque public share_token + a denormalized champion/score snapshot for the OG card.

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists cashford.knockout_predictions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references cashford.profiles(id)  on delete cascade,
  tournament_id     text not null default 'wc2026',
  slot_key          text not null,
  fixture_id        uuid not null references cashford.fixtures(id)  on delete restrict,
  predicted_team_id uuid not null references cashford.teams(id)     on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_knockout_pred_user_slot unique (user_id, tournament_id, slot_key),
  constraint chk_knockout_slot_key check (slot_key ~ '^[1-5]:[0-9]{1,2}$'),
  constraint chk_knockout_tournament check (tournament_id <> '')
);

create table if not exists cashford.knockout_brackets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references cashford.profiles(id)  on delete cascade,
  tournament_id     text not null default 'wc2026',
  locked_at         timestamptz,                       -- null = unlocked (full-freeze marker)
  share_token       text unique,                       -- null until lock; opaque, unguessable
  champion_team_id  uuid references cashford.teams(id) on delete set null,
  correct_picks     smallint not null default 0,       -- denormalized snapshot @ lock
  total_decided     smallint not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_knockout_bracket_user unique (user_id, tournament_id),
  constraint chk_knockout_bracket_tournament check (tournament_id <> ''),
  -- DB backstop: a share token must be long enough to be unguessable (app mints
  -- randomBytes(24).base64url = 32 chars). Prevents a bug minting a short/enumerable id.
  constraint chk_share_token_len check (share_token is null or length(share_token) >= 32)
);

create index if not exists idx_knockout_pred_user       on cashford.knockout_predictions(user_id);
create index if not exists idx_knockout_pred_fixture    on cashford.knockout_predictions(fixture_id);
create index if not exists idx_knockout_pred_tour_fix   on cashford.knockout_predictions(tournament_id, fixture_id);

-- ============================================================
-- HELPER: is the current user's bracket for this tournament locked?
-- security definer so the write policies can consult it without RLS recursion.
-- ============================================================
create or replace function cashford.bracket_locked(p_tournament text)
returns boolean
language sql
security definer
stable
set search_path = cashford
as $$
  select exists (
    select 1 from cashford.knockout_brackets b
    where b.user_id = (select auth.uid())
      and b.tournament_id = p_tournament
      and b.locked_at is not null
  );
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Predicted team must be a participant of its fixture, once both teams are resolved.
-- (A CHECK can't reference another table; mirror trg_no_draw's trigger approach.)
create or replace function cashford.enforce_knockout_pick_participant()
returns trigger
language plpgsql
set search_path = cashford
as $$
declare
  v_home uuid;
  v_away uuid;
begin
  -- Only ring-1 (R32) slots pick among the fixture's actual entrants. For rings 2..5
  -- this is a FORWARD prediction: the user advances a team from THEIR bracket flow, which
  -- may legitimately differ from the fixture's eventual (real) participants — so we do NOT
  -- constrain it here (the FK still guarantees a real team; the client validates the tree).
  if new.slot_key ~ '^1:' then
    select home_team_id, away_team_id into v_home, v_away
      from cashford.fixtures where id = new.fixture_id;
    if v_home is not null and v_away is not null then
      if new.predicted_team_id <> v_home and new.predicted_team_id <> v_away then
        raise exception 'predicted_team_id % is not a participant of R32 fixture %',
          new.predicted_team_id, new.fixture_id;
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_knockout_pick_participant on cashford.knockout_predictions;
create trigger trg_knockout_pick_participant
  before insert or update on cashford.knockout_predictions
  for each row execute function cashford.enforce_knockout_pick_participant();

-- Identity columns are immutable after insert (re-pick = delete + insert, not mutate).
create or replace function cashford.enforce_knockout_pred_immutable()
returns trigger
language plpgsql
set search_path = cashford
as $$
begin
  if new.user_id <> old.user_id
     or new.tournament_id <> old.tournament_id
     or new.slot_key <> old.slot_key
     or new.fixture_id <> old.fixture_id then
    raise exception 'user_id, tournament_id, slot_key and fixture_id are immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_knockout_pred_immutable on cashford.knockout_predictions;
create trigger trg_knockout_pred_immutable
  before update on cashford.knockout_predictions
  for each row execute function cashford.enforce_knockout_pred_immutable();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table cashford.knockout_predictions enable row level security;
alter table cashford.knockout_brackets    enable row level security;

-- knockout_predictions -----------------------------------------------------------
-- SELECT: own rows always; a leaguemate's row only AFTER that slot's match kicks off
-- (no-peek), joining fixtures.kickoff_at (fixtures has no lock_at — that's on contests).
drop policy if exists knockout_pred_select on cashford.knockout_predictions;
create policy knockout_pred_select on cashford.knockout_predictions
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (
      exists (
        select 1 from cashford.league_members lm
        where lm.user_id = knockout_predictions.user_id
          and lm.league_id in (select cashford.my_league_ids())
      )
      and (
        select f.kickoff_at from cashford.fixtures f
        where f.id = knockout_predictions.fixture_id
      ) <= now() - interval '10 seconds'
    )
  );

-- INSERT: own row, password changed, bracket not locked, slot's match not yet kicked off.
drop policy if exists knockout_pred_insert on cashford.knockout_predictions;
create policy knockout_pred_insert on cashford.knockout_predictions
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and cashford.password_change_done()
    and exists (select 1 from cashford.league_members lm where lm.user_id = (select auth.uid()))
    and not cashford.bracket_locked(tournament_id)
    and (
      select f.kickoff_at from cashford.fixtures f
      where f.id = knockout_predictions.fixture_id
    ) > now() + interval '10 seconds'
  );

-- UPDATE: only own, unlocked, still-future rows; new value must satisfy the same.
drop policy if exists knockout_pred_update on cashford.knockout_predictions;
create policy knockout_pred_update on cashford.knockout_predictions
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from cashford.league_members lm where lm.user_id = (select auth.uid()))
    and not cashford.bracket_locked(tournament_id)
    and (
      select f.kickoff_at from cashford.fixtures f
      where f.id = knockout_predictions.fixture_id
    ) > now() + interval '10 seconds'
  )
  with check (
    user_id = (select auth.uid())
    and cashford.password_change_done()
    and exists (select 1 from cashford.league_members lm where lm.user_id = (select auth.uid()))
    and not cashford.bracket_locked(tournament_id)
    and (
      select f.kickoff_at from cashford.fixtures f
      where f.id = knockout_predictions.fixture_id
    ) > now() + interval '10 seconds'
  );

-- DELETE: own, unlocked, future slots only (re-pick downstream clear).
drop policy if exists knockout_pred_delete on cashford.knockout_predictions;
create policy knockout_pred_delete on cashford.knockout_predictions
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and exists (select 1 from cashford.league_members lm where lm.user_id = (select auth.uid()))
    and not cashford.bracket_locked(tournament_id)
    and (
      select f.kickoff_at from cashford.fixtures f
      where f.id = knockout_predictions.fixture_id
    ) > now() + interval '10 seconds'
  );

-- knockout_brackets --------------------------------------------------------------
-- SELECT: owner reads own header (lock state + share token). Public share page + OG
-- read locked brackets via the service-role client (bypasses RLS) — no anon policy.
drop policy if exists knockout_bracket_select_own on cashford.knockout_brackets;
create policy knockout_bracket_select_own on cashford.knockout_brackets
  for select to authenticated
  using (user_id = (select auth.uid()));
-- No insert/update/delete policies: the lock/unlock/share actions are service-role only.

-- ============================================================
-- REALTIME: never broadcast picks/brackets (Realtime bypasses read RLS).
-- ============================================================
do $$
begin
  if exists (select 1 from pg_publication_tables
             where pubname='supabase_realtime' and schemaname='cashford' and tablename='knockout_predictions') then
    execute 'alter publication supabase_realtime drop table cashford.knockout_predictions';
  end if;
  if exists (select 1 from pg_publication_tables
             where pubname='supabase_realtime' and schemaname='cashford' and tablename='knockout_brackets') then
    execute 'alter publication supabase_realtime drop table cashford.knockout_brackets';
  end if;
end;
$$;

-- ============================================================
-- GRANTS (belt-and-suspenders; matches the existing schema-wide grant pattern)
-- ============================================================
grant all on cashford.knockout_predictions to anon, authenticated, service_role;
grant all on cashford.knockout_brackets    to anon, authenticated, service_role;
