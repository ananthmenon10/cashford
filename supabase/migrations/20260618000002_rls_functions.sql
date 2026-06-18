-- Cashford — helper functions, triggers, and Row Level Security (plan §9 + §17.3/17.4)
-- All objects in the cashford schema.

-- ============================================================
-- HELPER FUNCTIONS (security definer; bypass RLS internally)
-- ============================================================

-- League IDs the current user belongs to. STABLE + security definer so the
-- planner runs it once per query and it doesn't recurse into league_members RLS.
create or replace function cashford.my_league_ids()
returns setof uuid
language sql
security definer
stable
set search_path = cashford
as $$
  select league_id from cashford.league_members where user_id = (select auth.uid());
$$;

-- True once the user has cleared the first-login password change.
-- The flag lives in auth.users.raw_user_meta_data.must_change_password.
create or replace function cashford.password_change_done()
returns boolean
language sql
security definer
stable
set search_path = cashford, auth
as $$
  select coalesce(
    (raw_user_meta_data ->> 'must_change_password') is distinct from 'true',
    true
  )
  from auth.users
  where id = (select auth.uid());
$$;

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Mirror a new auth user into profiles (username from signup metadata).
create or replace function cashford.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = cashford
as $$
begin
  insert into cashford.profiles (id, username, display_name, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'username'),
    coalesce((new.raw_user_meta_data ->> 'is_admin')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function cashford.handle_new_user();

-- Reject a 'draw' prediction on a knockout contest (DB-level guard, §17.5).
create or replace function cashford.enforce_knockout_no_draw()
returns trigger
language plpgsql
set search_path = cashford
as $$
begin
  if new.outcome = 'draw'
     and (select is_knockout from cashford.contests where id = new.contest_id) then
    raise exception 'Draw is not a valid outcome for a knockout contest';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_no_draw_knockout on cashford.predictions;
create trigger trg_no_draw_knockout
  before insert or update on cashford.predictions
  for each row execute function cashford.enforce_knockout_no_draw();

-- Keep contests in sync when a fixture's kickoff/status changes (§17.5).
create or replace function cashford.sync_contest_on_fixture_change()
returns trigger
language plpgsql
set search_path = cashford
as $$
begin
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

drop trigger if exists trg_fixture_change on cashford.fixtures;
create trigger trg_fixture_change
  after update on cashford.fixtures
  for each row execute function cashford.sync_contest_on_fixture_change();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table cashford.profiles          enable row level security;
alter table cashford.leagues           enable row level security;
alter table cashford.league_members    enable row level security;
alter table cashford.teams             enable row level security;
alter table cashford.fixtures          enable row level security;
alter table cashford.contests          enable row level security;
alter table cashford.predictions       enable row level security;
alter table cashford.contest_results   enable row level security;
alter table cashford.transfers         enable row level security;
alter table cashford.contest_audit_log enable row level security;

-- profiles: read self + co-league members; update own row, never escalate is_admin.
create policy profiles_select on cashford.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or id in (
      select lm.user_id from cashford.league_members lm
      where lm.league_id in (select cashford.my_league_ids())
    )
  );
create policy profiles_update_self on cashford.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and is_admin = (select p.is_admin from cashford.profiles p where p.id = (select auth.uid()))
  );

-- Reference data: read-only to all authenticated users.
create policy teams_select    on cashford.teams    for select to authenticated using (true);
create policy fixtures_select on cashford.fixtures for select to authenticated using (true);

-- League-scoped reads. No client writes (service role only).
create policy leagues_select on cashford.leagues for select to authenticated
  using (id in (select cashford.my_league_ids()));

create policy league_members_select on cashford.league_members for select to authenticated
  using (league_id in (select cashford.my_league_ids()));

create policy contests_select on cashford.contests for select to authenticated
  using (league_id in (select cashford.my_league_ids()));

create policy contest_results_select on cashford.contest_results for select to authenticated
  using (contest_id in (
    select id from cashford.contests where league_id in (select cashford.my_league_ids())
  ));

create policy transfers_select on cashford.transfers for select to authenticated
  using (league_id in (select cashford.my_league_ids()));

-- predictions: own row anytime; others' only after lock (10s skew margin).
create policy predictions_select on cashford.predictions for select to authenticated
  using (
    contest_id in (
      select id from cashford.contests where league_id in (select cashford.my_league_ids())
    )
    and (
      user_id = (select auth.uid())
      or (select c.lock_at from cashford.contests c where c.id = predictions.contest_id)
           <= now() - interval '10 seconds'
    )
  );

-- predictions write: own row, password changed, member of the contest's league,
-- and predictions close 10s early to kill the clock-skew exploit.
create policy predictions_insert on cashford.predictions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and cashford.password_change_done()
    and exists (
      select 1 from cashford.contests c
      join cashford.league_members lm on lm.league_id = c.league_id
      where c.id = contest_id
        and lm.user_id = (select auth.uid())
        and c.lock_at > now() + interval '10 seconds'
    )
  );

create policy predictions_update on cashford.predictions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and cashford.password_change_done()
    and exists (
      select 1 from cashford.contests c
      join cashford.league_members lm on lm.league_id = c.league_id
      where c.id = predictions.contest_id
        and lm.user_id = (select auth.uid())
        and c.lock_at > now() + interval '10 seconds'
    )
  );
-- (no delete policy → predictions are immutable once submitted)

-- contest_audit_log: RLS enabled, NO policies → deny all to authenticated.
--   Writes/reads happen via the service role only.

-- ============================================================
-- Explicit grants on the now-existing objects (belt-and-suspenders alongside
-- the default privileges set in 0001). RLS still restricts row access.
-- ============================================================
grant all on all tables    in schema cashford to anon, authenticated, service_role;
grant all on all sequences in schema cashford to anon, authenticated, service_role;
grant all on all routines  in schema cashford to anon, authenticated, service_role;

-- ============================================================
-- REALTIME SAFETY (§17.3): predictions must NEVER be broadcast to clients
-- before lock. Remove it from the realtime publication if present.
-- ============================================================
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'cashford'
      and tablename = 'predictions'
  ) then
    execute 'alter publication supabase_realtime drop table cashford.predictions';
  end if;
end;
$$;
