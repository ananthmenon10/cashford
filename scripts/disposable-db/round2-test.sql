-- Phase 2 code review, ROUND 2. Two findings, both about behaviour under concurrency or scale
-- that no unit test can reach, so both are proved against a real Postgres.
--
--   Finding 1  settlement-queue starvation. A bounded scan must reach every actionable contest
--              within a bounded number of passes however many unrepairable corrupt rows exist,
--              and must not re-file the same unresolved finding on every tick.
--   Finding 2  join/archive deadlock. Every league lifecycle writer must take its locks in one
--              order with join_league.
--
-- This file seeds the population and pins the routine-level contract. The parts that need more
-- than one session — real dispatcher passes, and join vs archive in both interleavings — are in
-- scripts/disposable-db/round2-proof.mts, which runs after this file and reads r2_ids.
--
-- Both files count rows the dispatcher scans globally, so they need a FRESH cluster with no
-- other gameweek pots in it — run them straight after up.sh, not after another seed. The guard
-- below fails loudly rather than reporting a wrong count.
--
-- Usage (disposable cluster ONLY — it writes 40 deliberately corrupt rows):
--   scripts/disposable-db/up.sh
--   PGPASSWORD=postgres psql -h localhost -p 55432 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f scripts/disposable-db/round2-test.sql
--   node --import tsx scripts/disposable-db/round2-proof.mts
\set ON_ERROR_STOP on

create or replace function r2_ok(cond boolean, label text) returns void
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
    raise exception 'round2-test needs a fresh cluster: % gameweek pots already exist. Run scripts/disposable-db/up.sh first.', n;
  end if;
end $$;

-- ---------------------------------------------------------------- seed
-- One competition, one gameweek, three finished fixtures. 40 leagues whose pot is 'settled'
-- with no result row (corrupt, and nothing the worker can ever repair), plus two leagues that
-- hold real money work: one abandoned claim and one dirty pot. The corrupt pots carry the
-- OLDEST deadlines, so any ordering that prefers them keeps winning.
do $$
declare
  c uuid; gw uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid;
  f1 uuid; f2 uuid; f3 uuid;
  m1 uuid; m2 uuid; m3 uuid;
  lg uuid; pot uuid; e uuid;
  l_exp uuid; l_dirty uuid; pot_exp uuid; pot_dirty uuid;
  i int;
  u1 uuid := '00000000-0000-0000-0000-0000000002a1';
  u2 uuid := '00000000-0000-0000-0000-0000000002a2';
  u3 uuid := '00000000-0000-0000-0000-0000000002a3';
begin
  insert into cashford.competitions (slug, name, format, season, fpl_source, status)
  values ('r2-pl', 'Round2 PL', 'league', '2026/27', true, 'active') returning id into c;

  -- 'locked': the deadline has passed, which is the only state a settleable pot exists in.
  insert into cashford.gameweeks (competition_id, number, name, deadline_at, fpl_event_id, status)
  values (c, 1, 'R2 GW1', now() - interval '3 days', 31, 'locked') returning id into gw;

  insert into cashford.teams (name, short_name) values ('X1','X1') returning id into t1;
  insert into cashford.teams (name, short_name) values ('X2','X2') returning id into t2;
  insert into cashford.teams (name, short_name) values ('X3','X3') returning id into t3;
  insert into cashford.teams (name, short_name) values ('X4','X4') returning id into t4;
  insert into cashford.teams (name, short_name) values ('X5','X5') returning id into t5;
  insert into cashford.teams (name, short_name) values ('X6','X6') returning id into t6;

  -- Every fixture finished with a score: readiness holds, so 'ready'/'dirty'/'expired' rows are
  -- genuinely actionable and a failure to reach them is starvation, not a missing precondition.
  insert into cashford.fixtures (competition_id, fpl_fixture_id, external_id, kickoff_at,
                                 home_team_id, away_team_id, status, ft_home, ft_away)
  values (c, 31, 9031, now() - interval '2 days', t1, t2, 'finished', 2, 1) returning id into f1;
  insert into cashford.fixtures (competition_id, fpl_fixture_id, external_id, kickoff_at,
                                 home_team_id, away_team_id, status, ft_home, ft_away)
  values (c, 32, 9032, now() - interval '2 days', t3, t4, 'finished', 0, 0) returning id into f2;
  insert into cashford.fixtures (competition_id, fpl_fixture_id, external_id, kickoff_at,
                                 home_team_id, away_team_id, status, ft_home, ft_away)
  values (c, 33, 9033, now() - interval '2 days', t5, t6, 'finished', 1, 3) returning id into f3;

  insert into cashford.gameweek_fixtures (gameweek_id, fixture_id, competition_id, state, is_current)
  values (gw, f1, c, 'active', true) returning id into m1;
  insert into cashford.gameweek_fixtures (gameweek_id, fixture_id, competition_id, state, is_current)
  values (gw, f2, c, 'active', true) returning id into m2;
  insert into cashford.gameweek_fixtures (gameweek_id, fixture_id, competition_id, state, is_current)
  values (gw, f3, c, 'active', true) returning id into m3;

  insert into auth.users (id, email) values (u1,'r2a@t.test'), (u2,'r2b@t.test'), (u3,'r2c@t.test');

  create table if not exists r2_ids (k text primary key, v uuid);

  -- 40 corrupt pots = the default dispatcher limit, so under the reviewed code they filled the
  -- queue exactly and nothing else could ever be returned.
  for i in 1..40 loop
    insert into cashford.leagues (name, slug, default_stake_inr, created_by)
    values ('R2 Corrupt ' || i, 'r2-corrupt-' || i, 100, u1) returning id into lg;
    insert into cashford.league_competitions (league_id, competition_id, status, eligible_from_gameweek_id)
    values (lg, c, 'active', gw);
    insert into cashford.gameweek_contests
      (league_id, gameweek_id, competition_id, stake_inr, deadline_at, status, input_version)
    values (lg, gw, c, 100, now() - interval '30 days', 'settled', 1) returning id into pot;
    insert into r2_ids values ('corrupt_' || i, pot) on conflict (k) do update set v = excluded.v;
  end loop;

  -- The abandoned claim: 'settling' for longer than the 10-minute claim lifetime, with real
  -- entrants behind it. Money is stuck mid-settlement until something reaches it.
  insert into cashford.leagues (name, slug, default_stake_inr, created_by)
  values ('R2 Expired', 'r2-expired', 100, u1) returning id into l_exp;
  insert into cashford.league_competitions (league_id, competition_id, status, eligible_from_gameweek_id)
  values (l_exp, c, 'active', gw);
  insert into cashford.league_members (league_id, user_id) values (l_exp, u1), (l_exp, u2);
  insert into cashford.member_competitions (league_id, user_id, competition_id, eligible_from_gameweek_id)
  values (l_exp, u1, c, gw), (l_exp, u2, c, gw);
  insert into cashford.gameweek_contests
    (league_id, gameweek_id, competition_id, stake_inr, deadline_at, status, input_version,
     claim_token, claim_started_at, claim_input_version, claim_prior_status)
  values (l_exp, gw, c, 100, now() - interval '2 days', 'settling', 1,
          gen_random_uuid(), now() - interval '25 minutes', 1, 'locked')
  returning id into pot_exp;

  -- The dirty pot: already settled, then its input moved. The money on screen is wrong.
  insert into cashford.leagues (name, slug, default_stake_inr, created_by)
  values ('R2 Dirty', 'r2-dirty', 100, u1) returning id into l_dirty;
  insert into cashford.league_competitions (league_id, competition_id, status, eligible_from_gameweek_id)
  values (l_dirty, c, 'active', gw);
  insert into cashford.league_members (league_id, user_id) values (l_dirty, u1), (l_dirty, u2);
  insert into cashford.member_competitions (league_id, user_id, competition_id, eligible_from_gameweek_id)
  values (l_dirty, u1, c, gw), (l_dirty, u2, c, gw);
  insert into cashford.gameweek_contests
    (league_id, gameweek_id, competition_id, stake_inr, deadline_at, status, input_version,
     pending_cause)
  values (l_dirty, gw, c, 100, now() - interval '1 day', 'settled', 4, 'result_revision')
  returning id into pot_dirty;
  insert into cashford.gameweek_results
    (gameweek_contest_id, outcome, tiebreak_used, pot_inr, settled_version, last_settle_cause)
  values (pot_dirty, 'settled', 'none', 200, 2, 'initial');

  -- Two locked-in entrants per actionable pot, complete picks, disagreeing on one fixture so a
  -- settlement actually moves rupees.
  for pot, lg in select unnest(array[pot_exp, pot_dirty]), unnest(array[l_exp, l_dirty]) loop
    insert into cashford.gameweek_entries
      (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
    values (pot, lg, gw, c, u1, 'locked_in') returning id into e;
    insert into cashford.gameweek_picks
      (entry_id, membership_id, gameweek_id, fixture_id, competition_id, pred_home, pred_away)
    values (e, m1, gw, f1, c, 2, 1), (e, m2, gw, f2, c, 0, 0), (e, m3, gw, f3, c, 1, 3);

    insert into cashford.gameweek_entries
      (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
    values (pot, lg, gw, c, u2, 'locked_in') returning id into e;
    insert into cashford.gameweek_picks
      (entry_id, membership_id, gameweek_id, fixture_id, competition_id, pred_home, pred_away)
    values (e, m1, gw, f1, c, 0, 3), (e, m2, gw, f2, c, 2, 2), (e, m3, gw, f3, c, 4, 0);
  end loop;

  -- A league nobody has entered, used only by the join-vs-archive interleaving in the .mts.
  insert into cashford.leagues (name, slug, default_stake_inr, created_by)
  values ('R2 Lifecycle', 'r2-lifecycle', 100, u1) returning id into lg;
  insert into cashford.league_competitions (league_id, competition_id, status, eligible_from_gameweek_id)
  values (lg, c, 'active', gw);
  insert into cashford.league_members (league_id, user_id) values (lg, u1);
  insert into cashford.member_competitions (league_id, user_id, competition_id, eligible_from_gameweek_id)
  values (lg, u1, c, gw);
  insert into cashford.league_invites (league_id, token, short_code, created_by)
  values (lg, 'r2-lifecycle-token', 'R2LIFE01', u1);
  insert into r2_ids values ('l_life', lg) on conflict (k) do update set v = excluded.v;

  insert into r2_ids values ('c', c), ('gw', gw), ('f1', f1), ('f2', f2), ('f3', f3),
    ('l_exp', l_exp), ('l_dirty', l_dirty), ('pot_exp', pot_exp), ('pot_dirty', pot_dirty),
    ('u1', u1), ('u2', u2), ('u3', u3)
  on conflict (k) do update set v = excluded.v;
end $$;

\echo '=== finding 1: the money-bearing candidates are reached even with the queue full of corrupt rows ==='
do $$
declare
  rows_out jsonb;
  n_corrupt int;
  pot_exp uuid; pot_dirty uuid;
begin
  select v into pot_exp from r2_ids where k = 'pot_exp';
  select v into pot_dirty from r2_ids where k = 'pot_dirty';

  select count(*) into n_corrupt from cashford.gameweek_contests gc
    left join cashford.gameweek_results gr on gr.gameweek_contest_id = gc.id
   where gc.status = 'settled' and gr.gameweek_contest_id is null;
  perform r2_ok(n_corrupt = 40, format('seed: %s corrupt pots exist (want 40)', n_corrupt));

  select jsonb_agg(jsonb_build_object('id', s.gameweek_contest_id, 'reason', s.reason))
    into rows_out
    from cashford.gameweek_settlement_candidates(40) s;

  -- The whole finding: with a default-sized queue and 40 unrepairable rows in it, the expired
  -- claim and the dirty pot must still be in the SAME pass. Money outranks diagnostics.
  perform r2_ok(rows_out->0->>'id' = pot_exp::text and rows_out->0->>'reason' = 'expired',
                'candidates: the abandoned claim is first');
  perform r2_ok(rows_out->1->>'id' = pot_dirty::text and rows_out->1->>'reason' = 'dirty',
                'candidates: the dirty pot is second');
  perform r2_ok((select count(*) from jsonb_array_elements(rows_out) x
                  where x->>'reason' = 'corrupt') = 38,
                'candidates: corrupt rows fill only what is left of the limit');

  -- And at the tightest possible limit, the one row returned is the one holding money.
  perform r2_ok((select gameweek_contest_id from cashford.gameweek_settlement_candidates(1)) = pot_exp,
                'candidates: a limit of 1 returns the expired claim, not the oldest corrupt row');
end $$;

\echo '=== finding 1: a filed corrupt row leaves the queue, and comes back if the issue is resolved ==='
do $$
declare
  victim uuid;
begin
  select v into victim from r2_ids where k = 'corrupt_1';
  perform r2_ok(exists (select 1 from cashford.gameweek_settlement_candidates(60) s
                         where s.gameweek_contest_id = victim),
                'suppression: an unfiled corrupt row is a candidate');

  insert into cashford.sync_issues (source, kind, ref, detail)
  values ('gameweek', 'missing-result-row', victim::text, '{}'::jsonb);

  -- This is what bounds the backlog: the worker cannot repair the row, so once the finding is
  -- on file the row stops consuming the queue.
  perform r2_ok(not exists (select 1 from cashford.gameweek_settlement_candidates(60) s
                             where s.gameweek_contest_id = victim),
                'suppression: a filed corrupt row is no longer a candidate');

  update cashford.sync_issues set resolved_at = now()
   where ref = victim::text and kind = 'missing-result-row';
  perform r2_ok(exists (select 1 from cashford.gameweek_settlement_candidates(60) s
                         where s.gameweek_contest_id = victim),
                'suppression: resolving the issue puts the row back in the queue');

  -- Leave the seed as the .mts expects it: no issues filed yet.
  delete from cashford.sync_issues where ref = victim::text and kind = 'missing-result-row';
end $$;

\echo '=== finding 2: every league lifecycle writer takes the leagues row first ==='
do $$
declare
  n int;
begin
  -- A cheap structural pin next to the real two-session proof in the .mts: both routines must
  -- reach cashford.leagues before they reach league_competitions.
  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'cashford' and p.proname in ('leave_league','archive_league')
     and position('from cashford.leagues where id = p_league_id for no key update'
                  in p.prosrc)
         < position('from cashford.league_competitions' in p.prosrc);
  perform r2_ok(n = 2, format('lock order: %s of 2 lifecycle routines lock the league row first', n));

  select count(*) into n from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'cashford'
     and p.proname in ('leave_league','archive_league','write_gameweek_entry','mirror_gameweek_entry')
     and p.prosrc like '%league_competitions%'
     and p.prosrc ~ 'cashford\.(league|member)_competitions[^;]*for update';
  -- FOR UPDATE on these rows blocks another transaction's foreign-key lock, which is the edge
  -- that closed the join/archive cycle. FOR NO KEY UPDATE excludes every real writer without it.
  perform r2_ok(n = 0, format('lock order: %s routines still take FOR UPDATE on an eligibility row', n));
end $$;

\echo '=== finding 3: the privilege pattern still holds for both changed routines ==='
do $$
declare
  bad text;
begin
  select string_agg(p.proname, ',') into bad from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'cashford'
     and p.proname in ('gameweek_settlement_candidates','claim_gameweek_settlement',
                       'leave_league','archive_league')
     and not (p.prosecdef
              and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
              and has_function_privilege('service_role', p.oid, 'execute')
              and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('authenticated', p.oid, 'execute'));
  perform r2_ok(bad is null,
                coalesce('privileges: ' || bad || ' broke the definer/search_path/grant pattern',
                         'privileges: definer + pinned search_path + service_role only'));
end $$;

\echo 'ALL ROUND-2 SQL CHECKS PASSED'
