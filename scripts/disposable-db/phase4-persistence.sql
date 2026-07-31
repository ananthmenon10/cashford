\set ON_ERROR_STOP on

-- Run only in the disposable Postgres harness after migrations 000001–000003 and
-- 20260728000001_match_data_v2.sql. This file never targets the shared Supabase DB.

do $$
declare
  v_count int;
begin
  select count(*) into v_count
    from cashford.sync_state
   where key in (
     'espn_insights','espn_match_data','espn_commentary',
     'espn_standings','derived_standings','espn_reconcile',
     'team_news','understat_xg','fotmob_slow'
   )
     and next_due_at = 'infinity'::timestamptz;
  if v_count <> 9 then
    raise exception 'expected nine dark Phase 4 keys, found %', v_count;
  end if;
end $$;

do $$
begin
  if has_function_privilege('anon', 'cashford.arm_sync_key(text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'cashford.arm_sync_key(text,timestamptz)', 'execute')
     or has_function_privilege('public', 'cashford.arm_sync_key(text,timestamptz)', 'execute') then
    raise exception 'arm_sync_key privilege leak';
  end if;
  if not has_function_privilege(
    'service_role',
    'cashford.arm_sync_key(text,timestamptz)',
    'execute'
  ) then
    raise exception 'service_role cannot arm Phase 4';
  end if;
end $$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'competition_standings',
    'fixture_match_data',
    'fixture_provider_data',
    'fixture_provider_ids'
  ] loop
    if not has_table_privilege('authenticated', 'cashford.' || v_table, 'select') then
      raise exception 'authenticated cannot select %', v_table;
    end if;
    if has_table_privilege('authenticated', 'cashford.' || v_table, 'insert')
       or has_table_privilege('authenticated', 'cashford.' || v_table, 'update')
       or has_table_privilege('authenticated', 'cashford.' || v_table, 'delete')
       or has_table_privilege('anon', 'cashford.' || v_table, 'insert')
       or has_table_privilege('anon', 'cashford.' || v_table, 'update')
       or has_table_privilege('anon', 'cashford.' || v_table, 'delete') then
      raise exception 'cache write privilege leaked on %', v_table;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'cashford.provider_samples', 'select')
     or has_table_privilege('authenticated', 'cashford.sync_state', 'select')
     or has_table_privilege('authenticated', 'cashford.sync_issues', 'select') then
    raise exception 'operational table select privilege leaked';
  end if;
end $$;

do $$
declare
  v_comp uuid;
  v_home uuid;
  v_away uuid;
  v_fixture uuid;
  v_count int;
begin
  insert into cashford.competitions
    (slug, name, format, season, fpl_source, status)
  values
    ('phase4-proof', 'Phase 4 Proof', 'league', '2026-27', false, 'active')
  returning id into v_comp;
  insert into cashford.teams(name, short_name)
  values ('Phase4 Home', 'P4H') returning id into v_home;
  insert into cashford.teams(name, short_name)
  values ('Phase4 Away', 'P4A') returning id into v_away;
  insert into cashford.fixtures
    (competition_id, kickoff_at, home_team_id, away_team_id, status, ft_home, ft_away)
  values
    (v_comp, now() - interval '1 hour', v_home, v_away, 'finished', 2, 1)
  returning id into v_fixture;

  begin
    insert into cashford.fixture_provider_data
      (fixture_id, provider, xg_home, xg_model, fetched_at)
    values
      (v_fixture, 'understat', 1.2, 'understat-2026', now());
    raise exception 'chk_xg_pair accepted one-sided xG';
  exception
    when check_violation then null;
  end;

  begin
    insert into cashford.fixture_provider_data
      (fixture_id, provider, xg_home, xg_away, xg_model, fetched_at)
    values
      (v_fixture, 'understat', 1.2, 0.8, 'fotmob-2026', now());
    raise exception 'chk_provider_model accepted a cross-labelled model';
  exception
    when check_violation then null;
  end;

  insert into cashford.fixture_provider_data
    (fixture_id, provider, xg_home, xg_away, xg_model, fetched_at)
  values
    (v_fixture, 'understat', 1.2, 0.8, 'understat-2026', now());
  begin
    insert into cashford.fixture_provider_data
      (fixture_id, provider, fetched_at)
    values
      (v_fixture, 'understat', now());
    raise exception 'provider primary key accepted a duplicate';
  exception
    when unique_violation then null;
  end;

  insert into cashford.fixture_provider_ids
    (fixture_id, provider, external_id, confidence)
  values
    (v_fixture, 'understat', 'phase4-proof-match', 'manual');
  insert into cashford.fixture_match_data
    (fixture_id, stale_retry_at, stale_result_reads)
  values
    (v_fixture, now(), 0);
  update cashford.fixture_match_data
     set stale_retry_at = stale_retry_at + interval '1 second'
   where fixture_id = v_fixture;
  update cashford.fixture_match_data
     set stale_retry_at = stale_retry_at + interval '1 second'
   where fixture_id = v_fixture;
  update cashford.fixture_match_data
     set stale_retry_at = stale_retry_at + interval '1 second'
   where fixture_id = v_fixture;
  select count(*) into v_count
    from cashford.sync_issues
   where source = 'espn'
     and kind = 'provider_stale_result'
     and ref = v_fixture::text;
  if v_count <> 1 then
    raise exception 'stale-read issue count %, expected 1', v_count;
  end if;

  delete from cashford.fixtures where id = v_fixture;
  select
    (select count(*) from cashford.fixture_match_data where fixture_id = v_fixture) +
    (select count(*) from cashford.fixture_provider_data where fixture_id = v_fixture) +
    (select count(*) from cashford.fixture_provider_ids where fixture_id = v_fixture)
    into v_count;
  if v_count <> 0 then
    raise exception 'fixture cascade left % Phase 4 cache rows', v_count;
  end if;
end $$;

insert into cashford.provider_samples(provider, endpoint, bytes, body, fetched_at)
select
  'understat',
  'phase4-retention-proof',
  n,
  jsonb_build_object('n', n),
  clock_timestamp() + n * interval '1 second'
from generate_series(1, 6) n;

do $$
declare
  v_count int;
  v_min int;
begin
  select count(*), min(bytes) into v_count, v_min
    from cashford.provider_samples
   where provider = 'understat'
     and endpoint = 'phase4-retention-proof';
  if v_count <> 5 or v_min <> 2 then
    raise exception 'sample retention got count %, min %, expected 5 and 2',
      v_count, v_min;
  end if;
end $$;

select *
  from cashford.claim_phase4_lease('espn_match_data', 300);

do $$
begin
  begin
    perform cashford.claim_phase4_lease('fpl-sync', 300);
    raise exception 'claim accepted fpl-sync';
  exception
    when others then
      if sqlerrm = 'claim accepted fpl-sync' then raise; end if;
  end;
end $$;

do $$
begin
  begin
    perform cashford.release_sync_lease_jittered(
      'fotmob_slow',
      gen_random_uuid(),
      0,
      1
    );
    raise exception 'jitter accepted zero';
  exception
    when others then
      if sqlerrm = 'jitter accepted zero' then raise; end if;
  end;
end $$;
