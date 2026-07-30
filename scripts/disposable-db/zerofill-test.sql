-- Decision #42 proof. Disposable Postgres only.
--
-- Usage:
--   scripts/disposable-db/up.sh
--   PGPASSWORD=postgres psql -h localhost -p 55432 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f scripts/disposable-db/zerofill-test.sql
\set ON_ERROR_STOP on

create or replace function zf_ok(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond then raise notice 'PASS  %', label;
  else raise exception 'FAIL  %', label; end if;
end $$;

do $$
declare n int;
begin
  select count(*) into n from cashford.gameweek_contests;
  if n > 0 then
    raise exception 'zerofill-test needs a fresh cluster: % gameweek pots already exist. Run scripts/disposable-db/up.sh first.', n;
  end if;
end $$;

\echo '=== migration reapply guard ==='
\ir ../../supabase/migrations/20260727000003_zero_fill_added_fixtures.sql
\ir ../../supabase/migrations/20260727000003_zero_fill_added_fixtures.sql

create table zf_case_ids (
  case_name text not null,
  k text not null,
  v uuid not null,
  primary key (case_name, k)
);

create or replace function zf_seed_case(
  p_case text,
  p_gw_status text,
  p_deadline timestamptz,
  p_candidate_kickoff timestamptz
) returns void
language plpgsql as $$
declare
  c uuid;
  gw uuid;
  lg uuid;
  pot uuid;
  f_base uuid;
  f_candidate uuid;
  m_base uuid;
  entry_id uuid;
  u uuid := '00000000-0000-0000-0000-0000000004a1';
  home_team uuid := (select id from cashford.teams where name = 'ZF Home 1');
  away_team uuid := (select id from cashford.teams where name = 'ZF Away 1');
  case_slug text := replace(p_case, '_', '-');
begin
  insert into cashford.competitions (slug, name, format, season, fpl_source, status)
  values ('zf-' || case_slug, 'ZF ' || p_case, 'league', '2026/27', true, 'active')
  returning id into c;

  insert into cashford.gameweeks
    (competition_id, number, name, deadline_at, fpl_event_id, status)
  values (c, 1, 'ZF ' || p_case || ' GW', p_deadline, 91, p_gw_status)
  returning id into gw;

  insert into cashford.fixtures
    (competition_id, fpl_fixture_id, kickoff_at, home_team_id, away_team_id, status)
  values (c, 9101, now() + interval '2 days', home_team, away_team, 'scheduled')
  returning id into f_base;
  insert into cashford.fixtures
    (competition_id, fpl_fixture_id, kickoff_at, home_team_id, away_team_id, status)
  values (c, 9102, p_candidate_kickoff, home_team, away_team, 'scheduled')
  returning id into f_candidate;

  insert into cashford.gameweek_fixtures
    (gameweek_id, fixture_id, competition_id, state, is_current)
  values (gw, f_base, c, 'active', true)
  returning id into m_base;

  insert into cashford.leagues (name, slug, default_stake_inr, created_by)
  values ('ZF ' || p_case || ' League', 'zf-' || case_slug || '-league', 100, u)
  returning id into lg;
  insert into cashford.league_members (league_id, user_id) values (lg, u);
  insert into cashford.league_competitions
    (league_id, competition_id, status, eligible_from_gameweek_id)
  values (lg, c, 'active', gw);
  insert into cashford.member_competitions
    (league_id, user_id, competition_id, eligible_from_gameweek_id)
  values (lg, u, c, gw);
  insert into cashford.gameweek_contests
    (league_id, gameweek_id, competition_id, stake_inr, deadline_at, status)
  values (lg, gw, c, 100, coalesce(p_deadline, now() + interval '1 day'), 'open')
  returning id into pot;
  insert into cashford.gameweek_entries
    (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
  values (pot, lg, gw, c, u, 'entered')
  returning id into entry_id;
  insert into cashford.gameweek_picks
    (entry_id, membership_id, gameweek_id, fixture_id, competition_id, pred_home, pred_away)
  values (entry_id, m_base, gw, f_base, c, 1, 0);

  insert into zf_case_ids values
    (p_case, 'c', c),
    (p_case, 'gw', gw),
    (p_case, 'lg', lg),
    (p_case, 'pot', pot),
    (p_case, 'f_base', f_base),
    (p_case, 'f_candidate', f_candidate),
    (p_case, 'm_base', m_base),
    (p_case, 'entry', entry_id);
end $$;

create or replace function zf_case_snapshot(p_case text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'competition_slug', c.slug,
    'gameweeks', jsonb_build_array(jsonb_build_object(
      'number', g.number,
      'name', g.name,
      'deadline_at', g.deadline_at,
      'fpl_event_id', g.fpl_event_id
    )),
    'fixtures', jsonb_build_array(
      jsonb_build_object(
        'fpl_fixture_id', f_base.fpl_fixture_id,
        'fpl_event_id', g.fpl_event_id,
        'kickoff_at', f_base.kickoff_at,
        'home_team_id', f_base.home_team_id,
        'away_team_id', f_base.away_team_id
      ),
      jsonb_build_object(
        'fpl_fixture_id', f_candidate.fpl_fixture_id,
        'fpl_event_id', g.fpl_event_id,
        'kickoff_at', f_candidate.kickoff_at,
        'home_team_id', f_candidate.home_team_id,
        'away_team_id', f_candidate.away_team_id
      )
    )
  )
    from zf_case_ids ci
    join cashford.competitions c on c.id = ci.v and ci.k = 'c'
    join cashford.gameweeks g
      on g.id = (select v from zf_case_ids where case_name = p_case and k = 'gw')
    join cashford.fixtures f_base
      on f_base.id = (select v from zf_case_ids where case_name = p_case and k = 'f_base')
    join cashford.fixtures f_candidate
      on f_candidate.id = (select v from zf_case_ids where case_name = p_case and k = 'f_candidate')
   where ci.case_name = p_case
$$;

\echo '=== seed one open gameweek, one pot and three existing entries ==='
do $$
declare
  c uuid;
  gw uuid;
  lg uuid;
  pot uuid;
  home1 uuid;
  away1 uuid;
  home2 uuid;
  away2 uuid;
  f1 uuid;
  m1 uuid;
  u1 uuid := '00000000-0000-0000-0000-0000000004a1';
  u2 uuid := '00000000-0000-0000-0000-0000000004a2';
  u3 uuid := '00000000-0000-0000-0000-0000000004a3';
begin
  insert into cashford.competitions (slug, name, format, season, fpl_source, status)
  values ('zerofill-pl', 'Zero Fill PL', 'league', '2026/27', true, 'active')
  returning id into c;

  insert into cashford.gameweeks
    (competition_id, number, name, deadline_at, fpl_event_id, status)
  values (c, 1, 'Zero Fill GW1', now() + interval '2 days', 61, 'open')
  returning id into gw;

  insert into cashford.teams (name, short_name) values ('ZF Home 1', 'ZH1') returning id into home1;
  insert into cashford.teams (name, short_name) values ('ZF Away 1', 'ZA1') returning id into away1;
  insert into cashford.teams (name, short_name) values ('ZF Home 2', 'ZH2') returning id into home2;
  insert into cashford.teams (name, short_name) values ('ZF Away 2', 'ZA2') returning id into away2;

  insert into cashford.fixtures
    (competition_id, fpl_fixture_id, kickoff_at, home_team_id, away_team_id, status)
  values (c, 6101, now() + interval '3 days', home1, away1, 'scheduled')
  returning id into f1;

  insert into cashford.gameweek_fixtures
    (gameweek_id, fixture_id, competition_id, state, is_current)
  values (gw, f1, c, 'active', true)
  returning id into m1;

  insert into auth.users (id, email) values
    (u1, 'zerofill-a@t.test'),
    (u2, 'zerofill-b@t.test'),
    (u3, 'zerofill-c@t.test');

  insert into cashford.leagues (name, slug, default_stake_inr, created_by)
  values ('Zero Fill League', 'zero-fill-league', 100, u1)
  returning id into lg;

  insert into cashford.league_members (league_id, user_id)
  values (lg, u1), (lg, u2), (lg, u3);
  insert into cashford.league_competitions
    (league_id, competition_id, status, eligible_from_gameweek_id)
  values (lg, c, 'active', gw);
  insert into cashford.member_competitions
    (league_id, user_id, competition_id, eligible_from_gameweek_id)
  values (lg, u1, c, gw), (lg, u2, c, gw), (lg, u3, c, gw);

  insert into cashford.gameweek_contests
    (league_id, gameweek_id, competition_id, stake_inr, deadline_at, status)
  select lg, gw, c, 100, deadline_at, 'open'
    from cashford.gameweeks where id = gw
  returning id into pot;

  create table zf_ids (k text primary key, v uuid not null);
  insert into zf_ids values
    ('c', c), ('gw', gw), ('lg', lg), ('pot', pot),
    ('home1', home1), ('away1', away1), ('home2', home2), ('away2', away2),
    ('f1', f1), ('m1', m1), ('u1', u1), ('u2', u2), ('u3', u3);
end $$;

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a1';
select cashford.enter_gameweek(
  (select v from zf_ids where k = 'lg'),
  (select v from zf_ids where k = 'gw'),
  jsonb_build_array(jsonb_build_object(
    'fixture_id', (select v from zf_ids where k = 'f1'), 'pred_home', 1, 'pred_away', 0
  ))
);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a2';
select cashford.enter_gameweek(
  (select v from zf_ids where k = 'lg'),
  (select v from zf_ids where k = 'gw'),
  jsonb_build_array(jsonb_build_object(
    'fixture_id', (select v from zf_ids where k = 'f1'), 'pred_home', 0, 'pred_away', 1
  ))
);
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a3';
select cashford.enter_gameweek(
  (select v from zf_ids where k = 'lg'),
  (select v from zf_ids where k = 'gw'),
  jsonb_build_array(jsonb_build_object(
    'fixture_id', (select v from zf_ids where k = 'f1'), 'pred_home', 2, 'pred_away', 0
  ))
);

-- Prove the dormant pre-deadline state receives the same repair without removing the state.
update cashford.gameweek_entries
   set status = 'needs_update'
 where user_id = (select v from zf_ids where k = 'u3');

\echo '=== add one active fixture: every existing entry receives 0-0 ==='
do $$
declare
  snap jsonb;
  result jsonb;
  gw uuid := (select v from zf_ids where k = 'gw');
  c uuid := (select v from zf_ids where k = 'c');
  f2 uuid;
  m2 uuid;
begin
  select jsonb_build_object(
    'competition_slug', 'zerofill-pl',
    'gameweeks', jsonb_build_array(jsonb_build_object(
      'number', 1,
      'name', g.name,
      'deadline_at', g.deadline_at,
      'fpl_event_id', g.fpl_event_id
    )),
    'fixtures', jsonb_build_array(
      jsonb_build_object(
        'fpl_fixture_id', 6101,
        'fpl_event_id', 61,
        'kickoff_at', f1.kickoff_at,
        'home_team_id', f1.home_team_id,
        'away_team_id', f1.away_team_id
      ),
      jsonb_build_object(
        'fpl_fixture_id', 6102,
        'fpl_event_id', 61,
        'kickoff_at', now() + interval '3 days',
        'home_team_id', (select v from zf_ids where k = 'home2'),
        'away_team_id', (select v from zf_ids where k = 'away2')
      )
    )
  ) into snap
    from cashford.gameweeks g
    join cashford.fixtures f1 on f1.id = (select v from zf_ids where k = 'f1')
   where g.id = gw;

  result := cashford.apply_fpl_reconciliation(snap);
  select id into f2 from cashford.fixtures
   where competition_id = c and fpl_fixture_id = 6102;
  select id into m2 from cashford.gameweek_fixtures
   where gameweek_id = gw and fixture_id = f2 and state = 'active' and is_current;

  insert into zf_ids values ('f2', f2), ('m2', m2);
  create table zf_snapshot (body jsonb not null);
  insert into zf_snapshot values (snap);

  perform zf_ok((result->>'memberships_moved')::int = 1,
                'reconciliation records one new membership');
  perform zf_ok((result->>'contests_bumped')::int = 1,
                'fixture add reports one affected pot');
  perform zf_ok((result->>'picks_filled')::int = 3,
                'reconciliation payload reports all three zero-fills');
  perform zf_ok((select input_version from cashford.gameweek_contests
                  where id = (select v from zf_ids where k = 'pot')) = 1,
                'fixture add bumps input_version exactly once');
  perform zf_ok((select pending_cause from cashford.gameweek_contests
                  where id = (select v from zf_ids where k = 'pot')) = 'membership_change',
                'fixture add records membership_change as the pending cause');
  perform zf_ok((select count(*) from cashford.gameweek_picks
                  where fixture_id = f2 and pred_home = 0 and pred_away = 0) = 3,
                'all three existing entries have a 0-0 pick');
  perform zf_ok((select count(*) from cashford.gameweek_picks
                  where fixture_id = f2 and membership_id = m2) = 3,
                'every zero-fill uses the new active membership as provenance');
  perform zf_ok((select count(*) from cashford.gameweek_entries
                  where gameweek_id = gw and status = 'entered') = 3,
                'entered and legacy needs_update entries finish as entered');
  perform zf_ok(not exists (select 1 from cashford.gameweek_entries
                             where gameweek_id = gw and status = 'needs_update'),
                'fixture add creates no needs_update entry');
  perform zf_ok(not exists (select 1 from cashford.gameweek_entries
                             where gameweek_id = gw and status in ('locked_in','invalid')),
                'fixture add does not touch terminal entry states');
  perform zf_ok((select count(*) from cashford.gameweek_audit_log
                  where gameweek_contest_id = (select v from zf_ids where k = 'pot')
                    and action = 'fixture_zero_fill') = 1,
                'one audit row records the fill for the affected pot');
  perform zf_ok((select detail->>'entries_filled' from cashford.gameweek_audit_log
                  where gameweek_contest_id = (select v from zf_ids where k = 'pot')
                    and action = 'fixture_zero_fill') = '3',
                'audit detail records all three filled entries');
  perform zf_ok((select input_version from cashford.gameweek_audit_log
                  where gameweek_contest_id = (select v from zf_ids where k = 'pot')
                    and action = 'fixture_zero_fill') = 1,
                'audit row carries the post-bump input version');
end $$;

\echo '=== re-observation is a no-op ==='
do $$
declare result jsonb;
begin
  result := cashford.apply_fpl_reconciliation((select body from zf_snapshot));
  perform zf_ok((result->>'memberships_moved')::int = 0,
                'same snapshot moves no membership');
  perform zf_ok((result->>'contests_bumped')::int = 0,
                'same snapshot reports no version bump');
  perform zf_ok((select input_version from cashford.gameweek_contests
                  where id = (select v from zf_ids where k = 'pot')) = 1,
                'same snapshot leaves input_version at one');
  perform zf_ok((select count(*) from cashford.gameweek_picks
                  where fixture_id = (select v from zf_ids where k = 'f2')) = 3,
                'same snapshot does not duplicate zero-filled picks');
  perform zf_ok((select count(*) from cashford.gameweek_audit_log
                  where action = 'fixture_zero_fill') = 1,
                'same snapshot does not duplicate the fill audit');
end $$;

\echo '=== a normal user edit wins over later reconciliation ==='
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000004a3';
select cashford.update_gameweek_picks(
  (select v from zf_ids where k = 'lg'),
  (select v from zf_ids where k = 'gw'),
  jsonb_build_array(
    jsonb_build_object(
      'fixture_id', (select v from zf_ids where k = 'f1'), 'pred_home', 2, 'pred_away', 0
    ),
    jsonb_build_object(
      'fixture_id', (select v from zf_ids where k = 'f2'), 'pred_home', 1, 'pred_away', 1
    )
  )
);
do $$
declare result jsonb;
begin
  result := cashford.apply_fpl_reconciliation((select body from zf_snapshot));
  perform zf_ok((select pred_home = 1 and pred_away = 1
                   from cashford.gameweek_picks p
                   join cashford.gameweek_entries e on e.id = p.entry_id
                  where e.user_id = (select v from zf_ids where k = 'u3')
                    and p.fixture_id = (select v from zf_ids where k = 'f2')),
                'later reconciliation does not overwrite the user-edited 1-1');
  perform zf_ok((result->>'memberships_moved')::int = 0,
                'later reconciliation has no membership work after the edit');
  perform zf_ok((select input_version from cashford.gameweek_contests
                  where id = (select v from zf_ids where k = 'pot')) = 1,
                'pick edit and re-observation do not fight the canonical input version');
end $$;

\echo '=== user edit survives active -> void -> active membership history ==='
create table zf_void_snapshot (body jsonb not null);
insert into zf_void_snapshot
select jsonb_set(body, '{fixtures,1,fpl_event_id}', 'null'::jsonb)
  from zf_snapshot;

do $$
declare result jsonb;
begin
  result := cashford.apply_fpl_reconciliation((select body from zf_void_snapshot));
  perform zf_ok((result->>'memberships_moved')::int = 1,
                'void observation closes the active membership');
  perform zf_ok((result->>'contests_bumped')::int = 1,
                'void observation reports the affected pot once');
  perform zf_ok((select state = 'void' and not is_current
                   from cashford.gameweek_fixtures
                  where id = (select v from zf_ids where k = 'm2')),
                'the pick provenance membership becomes void history');
  perform zf_ok((select pred_home = 1 and pred_away = 1
                   from cashford.gameweek_picks p
                   join cashford.gameweek_entries e on e.id = p.entry_id
                  where e.user_id = (select v from zf_ids where k = 'u3')
                    and p.fixture_id = (select v from zf_ids where k = 'f2')),
                'voiding leaves the user-edited pick stored');
end $$;

do $$
declare
  result jsonb;
  new_membership uuid;
begin
  result := cashford.apply_fpl_reconciliation((select body from zf_snapshot));
  select id into new_membership
    from cashford.gameweek_fixtures
   where gameweek_id = (select v from zf_ids where k = 'gw')
     and fixture_id = (select v from zf_ids where k = 'f2')
     and state = 'active' and is_current;

  perform zf_ok((result->>'memberships_moved')::int = 1,
                'return observation inserts a new active membership');
  perform zf_ok((result->>'picks_filled')::int = 0,
                'return reports no fill because every entry already has a pick');
  perform zf_ok(new_membership is distinct from (select v from zf_ids where k = 'm2'),
                'return uses a new active membership row');
  perform zf_ok((select pred_home = 1 and pred_away = 1
                        and membership_id = (select v from zf_ids where k = 'm2')
                   from cashford.gameweek_picks p
                   join cashford.gameweek_entries e on e.id = p.entry_id
                  where e.user_id = (select v from zf_ids where k = 'u3')
                    and p.fixture_id = (select v from zf_ids where k = 'f2')),
                'ON CONFLICT preserves the edited value and its original provenance');
  perform zf_ok(not exists (
                  select 1
                    from cashford.gameweek_entries e
                   where e.gameweek_id = (select v from zf_ids where k = 'gw')
                     and not exists (
                       select 1 from cashford.gameweek_picks p
                        where p.entry_id = e.id
                          and p.fixture_id = (select v from zf_ids where k = 'f2')
                     )),
                'returned active fixture is never active-and-unfilled');
  perform zf_ok((select count(*) from cashford.gameweek_audit_log
                  where action = 'fixture_zero_fill'
                    and gameweek_contest_id = (select v from zf_ids where k = 'pot')) = 1,
                'void-then-return does not fabricate a second fill audit');
end $$;

\echo '=== scores land in one transaction, deadline passes, and the real DB settle path runs ==='
do $$
declare
  r1 jsonb;
  r2 jsonb;
begin
  r1 := cashford.apply_score_update(
    (select v from zf_ids where k = 'f1'), 1, 0, 'fpl', 'finished');
  r2 := cashford.apply_score_update(
    (select v from zf_ids where k = 'f2'), 0, 0, 'fpl', 'finished');
  perform zf_ok((r1->>'applied')::boolean and (r2->>'applied')::boolean,
                'both final scores apply through apply_score_update');
  perform zf_ok((select input_version from cashford.gameweek_contests
                  where id = (select v from zf_ids where k = 'pot')) = 4,
                'two score writes in one transaction add one version bump');
  perform zf_ok((select pending_cause from cashford.gameweek_contests
                  where id = (select v from zf_ids where k = 'pot')) = 'combined',
                'membership and result changes combine without a second fixture-add bump');
end $$;

update cashford.gameweeks
   set deadline_at = now() - interval '1 minute'
 where id = (select v from zf_ids where k = 'gw');
update cashford.gameweek_contests
   set deadline_at = now() - interval '1 minute'
 where id = (select v from zf_ids where k = 'pot');

do $$
declare result jsonb;
begin
  result := cashford.run_gameweek_maintenance((select v from zf_ids where k = 'c'));
  perform zf_ok((result->>'entries_locked_in')::int = 3,
                'deadline locks all three complete entries');
  perform zf_ok((result->>'entries_invalid')::int = 0,
                'deadline creates no invalid entry');
  perform zf_ok((select status from cashford.gameweeks
                  where id = (select v from zf_ids where k = 'gw')) = 'completed',
                'finished gameweek becomes complete after the deadline');
  perform zf_ok((select status from cashford.gameweek_contests
                  where id = (select v from zf_ids where k = 'pot')) = 'locked',
                'pot reaches the settlement queue');
end $$;

\echo '=== run the real TypeScript scoring worker: claim -> compute -> finalize ==='
\! node --import tsx scripts/disposable-db/zerofill-proof.mts

do $$
declare
  pot uuid := (select v from zf_ids where k = 'pot');
  f2 uuid := (select v from zf_ids where k = 'f2');
  u1 uuid := (select v from zf_ids where k = 'u1');
  u2 uuid := (select v from zf_ids where k = 'u2');
begin
  -- These assertions also make the psql run fail if the worker command above exits early.
  perform zf_ok((select status from cashford.gameweek_contests where id = pot) = 'settled',
                'real worker stores settled status');
  perform zf_ok((select settled_version from cashford.gameweek_results
                  where gameweek_contest_id = pot) = 4,
                'real worker consumes the claimed version');
  perform zf_ok((select count(*) from cashford.gameweek_entry_results
                  where gameweek_contest_id = pot) = 3,
                'real worker stores all three entry results');
  perform zf_ok((select points from cashford.gameweek_entry_results ger
                  join cashford.gameweek_entries e on e.id = ger.entry_id
                 where e.user_id = u1) = 6,
                'winner receives six points including the auto-filled exact 0-0');
  perform zf_ok((select count(*)
                   from cashford.gameweek_entry_results ger
                   join cashford.gameweek_entries e on e.id = ger.entry_id
                   cross join lateral jsonb_array_elements(ger.per_fixture) pf
                  where e.user_id in (u1, u2)
                    and (pf->>'fixtureId')::uuid = f2
                    and pf->>'verdict' = 'exact'
                    and (pf->>'pts')::int = 3) = 2,
                'real scoring counts each untouched 0-0 as an exact pick');
  perform zf_ok((select count(*) from cashford.transfers
                  where gameweek_contest_id = pot and not reversed) = 2,
                'real worker writes both loser-to-winner transfers');
  perform zf_ok((select count(*)
                   from cashford.gameweek_entry_results ger
                   join cashford.gameweek_entries e on e.id = ger.entry_id
                   cross join lateral jsonb_array_elements(ger.per_fixture) pf
                  where e.user_id = (select v from zf_ids where k = 'u3')
                    and (pf->>'fixtureId')::uuid = f2
                    and pf->>'verdict' = 'result'
                    and (pf->>'pts')::int = 1) = 1,
                'settlement consumes the preserved user-edited 1-1 pick end-to-end');
end $$;

\echo '=== F1: one transaction-time decision survives a deadline straddle ==='
do $$
declare
  result jsonb;
  gw uuid;
  candidate uuid;
begin
  perform zf_seed_case(
    'straddle', 'open', now() + interval '50 milliseconds', now() + interval '1 day');
  perform pg_sleep(0.10);
  result := cashford.apply_fpl_reconciliation(zf_case_snapshot('straddle'));
  gw := (select v from zf_case_ids where case_name = 'straddle' and k = 'gw');
  candidate := (select v from zf_case_ids where case_name = 'straddle' and k = 'f_candidate');

  perform zf_ok(exists (
                  select 1 from cashford.gameweek_fixtures
                   where gameweek_id = gw and fixture_id = candidate
                     and state = 'active' and is_current),
                'deadline straddle inserts the membership active on transaction time');
  perform zf_ok(not exists (
                  select 1
                    from cashford.gameweek_entries e
                   where e.gameweek_id = gw
                     and not exists (
                       select 1 from cashford.gameweek_picks p
                        where p.entry_id = e.id and p.fixture_id = candidate
                     )),
                'deadline straddle never leaves an active fixture unfilled');
  perform zf_ok((result->>'picks_filled')::int = 1,
                'deadline straddle reports its one fill');
  perform zf_ok(not exists (
                  select 1 from cashford.gameweek_entries
                   where gameweek_id = gw and status = 'needs_update'),
                'deadline straddle leaves the formerly complete entry entered');
end $$;

\echo '=== F2: a past-kickoff add is excluded and never filled ==='
do $$
declare
  result jsonb;
  corrected_snapshot jsonb;
  moved_snapshot jsonb;
  c uuid;
  gw uuid;
  gw2 uuid;
  lg uuid;
  pot2 uuid;
  entry2 uuid;
  candidate uuid;
begin
  perform zf_seed_case(
    'past_kickoff', 'open', now() + interval '1 day', now() - interval '1 hour');
  c := (select v from zf_case_ids where case_name = 'past_kickoff' and k = 'c');
  gw := (select v from zf_case_ids where case_name = 'past_kickoff' and k = 'gw');
  lg := (select v from zf_case_ids where case_name = 'past_kickoff' and k = 'lg');
  candidate := (select v from zf_case_ids where case_name = 'past_kickoff' and k = 'f_candidate');
  update cashford.fixtures
     set status = 'finished', ft_home = 2, ft_away = 1
   where id = candidate;

  result := cashford.apply_fpl_reconciliation(zf_case_snapshot('past_kickoff'));

  perform zf_ok((result->>'picks_filled')::int = 0,
                'past-kickoff add reports zero fills');
  perform zf_ok(not exists (
                  select 1 from cashford.gameweek_picks where fixture_id = candidate),
                'past-kickoff add writes no fabricated pick');
  perform zf_ok((select state = 'excluded' and is_current
                   from cashford.gameweek_fixtures
                  where gameweek_id = gw and fixture_id = candidate),
                'past-kickoff membership is current but excluded');
  perform zf_ok((select count(*) from cashford.sync_issues
                  where source = 'fpl' and kind = 'late-assignment'
                    and ref = candidate::text
                    and (detail->>'kickoff_at')::timestamptz <= now()
                    and detail->>'reason' = 'kickoff_passed') = 1,
                'past-kickoff exclusion writes one guarded sync issue');
  perform zf_ok((result->>'contests_bumped')::int = 0,
                'excluded past-kickoff membership does not bump a pot');

  corrected_snapshot := jsonb_set(
    zf_case_snapshot('past_kickoff'),
    '{fixtures,1,kickoff_at}',
    to_jsonb(now() + interval '2 days')
  );
  perform cashford.apply_fpl_reconciliation(corrected_snapshot);
  perform zf_ok((select state = 'excluded' and is_current
                   from cashford.gameweek_fixtures
                  where gameweek_id = gw and fixture_id = candidate),
                'same-event future-kickoff correction leaves the exclusion final');

  insert into cashford.gameweeks
    (competition_id, number, name, deadline_at, fpl_event_id, status)
  values (c, 2, 'ZF past_kickoff GW2', now() + interval '1 day', 92, 'upcoming')
  returning id into gw2;
  insert into cashford.gameweek_contests
    (league_id, gameweek_id, competition_id, stake_inr, deadline_at, status)
  values (lg, gw2, c, 100, now() + interval '1 day', 'open')
  returning id into pot2;
  insert into cashford.gameweek_entries
    (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
  values (
    pot2, lg, gw2, c,
    '00000000-0000-0000-0000-0000000004a1',
    'entered'
  )
  returning id into entry2;

  moved_snapshot := jsonb_set(
    corrected_snapshot,
    '{fixtures,1,fpl_event_id}',
    to_jsonb(92)
  );
  result := cashford.apply_fpl_reconciliation(moved_snapshot);
  perform zf_ok(
    (result->>'picks_filled')::int = 1
    and exists (
      select 1 from cashford.gameweek_fixtures
       where gameweek_id = gw2 and fixture_id = candidate
         and state = 'active' and is_current
    )
    and exists (
      select 1 from cashford.gameweek_picks
       where entry_id = entry2 and fixture_id = candidate
         and pred_home = 0 and pred_away = 0
    ),
    'different-event move recovers the fixture and fills the new gameweek'
  );
end $$;

\echo '=== F3: upcoming gameweek with an open pot fills ==='
do $$
declare
  result jsonb;
  gw uuid;
  candidate uuid;
begin
  perform zf_seed_case(
    'upcoming', 'upcoming', now() + interval '1 day', now() + interval '2 days');
  gw := (select v from zf_case_ids where case_name = 'upcoming' and k = 'gw');
  candidate := (select v from zf_case_ids where case_name = 'upcoming' and k = 'f_candidate');
  result := cashford.apply_fpl_reconciliation(zf_case_snapshot('upcoming'));

  perform zf_ok((result->>'picks_filled')::int = 1,
                'upcoming gameweek reports its fill');
  perform zf_ok(exists (
                  select 1 from cashford.gameweek_picks
                   where fixture_id = candidate and pred_home = 0 and pred_away = 0),
                'upcoming gameweek receives the 0-0 pick');
  perform zf_ok(not exists (
                  select 1 from cashford.gameweek_entries
                   where gameweek_id = gw and status = 'needs_update'),
                'upcoming gameweek fixture add creates no needs_update state');
end $$;

\echo '=== F4: a null gameweek deadline uses the same active-and-fill branch ==='
do $$
declare
  result jsonb;
  gw uuid;
  candidate uuid;
begin
  perform zf_seed_case(
    'null_deadline', 'upcoming', null::timestamptz, now() + interval '2 days');
  gw := (select v from zf_case_ids where case_name = 'null_deadline' and k = 'gw');
  candidate := (select v from zf_case_ids where case_name = 'null_deadline' and k = 'f_candidate');
  result := cashford.apply_fpl_reconciliation(zf_case_snapshot('null_deadline'));

  perform zf_ok(exists (
                  select 1 from cashford.gameweek_fixtures
                   where gameweek_id = gw and fixture_id = candidate
                     and state = 'active' and is_current),
                'null-deadline destination inserts an active membership');
  perform zf_ok((result->>'picks_filled')::int = 1,
                'null-deadline destination reports its fill');
  perform zf_ok(not exists (
                  select 1 from cashford.gameweek_entries
                   where gameweek_id = gw and status = 'needs_update'),
                'null-deadline fixture add creates no needs_update state');
end $$;

\echo '=== dormant incomplete entry gets the new fill but keeps its other deficit ==='
do $$
declare
  result jsonb;
  c uuid;
  gw uuid;
  target_entry uuid;
  candidate uuid;
  other_fixture uuid;
begin
  perform zf_seed_case(
    'incomplete', 'open', now() + interval '1 day', now() + interval '2 days');
  c := (select v from zf_case_ids where case_name = 'incomplete' and k = 'c');
  gw := (select v from zf_case_ids where case_name = 'incomplete' and k = 'gw');
  target_entry := (select v from zf_case_ids where case_name = 'incomplete' and k = 'entry');
  candidate := (select v from zf_case_ids where case_name = 'incomplete' and k = 'f_candidate');

  insert into cashford.fixtures
    (competition_id, fpl_fixture_id, kickoff_at, home_team_id, away_team_id, status)
  values (
    c, 9103, now() + interval '2 days',
    (select v from zf_ids where k = 'home2'),
    (select v from zf_ids where k = 'away2'),
    'scheduled'
  ) returning id into other_fixture;
  insert into cashford.gameweek_fixtures
    (gameweek_id, fixture_id, competition_id, state, is_current)
  values (gw, other_fixture, c, 'active', true);
  update cashford.gameweek_entries set status = 'needs_update' where id = target_entry;

  result := cashford.apply_fpl_reconciliation(zf_case_snapshot('incomplete'));

  perform zf_ok((result->>'picks_filled')::int = 1,
                'pre-existing incomplete entry receives the newly added fixture fill');
  perform zf_ok(exists (
                  select 1 from cashford.gameweek_picks
                   where entry_id = target_entry and fixture_id = candidate
                     and pred_home = 0 and pred_away = 0),
                'pre-existing incomplete entry stores the candidate 0-0');
  perform zf_ok(not exists (
                  select 1 from cashford.gameweek_picks
                   where entry_id = target_entry and fixture_id = other_fixture),
                'reconciliation does not invent the unrelated missing pick');
  perform zf_ok((select status from cashford.gameweek_entries where id = target_entry) = 'needs_update',
                'entry stays needs_update only for the other missing fixture');
end $$;

\echo '=== multi-league fan-out writes one audit row and bump per pot ==='
do $$
declare
  result jsonb;
  c uuid;
  gw uuid;
  lg2 uuid;
  pot2 uuid;
  entry2 uuid;
  candidate uuid;
  base_fixture uuid;
  base_membership uuid;
  u2 uuid := (select v from zf_ids where k = 'u2');
begin
  perform zf_seed_case(
    'fanout', 'open', now() + interval '1 day', now() + interval '2 days');
  c := (select v from zf_case_ids where case_name = 'fanout' and k = 'c');
  gw := (select v from zf_case_ids where case_name = 'fanout' and k = 'gw');
  candidate := (select v from zf_case_ids where case_name = 'fanout' and k = 'f_candidate');
  base_fixture := (select v from zf_case_ids where case_name = 'fanout' and k = 'f_base');
  base_membership := (select v from zf_case_ids where case_name = 'fanout' and k = 'm_base');

  insert into cashford.leagues (name, slug, default_stake_inr, created_by)
  values ('ZF Fanout League 2', 'zf-fanout-league-2', 100, u2)
  returning id into lg2;
  insert into cashford.league_members (league_id, user_id) values (lg2, u2);
  insert into cashford.league_competitions
    (league_id, competition_id, status, eligible_from_gameweek_id)
  values (lg2, c, 'active', gw);
  insert into cashford.member_competitions
    (league_id, user_id, competition_id, eligible_from_gameweek_id)
  values (lg2, u2, c, gw);
  insert into cashford.gameweek_contests
    (league_id, gameweek_id, competition_id, stake_inr, deadline_at, status)
  select lg2, gw, c, 100, deadline_at, 'open'
    from cashford.gameweeks where id = gw
  returning id into pot2;
  insert into cashford.gameweek_entries
    (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
  values (pot2, lg2, gw, c, u2, 'entered')
  returning id into entry2;
  insert into cashford.gameweek_picks
    (entry_id, membership_id, gameweek_id, fixture_id, competition_id, pred_home, pred_away)
  values (entry2, base_membership, gw, base_fixture, c, 0, 1);

  result := cashford.apply_fpl_reconciliation(zf_case_snapshot('fanout'));

  perform zf_ok((result->>'contests_bumped')::int = 2,
                'fan-out payload reports both affected pots');
  perform zf_ok((result->>'picks_filled')::int = 2,
                'fan-out payload reports both entry fills');
  perform zf_ok((select count(*) from cashford.gameweek_audit_log
                  where action = 'fixture_zero_fill'
                    and gameweek_contest_id in (
                      (select v from zf_case_ids where case_name = 'fanout' and k = 'pot'),
                      pot2
                    )) = 2,
                'fan-out writes one fill audit row per pot');
  perform zf_ok(not exists (
                  select 1
                    from cashford.gameweek_contests gc
                   where gc.id in (
                     (select v from zf_case_ids where case_name = 'fanout' and k = 'pot'),
                     pot2
                   )
                     and (gc.input_version <> 1 or gc.pending_cause <> 'membership_change')),
                'fan-out bumps each pot exactly once with membership_change');
  perform zf_ok((select count(*) from cashford.gameweek_picks
                  where fixture_id = candidate and pred_home = 0 and pred_away = 0) = 2,
                'fan-out fills the entry in each league');
end $$;

\echo '=== routine security boundary ==='
select zf_ok(not has_function_privilege(
               'anon', 'cashford.apply_fpl_reconciliation(jsonb)', 'execute'),
             'anon cannot execute reconciliation');
select zf_ok(not has_function_privilege(
               'authenticated', 'cashford.apply_fpl_reconciliation(jsonb)', 'execute'),
             'authenticated cannot execute reconciliation');
select zf_ok(has_function_privilege(
               'service_role', 'cashford.apply_fpl_reconciliation(jsonb)', 'execute'),
             'service_role can execute reconciliation');

\echo '=== Decision #42 zero-fill proof complete ==='
