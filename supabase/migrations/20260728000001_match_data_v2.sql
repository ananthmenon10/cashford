-- Cashford Phase 4: match data caches and dark poller leases.
-- Contract: docs/plans/2026-07-27-007-phase4-matches-analytics-plan.md (v11).
-- Additive only. This file is written for review and must not be applied by an agent.

begin;

-- fixture_insights keeps one independent validity bit and timestamp per visible block.
alter table cashford.fixture_insights add column if not exists odds_fetched_at timestamptz;
alter table cashford.fixture_insights add column if not exists odds_ok boolean not null default true;
alter table cashford.fixture_insights add column if not exists model_fetched_at timestamptz;
alter table cashford.fixture_insights add column if not exists model_ok boolean not null default true;
alter table cashford.fixture_insights add column if not exists model_source_kickoff_at timestamptz;
alter table cashford.fixture_insights add column if not exists form_fetched_at timestamptz;
alter table cashford.fixture_insights add column if not exists form_ok boolean not null default true;
alter table cashford.fixture_insights add column if not exists h2h_fetched_at timestamptz;
alter table cashford.fixture_insights add column if not exists h2h_ok boolean not null default true;
alter table cashford.fixture_insights add column if not exists table_fetched_at timestamptz;
alter table cashford.fixture_insights add column if not exists table_ok boolean not null default true;
alter table cashford.fixture_insights add column if not exists team_news jsonb;
alter table cashford.fixture_insights add column if not exists team_news_fetched_at timestamptz;
alter table cashford.fixture_insights add column if not exists team_news_source text;
alter table cashford.fixture_insights add column if not exists team_news_ok boolean not null default true;

update cashford.fixture_insights
   set odds_fetched_at = coalesce(odds_fetched_at, fetched_at),
       model_fetched_at = coalesce(model_fetched_at, fetched_at),
       form_fetched_at = coalesce(form_fetched_at, fetched_at),
       h2h_fetched_at = coalesce(h2h_fetched_at, fetched_at),
       table_fetched_at = coalesce(table_fetched_at, fetched_at)
 where fetched_at is not null
   and (
     odds_fetched_at is null
     or model_fetched_at is null
     or form_fetched_at is null
     or h2h_fetched_at is null
     or table_fetched_at is null
   );

create table if not exists cashford.competition_standings (
  competition_id uuid not null references cashford.competitions(id) on delete cascade,
  source text not null check (source in ('espn','derived')),
  rows jsonb not null,
  note text,
  fetched_at timestamptz not null,
  primary key (competition_id, source)
);

create table if not exists cashford.fixture_match_data (
  fixture_id uuid primary key references cashford.fixtures(id) on delete cascade,
  key_events jsonb,
  scorers jsonb,
  team_stats jsonb,
  player_stats jsonb,
  commentary jsonb,
  lineups jsonb,
  key_events_fetched_at timestamptz,
  key_events_ok boolean not null default true,
  scorers_fetched_at timestamptz,
  scorers_ok boolean not null default true,
  team_stats_fetched_at timestamptz,
  team_stats_ok boolean not null default true,
  player_stats_fetched_at timestamptz,
  player_stats_ok boolean not null default true,
  commentary_fetched_at timestamptz,
  commentary_ok boolean not null default true,
  lineups_fetched_at timestamptz,
  lineups_ok boolean not null default true,
  stale_result_reads int not null default 0,
  stale_retry_at timestamptz,
  freeze_reason text check (freeze_reason in ('final','postponed','abandoned')),
  frozen_at timestamptz,
  source_status text,
  source_version int not null default 0,
  source_kickoff_at timestamptz,
  result_fingerprint text
);

create table if not exists cashford.fixture_provider_data (
  fixture_id uuid not null references cashford.fixtures(id) on delete cascade,
  provider text not null check (provider in ('fotmob','understat')),
  xg_home numeric,
  xg_away numeric,
  xg_model text,
  xg_detail jsonb,
  shots jsonb,
  ratings jsonb,
  ratings_provider text,
  potm jsonb,
  momentum jsonb,
  momentum_provider text,
  insight_facts jsonb,
  predicted_xi jsonb,
  xg_fetched_at timestamptz,
  xg_ok boolean not null default true,
  shots_fetched_at timestamptz,
  shots_ok boolean not null default true,
  ratings_fetched_at timestamptz,
  ratings_ok boolean not null default true,
  momentum_fetched_at timestamptz,
  momentum_ok boolean not null default true,
  facts_fetched_at timestamptz,
  facts_ok boolean not null default true,
  predicted_xi_fetched_at timestamptz,
  predicted_xi_ok boolean not null default true,
  fetched_at timestamptz not null,
  attempts int not null default 0,
  last_error text check (last_error in ('disabled','http','timeout','invalid_json','shape')),
  last_status int,
  tried_at timestamptz,
  primary key (fixture_id, provider),
  constraint chk_xg_pair check (
    (xg_home is null and xg_away is null)
    or (xg_home is not null and xg_away is not null and xg_model is not null)
  ),
  constraint chk_provider_model check (
    xg_model is null
    or (provider, xg_model) in
      (('fotmob','fotmob-2026'), ('understat','understat-2026'))
  )
);

-- A stale ESPN summary is counted by one row-locked UPDATE. The caller changes only
-- stale_retry_at; this trigger increments the durable counter and opens the issue once.
create or replace function cashford.count_match_data_stale_read()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stale_retry_at is not null
     and new.stale_retry_at is distinct from old.stale_retry_at
     and new.stale_result_reads = old.stale_result_reads then
    new.stale_result_reads := old.stale_result_reads + 1;
    if new.stale_result_reads = 3 then
      insert into cashford.sync_issues(source, kind, ref, detail)
      values ('espn', 'provider_stale_result', new.fixture_id::text,
              jsonb_build_object('fixture_id', new.fixture_id));
    end if;
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_count_match_data_stale_read'
       and tgrelid = 'cashford.fixture_match_data'::regclass
  ) then
    create trigger trg_count_match_data_stale_read
      before update on cashford.fixture_match_data
      for each row execute function cashford.count_match_data_stale_read();
  end if;
end $$;

create table if not exists cashford.fixture_provider_ids (
  fixture_id uuid not null references cashford.fixtures(id) on delete cascade,
  provider text not null check (provider in ('fotmob','understat')),
  external_id text not null,
  confidence text not null check (confidence in ('exact','matched','manual')),
  matched_on jsonb,
  created_at timestamptz not null default now(),
  primary key (fixture_id, provider),
  unique (provider, external_id)
);

create table if not exists cashford.provider_samples (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  endpoint text not null,
  ref text,
  status int,
  bytes int,
  body jsonb,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_provider_samples_retention
  on cashford.provider_samples(provider, endpoint, fetched_at desc);

-- Retention is part of the insert statement's transaction. A caller cannot persist sample six
-- without trimming the oldest row for the same provider and endpoint.
create or replace function cashford.trim_provider_samples()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from cashford.provider_samples
   where id in (
     select id
       from cashford.provider_samples
      where provider = new.provider and endpoint = new.endpoint
      order by fetched_at desc, id desc
      offset 5
   );
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_trim_provider_samples'
       and tgrelid = 'cashford.provider_samples'::regclass
  ) then
    create trigger trg_trim_provider_samples
      after insert on cashford.provider_samples
      for each row execute function cashford.trim_provider_samples();
  end if;
end $$;

alter table cashford.competition_standings enable row level security;
alter table cashford.fixture_match_data enable row level security;
alter table cashford.fixture_provider_data enable row level security;
alter table cashford.fixture_provider_ids enable row level security;
alter table cashford.provider_samples enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'cashford'
       and tablename = 'competition_standings'
       and policyname = 'competition_standings_select'
  ) then
    create policy competition_standings_select on cashford.competition_standings
      for select to authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'cashford'
       and tablename = 'fixture_match_data'
       and policyname = 'fixture_match_data_select'
  ) then
    create policy fixture_match_data_select on cashford.fixture_match_data
      for select to authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'cashford'
       and tablename = 'fixture_provider_data'
       and policyname = 'fixture_provider_data_select'
  ) then
    create policy fixture_provider_data_select on cashford.fixture_provider_data
      for select to authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'cashford'
       and tablename = 'fixture_provider_ids'
       and policyname = 'fixture_provider_ids_select'
  ) then
    create policy fixture_provider_ids_select on cashford.fixture_provider_ids
      for select to authenticated using (true);
  end if;
end $$;

grant all on cashford.competition_standings to service_role;
grant all on cashford.fixture_match_data to service_role;
grant all on cashford.fixture_provider_data to service_role;
grant all on cashford.fixture_provider_ids to service_role;
grant all on cashford.provider_samples to service_role;
grant select on cashford.competition_standings to authenticated;
grant select on cashford.fixture_match_data to authenticated;
grant select on cashford.fixture_provider_data to authenticated;
grant select on cashford.fixture_provider_ids to authenticated;
revoke insert, update, delete on cashford.competition_standings from anon, authenticated;
revoke insert, update, delete on cashford.fixture_match_data from anon, authenticated;
revoke insert, update, delete on cashford.fixture_provider_data from anon, authenticated;
revoke insert, update, delete on cashford.fixture_provider_ids from anon, authenticated;
revoke all on cashford.provider_samples from anon, authenticated;
revoke all on cashford.sync_state, cashford.sync_issues from public, anon, authenticated;

insert into cashford.sync_state (key, next_due_at)
values
  ('espn_insights', 'infinity'),
  ('espn_match_data', 'infinity'),
  ('espn_commentary', 'infinity'),
  ('espn_standings', 'infinity'),
  ('derived_standings', 'infinity'),
  ('espn_reconcile', 'infinity'),
  ('team_news', 'infinity'),
  ('understat_xg', 'infinity'),
  ('fotmob_slow', 'infinity')
on conflict (key) do nothing;

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
     and lease_token is null;
  get diagnostics v_ok = row_count; return v_ok = 1;
end; $$;

revoke all on function cashford.arm_sync_key(text, timestamptz) from public, anon, authenticated;
grant execute on function cashford.arm_sync_key(text, timestamptz) to service_role;

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
     for update;
  if not found then
    raise exception 'claim_phase4_lease: no sync_state row for %', p_key;
  end if;

  v_now := clock_timestamp();

  if v_next > v_now then
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

-- The legacy and leased insights writers use the same row lock at the handoff. The legacy
-- branch takes a short lease too, so concurrent ticks cannot both write before arming.
create or replace function cashford.claim_insights_writer(p_lease_seconds int)
returns table(writer text, token uuid, reason text)
language plpgsql security definer set search_path = '' as $$
declare v_next timestamptz; v_lease timestamptz; v_token uuid; v_now timestamptz;
begin
  if p_lease_seconds is null or p_lease_seconds <= 0 then
    raise exception 'claim_insights_writer: lease_seconds must be positive';
  end if;

  select s.next_due_at, s.lease_until into v_next, v_lease
    from cashford.sync_state s
   where s.key = 'espn_insights'
     for update;
  if not found then
    raise exception 'claim_insights_writer: no sync_state row for espn_insights';
  end if;

  v_now := clock_timestamp();
  if v_lease is not null and v_lease >= v_now then
    return query select 'none'::text, null::uuid, 'leased'::text; return;
  end if;

  if v_next = 'infinity'::timestamptz then
    v_token := gen_random_uuid();
    update cashford.sync_state
       set lease_until = v_now + make_interval(secs => p_lease_seconds),
           lease_token = v_token,
           last_run_at = v_now
     where key = 'espn_insights';
    return query select 'legacy'::text, v_token, null::text; return;
  end if;

  if v_next > v_now then
    return query select 'none'::text, null::uuid, 'not_due'::text; return;
  end if;

  v_token := gen_random_uuid();
  update cashford.sync_state
     set lease_until = v_now + make_interval(secs => p_lease_seconds),
         lease_token = v_token,
         last_run_at = v_now
   where key = 'espn_insights';
  return query select 'leased'::text, v_token, null::text;
end; $$;

revoke all on function cashford.claim_insights_writer(int) from public, anon, authenticated;
grant execute on function cashford.claim_insights_writer(int) to service_role;

-- Delete and replacement are one database transaction. A failed replacement rolls back the
-- delete, so a provider id is never left unmapped.
create or replace function cashford.replace_provider_fixture_id(
  p_fixture_id uuid,
  p_provider text,
  p_external_id text,
  p_confidence text,
  p_matched_on jsonb
)
returns int
language plpgsql security definer set search_path = '' as $$
declare v_removed int;
begin
  delete from cashford.fixture_provider_ids
   where provider = p_provider
     and external_id = p_external_id
     and fixture_id <> p_fixture_id;
  get diagnostics v_removed = row_count;

  insert into cashford.fixture_provider_ids(
    fixture_id, provider, external_id, confidence, matched_on
  ) values (
    p_fixture_id, p_provider, p_external_id, p_confidence, p_matched_on
  )
  on conflict (fixture_id, provider) do update
    set external_id = excluded.external_id,
        confidence = excluded.confidence,
        matched_on = excluded.matched_on;

  return v_removed;
end; $$;

revoke all on function cashford.replace_provider_fixture_id(uuid, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function cashford.replace_provider_fixture_id(uuid, text, text, text, jsonb)
  to service_role;

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

revoke all on function cashford.trim_provider_samples() from public, anon, authenticated;
grant execute on function cashford.trim_provider_samples() to service_role;
revoke all on function cashford.count_match_data_stale_read() from public, anon, authenticated;
grant execute on function cashford.count_match_data_stale_read() to service_role;

commit;
