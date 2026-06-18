-- Cashford — helper functions, triggers, and Row Level Security (plan §9 + §17.3/17.4)

-- ============================================================
-- HELPER FUNCTIONS (security definer; bypass RLS internally)
-- ============================================================

-- League IDs the current user belongs to. STABLE + security definer so the
-- planner runs it once per query and it doesn't recurse into league_members RLS.
create or replace function public.my_league_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select league_id from public.league_members where user_id = (select auth.uid());
$$;

-- True once the user has cleared the first-login password change.
-- The flag lives in auth.users.raw_user_meta_data.must_change_password.
create or replace function public.password_change_done()
returns boolean
language sql
security definer
stable
set search_path = public, auth
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
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, is_admin)
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
  for each row execute function public.handle_new_user();

-- Reject a 'draw' prediction on a knockout contest (DB-level guard, §17.5).
create or replace function public.enforce_knockout_no_draw()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.outcome = 'draw'
     and (select is_knockout from public.contests where id = new.contest_id) then
    raise exception 'Draw is not a valid outcome for a knockout contest';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_no_draw_knockout on public.predictions;
create trigger trg_no_draw_knockout
  before insert or update on public.predictions
  for each row execute function public.enforce_knockout_no_draw();

-- Keep contests in sync when a fixture's kickoff/status changes (§17.5).
create or replace function public.sync_contest_on_fixture_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kickoff_at is distinct from old.kickoff_at
     or new.status is distinct from old.status then

    -- Recompute lock_at for still-open contests
    update public.contests
       set lock_at = new.kickoff_at - interval '30 minutes'
     where fixture_id = new.id and status = 'open';

    -- Match called off → cancel open/locked contests
    if new.status in ('postponed','cancelled','abandoned') then
      update public.contests
         set status = 'cancelled', void_reason = 'match_' || new.status
       where fixture_id = new.id and status in ('open','locked');

    -- Match rescheduled to the future → re-open a previously locked contest
    elsif new.status = 'scheduled'
          and new.kickoff_at - interval '30 minutes' > now() then
      update public.contests
         set status = 'open', lock_at = new.kickoff_at - interval '30 minutes'
       where fixture_id = new.id and status = 'locked';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fixture_change on public.fixtures;
create trigger trg_fixture_change
  after update on public.fixtures
  for each row execute function public.sync_contest_on_fixture_change();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles         enable row level security;
alter table public.leagues          enable row level security;
alter table public.league_members   enable row level security;
alter table public.teams            enable row level security;
alter table public.fixtures         enable row level security;
alter table public.contests         enable row level security;
alter table public.predictions      enable row level security;
alter table public.contest_results  enable row level security;
alter table public.transfers        enable row level security;
alter table public.contest_audit_log enable row level security;

-- profiles: read self + co-league members (needed for reveal grid / dues);
-- update own row but never escalate is_admin.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or id in (
      select lm.user_id from public.league_members lm
      where lm.league_id in (select public.my_league_ids())
    )
  );
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and is_admin = (select p.is_admin from public.profiles p where p.id = (select auth.uid()))
  );

-- Reference data: read-only to all authenticated users.
create policy teams_select    on public.teams    for select to authenticated using (true);
create policy fixtures_select on public.fixtures for select to authenticated using (true);

-- League-scoped reads. No client writes (service role only).
create policy leagues_select on public.leagues for select to authenticated
  using (id in (select public.my_league_ids()));

create policy league_members_select on public.league_members for select to authenticated
  using (league_id in (select public.my_league_ids()));

create policy contests_select on public.contests for select to authenticated
  using (league_id in (select public.my_league_ids()));

create policy contest_results_select on public.contest_results for select to authenticated
  using (contest_id in (
    select id from public.contests where league_id in (select public.my_league_ids())
  ));

create policy transfers_select on public.transfers for select to authenticated
  using (league_id in (select public.my_league_ids()));

-- predictions: own row anytime; others' only after lock (10s skew margin).
create policy predictions_select on public.predictions for select to authenticated
  using (
    contest_id in (
      select id from public.contests where league_id in (select public.my_league_ids())
    )
    and (
      user_id = (select auth.uid())
      or (select c.lock_at from public.contests c where c.id = predictions.contest_id)
           <= now() - interval '10 seconds'
    )
  );

-- predictions write: own row, password changed, member of the contest's league,
-- and predictions close 10s early to kill the clock-skew exploit.
create policy predictions_insert on public.predictions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.password_change_done()
    and exists (
      select 1 from public.contests c
      join public.league_members lm on lm.league_id = c.league_id
      where c.id = contest_id
        and lm.user_id = (select auth.uid())
        and c.lock_at > now() + interval '10 seconds'
    )
  );

create policy predictions_update on public.predictions for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and public.password_change_done()
    and exists (
      select 1 from public.contests c
      join public.league_members lm on lm.league_id = c.league_id
      where c.id = predictions.contest_id
        and lm.user_id = (select auth.uid())
        and c.lock_at > now() + interval '10 seconds'
    )
  );
-- (no delete policy → predictions are immutable once submitted)

-- contest_audit_log: RLS enabled, NO policies → deny all to authenticated.
--   Writes/reads happen via the service role only.

-- ============================================================
-- REALTIME SAFETY (§17.3): predictions must NEVER be broadcast to clients
-- before lock. Remove it from the realtime publication if present.
-- ============================================================
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'predictions'
  ) then
    execute 'alter publication supabase_realtime drop table public.predictions';
  end if;
end;
$$;
