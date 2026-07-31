-- Phase 2 code review, ROUND 3. Two findings, both only reachable against a real Postgres.
--
--   Finding 1  an expired claim must be reclaimed or released, never left as a permanent
--              top-priority candidate. 40 abandoned claims on 0/1-entrant pots were REFUSED
--              ("fewer than 2 locked-in entries") before expiry was even calculated, so they
--              came back at rank 0 on every pass and the dirty pot behind them never ran.
--   Finding 2  the writer lock graph must stay acyclic when a current member joins again while
--              maintenance is resolving that member's null eligibility boundary.
--
-- This file seeds the population and pins the routine-level contract. The parts that need the
-- real worker or two sessions — dispatcher passes, and maintenance vs a repeated join in both
-- interleavings — are in scripts/disposable-db/round3-proof.mts, which runs after this file and
-- reads r3_ids.
--
-- Counts here are exact and the dispatcher scans globally, so this needs a FRESH cluster: run it
-- straight after up.sh, not after round2-test.sql or another seed. The guard below fails loudly.
--
-- Usage (disposable cluster ONLY — it writes 43 deliberately stuck rows):
--   scripts/disposable-db/up.sh
--   PGPASSWORD=postgres psql -h localhost -p 55432 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f scripts/disposable-db/round3-test.sql
--   node scripts/disposable-db/round3-proof.mts
\set ON_ERROR_STOP on

create or replace function r3_ok(cond boolean, label text) returns void
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
    raise exception 'round3-test needs a fresh cluster: % gameweek pots already exist. Run scripts/disposable-db/up.sh first.', n;
  end if;
end $$;

-- ---------------------------------------------------------------- seed
-- Competition A: one finished gameweek. 40 pots stuck in 'settling' past the claim lifetime with
-- 0 or 1 locked-in entries (the population the worker can never settle), 3 more of the same for
-- this file's own probes, and one dirty pot holding real money. The stuck pots carry the OLDEST
-- deadlines, so any ordering that likes them keeps liking them.
--
-- Competition B: a live competition with a FUTURE gameweek, used only by the maintenance-vs-join
-- interleavings in the .mts. Separate competition so maintenance there cannot touch the pots above.
do $$
declare
  c uuid; gw uuid; c2 uuid; gw2 uuid;
  t1 uuid; t2 uuid; t3 uuid; t4 uuid; t5 uuid; t6 uuid;
  f1 uuid; f2 uuid; f3 uuid;
  m1 uuid; m2 uuid; m3 uuid;
  lg uuid; pot uuid; e uuid;
  l_dirty uuid; pot_dirty uuid;
  i int;
  u1 uuid := '00000000-0000-0000-0000-0000000003a1';
  u2 uuid := '00000000-0000-0000-0000-0000000003a2';
  u3 uuid := '00000000-0000-0000-0000-0000000003a3';
begin
  insert into cashford.competitions (slug, name, format, season, fpl_source, status)
  values ('r3-pl', 'Round3 PL', 'league', '2026/27', true, 'active') returning id into c;

  insert into cashford.gameweeks (competition_id, number, name, deadline_at, fpl_event_id, status)
  values (c, 1, 'R3 GW1', now() - interval '3 days', 41, 'locked') returning id into gw;

  insert into cashford.teams (name, short_name) values ('Y1','Y1') returning id into t1;
  insert into cashford.teams (name, short_name) values ('Y2','Y2') returning id into t2;
  insert into cashford.teams (name, short_name) values ('Y3','Y3') returning id into t3;
  insert into cashford.teams (name, short_name) values ('Y4','Y4') returning id into t4;
  insert into cashford.teams (name, short_name) values ('Y5','Y5') returning id into t5;
  insert into cashford.teams (name, short_name) values ('Y6','Y6') returning id into t6;

  -- Every fixture finished with a score, so readiness is not what is holding anything up.
  insert into cashford.fixtures (competition_id, fpl_fixture_id, external_id, kickoff_at,
                                 home_team_id, away_team_id, status, ft_home, ft_away)
  values (c, 41, 9041, now() - interval '2 days', t1, t2, 'finished', 2, 1) returning id into f1;
  insert into cashford.fixtures (competition_id, fpl_fixture_id, external_id, kickoff_at,
                                 home_team_id, away_team_id, status, ft_home, ft_away)
  values (c, 42, 9042, now() - interval '2 days', t3, t4, 'finished', 0, 0) returning id into f2;
  insert into cashford.fixtures (competition_id, fpl_fixture_id, external_id, kickoff_at,
                                 home_team_id, away_team_id, status, ft_home, ft_away)
  values (c, 43, 9043, now() - interval '2 days', t5, t6, 'finished', 1, 3) returning id into f3;

  insert into cashford.gameweek_fixtures (gameweek_id, fixture_id, competition_id, state, is_current)
  values (gw, f1, c, 'active', true) returning id into m1;
  insert into cashford.gameweek_fixtures (gameweek_id, fixture_id, competition_id, state, is_current)
  values (gw, f2, c, 'active', true) returning id into m2;
  insert into cashford.gameweek_fixtures (gameweek_id, fixture_id, competition_id, state, is_current)
  values (gw, f3, c, 'active', true) returning id into m3;

  insert into auth.users (id, email) values (u1,'r3a@t.test'), (u2,'r3b@t.test'), (u3,'r3c@t.test');

  create table if not exists r3_ids (k text primary key, v uuid);

  -- 43 abandoned claims: 40 for the dispatcher proof plus 3 probes this file consumes. Half have
  -- no entrants at all, half have exactly one — both are pots the claim path must refuse, which is
  -- precisely why refusing them was not enough.
  for i in 1..43 loop
    insert into cashford.leagues (name, slug, default_stake_inr, created_by)
    values ('R3 Stuck ' || i, 'r3-stuck-' || i, 100, u1) returning id into lg;
    insert into cashford.league_competitions (league_id, competition_id, status, eligible_from_gameweek_id)
    values (lg, c, 'active', gw);
    insert into cashford.league_members (league_id, user_id) values (lg, u1);
    insert into cashford.member_competitions (league_id, user_id, competition_id, eligible_from_gameweek_id)
    values (lg, u1, c, gw);

    if i = 43 then
      -- The incoherent variant: 'settling' with no claim stamp at all. No worker can be holding
      -- it (the triad is written in one statement), so it is abandoned by definition. Before this
      -- round neither the scan nor the claim routine called it expired and it was stuck for good.
      insert into cashford.gameweek_contests
        (league_id, gameweek_id, competition_id, stake_inr, deadline_at, status, input_version)
      values (lg, gw, c, 100, now() - interval '30 days', 'settling', 1) returning id into pot;
    else
      insert into cashford.gameweek_contests
        (league_id, gameweek_id, competition_id, stake_inr, deadline_at, status, input_version,
         claim_token, claim_started_at, claim_input_version, claim_prior_status)
      values (lg, gw, c, 100, now() - interval '30 days', 'settling', 1,
              gen_random_uuid(), now() - interval '25 minutes', 1, 'locked') returning id into pot;
    end if;

    -- Odd rows get their single entrant; even rows get none.
    if i % 2 = 1 then
      insert into cashford.gameweek_entries
        (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
      values (pot, lg, gw, c, u1, 'locked_in') returning id into e;
      insert into cashford.gameweek_picks
        (entry_id, membership_id, gameweek_id, fixture_id, competition_id, pred_home, pred_away)
      values (e, m1, gw, f1, c, 2, 1), (e, m2, gw, f2, c, 0, 0), (e, m3, gw, f3, c, 1, 3);
    end if;

    insert into r3_ids values ('stuck_' || i, pot) on conflict (k) do update set v = excluded.v;
  end loop;

  -- The money-bearing row that starved: settled, then its input moved.
  insert into cashford.leagues (name, slug, default_stake_inr, created_by)
  values ('R3 Dirty', 'r3-dirty', 100, u1) returning id into l_dirty;
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

  insert into cashford.gameweek_entries
    (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
  values (pot_dirty, l_dirty, gw, c, u1, 'locked_in') returning id into e;
  insert into cashford.gameweek_picks
    (entry_id, membership_id, gameweek_id, fixture_id, competition_id, pred_home, pred_away)
  values (e, m1, gw, f1, c, 2, 1), (e, m2, gw, f2, c, 0, 0), (e, m3, gw, f3, c, 1, 3);
  insert into cashford.gameweek_entries
    (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
  values (pot_dirty, l_dirty, gw, c, u2, 'locked_in') returning id into e;
  insert into cashford.gameweek_picks
    (entry_id, membership_id, gameweek_id, fixture_id, competition_id, pred_home, pred_away)
  values (e, m1, gw, f1, c, 0, 3), (e, m2, gw, f2, c, 2, 2), (e, m3, gw, f3, c, 4, 0);

  -- Competition B + the league used by the lifecycle interleavings. The member's boundary is NULL,
  -- which is the state maintenance resolves and the state a repeated join collides with.
  insert into cashford.competitions (slug, name, format, season, fpl_source, status)
  values ('r3-life', 'Round3 Life', 'league', '2026/27', true, 'active') returning id into c2;
  insert into cashford.gameweeks (competition_id, number, name, deadline_at, fpl_event_id, status)
  values (c2, 1, 'R3L GW1', now() + interval '3 days', 51, 'upcoming') returning id into gw2;

  insert into cashford.leagues (name, slug, default_stake_inr, created_by)
  values ('R3 Lifecycle', 'r3-lifecycle', 100, u1) returning id into lg;
  insert into cashford.league_competitions (league_id, competition_id, status, eligible_from_gameweek_id)
  values (lg, c2, 'active', null);
  insert into cashford.league_members (league_id, user_id) values (lg, u3);
  insert into cashford.member_competitions (league_id, user_id, competition_id, eligible_from_gameweek_id)
  values (lg, u3, c2, null);
  insert into cashford.league_invites (league_id, token, short_code, created_by)
  values (lg, 'r3-life-token', 'R3LIFE01', u1);

  insert into r3_ids values ('c', c), ('gw', gw), ('c2', c2), ('gw2', gw2),
    ('l_dirty', l_dirty), ('pot_dirty', pot_dirty), ('l_life', lg),
    ('u1', u1), ('u2', u2), ('u3', u3)
  on conflict (k) do update set v = excluded.v;
end $$;

\echo '=== finding 1: the trap — abandoned claims own the whole queue while they are only refused ==='
do $$
declare
  rows_out jsonb;
  n_stuck int;
  pot_dirty uuid;
begin
  select v into pot_dirty from r3_ids where k = 'pot_dirty';

  select count(*) into n_stuck from cashford.gameweek_contests gc
   where gc.status = 'settling'
     and (select count(*) from cashford.gameweek_entries e
           where e.gameweek_contest_id = gc.id and e.status = 'locked_in') < 2;
  perform r3_ok(n_stuck = 43, format('seed: %s abandoned claims on 0/1-entrant pots (want 43)', n_stuck));

  select jsonb_agg(jsonb_build_object('id', s.gameweek_contest_id, 'reason', s.reason))
    into rows_out from cashford.gameweek_settlement_candidates(40) s;

  -- The scan is RIGHT to report these: releasing them is the only way they ever clear. What used
  -- to be wrong is that nothing cleared them, so this pass repeated forever.
  perform r3_ok((select count(*) from jsonb_array_elements(rows_out) x
                  where x->>'reason' = 'expired') = 40,
                'candidates: a full queue of expired claims, exactly as the failing case describes');
  perform r3_ok(not exists (select 1 from jsonb_array_elements(rows_out) x
                             where x->>'id' = pot_dirty::text),
                'candidates: the dirty pot is NOT in this pass — so it must be in the next one');
end $$;

\echo '=== finding 1: a refusal never leaves a row in settling ==='
do $$
declare
  r jsonb; probe uuid; st text; n int;
begin
  -- Zero entrants (even rows got none).
  select v into probe from r3_ids where k = 'stuck_42';
  select cashford.claim_gameweek_settlement(probe) into r;
  select status into st from cashford.gameweek_contests where id = probe;
  perform r3_ok((r->>'claimed') = 'false' and (r->>'released') = 'true'
                and r->>'reason' like '%fewer than 2%',
                format('claim: a 0-entrant abandoned claim is released, not refused (%s)', r->>'reason'));
  perform r3_ok(st = 'locked', format('claim: the row left settling and went back to locked (%s)', st));
  perform r3_ok(exists (select 1 from cashford.gameweek_audit_log
                         where gameweek_contest_id = probe and action = 'abort'
                           and detail->>'released' = 'expired-under-min-entrants'),
                'claim: the release is on the audit log with its reason');

  -- One entrant (odd rows got exactly one).
  select v into probe from r3_ids where k = 'stuck_41';
  select cashford.claim_gameweek_settlement(probe) into r;
  select status into st from cashford.gameweek_contests where id = probe;
  perform r3_ok((r->>'released') = 'true' and st = 'locked' and (r->>'locked_in') = '1',
                'claim: a 1-entrant abandoned claim is released too');

  -- No claim stamp at all.
  select v into probe from r3_ids where k = 'stuck_43';
  perform r3_ok((select reason from cashford.gameweek_settlement_candidates(60) s
                  where s.gameweek_contest_id = probe) = 'expired',
                'candidates: a settling row with no claim stamp is reported as expired');
  select cashford.claim_gameweek_settlement(probe) into r;
  select status into st from cashford.gameweek_contests where id = probe;
  perform r3_ok((r->>'released') = 'true' and st = 'locked',
                'claim: a settling row with no claim stamp is released, not left stuck');

  -- And a released row does not come straight back: it is a 0/1-entrant locked pot now, which the
  -- readiness gate excludes. Otherwise the release would just be a slower loop.
  select count(*) into n from cashford.gameweek_settlement_candidates(60) s
   where s.gameweek_contest_id in (select v from r3_ids where k in ('stuck_41','stuck_42','stuck_43'));
  perform r3_ok(n = 0, format('candidates: %s of the 3 released rows came back (want 0)', n));

  select count(*) into n from cashford.gameweek_contests where status = 'settling';
  perform r3_ok(n = 40, format('seed hand-off: %s abandoned claims left for the .mts (want 40)', n));
end $$;

\echo '=== finding 1: the release-or-reclaim rule is structural, not one patched branch ==='
do $$
declare
  claim_src text; scan_src text; n int;
begin
  select prosrc into claim_src from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'cashford' and p.proname = 'claim_gameweek_settlement';
  select prosrc into scan_src from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'cashford' and p.proname = 'gameweek_settlement_candidates';

  -- Expiry has to be decided before the first validation gate, or the next validation added ahead
  -- of it re-opens the same hole. This is the class fix, and this is the pin on it.
  perform r3_ok(position('v_expired :=' in claim_src) < position('v_locked_in < 2' in claim_src),
                'claim: expiry is calculated before the minimum-entrant gate');

  -- Both refusals that can be reached while status = 'settling' go through the one release path.
  n := (length(claim_src) - length(replace(claim_src, 'release_expired_gameweek_claim', '')))
       / length('release_expired_gameweek_claim');
  perform r3_ok(n = 2, format('claim: %s refusal paths release through the shared routine (want 2)', n));

  -- The two definitions of "expired" must be the same one, including the missing-stamp case.
  perform r3_ok(claim_src like '%claim_started_at is null%'
                and scan_src like '%claim_started_at is null%',
                'claim + scan: both treat a settling row with no claim stamp as abandoned');
end $$;

\echo '=== finding 2: no routine takes a leagues row stronger than FOR NO KEY UPDATE ==='
do $$
declare
  bad text; jsrc text;
begin
  -- FOR UPDATE on a league row blocks the FOR KEY SHARE that another transaction's foreign-key
  -- insert needs — that is the edge maintenance was caught on.
  select string_agg(p.proname, ',') into bad from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'cashford'
     and p.prosrc ~ 'cashford\.leagues[^;]*for update';
  perform r3_ok(bad is null,
                coalesce('lock strength: ' || bad || ' still locks a leagues row FOR UPDATE',
                         'lock strength: every routine takes the leagues row FOR NO KEY UPDATE'));

  select prosrc into jsrc from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'cashford' and p.proname = 'join_league';
  perform r3_ok(jsrc like '%for no key update%', 'join_league: the deployed body has the weaker lock');
  -- The replacement is lock strength ONLY: the archived check and both idempotent inserts stay.
  perform r3_ok(jsrc like '%join_league: league is archived%'
                and jsrc like '%on conflict (league_id, user_id) do nothing%'
                and jsrc like '%on conflict (league_id, user_id, competition_id) do nothing%',
                'join_league: same guards and same idempotent inserts as Phase 1');
end $$;

\echo '=== privileges: the pattern holds for the new and replaced routines ==='
do $$
declare
  bad text;
begin
  select string_agg(p.proname, ',') into bad from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'cashford'
     and p.proname in ('release_expired_gameweek_claim','claim_gameweek_settlement',
                       'gameweek_settlement_candidates')
     and not (p.prosecdef
              and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
              and has_function_privilege('service_role', p.oid, 'execute')
              and not has_function_privilege('anon', p.oid, 'execute')
              and not has_function_privilege('authenticated', p.oid, 'execute'));
  perform r3_ok(bad is null,
                coalesce('privileges: ' || bad || ' broke the definer/search_path/service_role pattern',
                         'privileges: service-role routines are definer, pinned, service_role only'));

  -- join_league is user-facing: authenticated may call it, anon may not.
  select string_agg(p.proname, ',') into bad from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'cashford' and p.proname = 'join_league'
     and not (p.prosecdef
              and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
              and has_function_privilege('authenticated', p.oid, 'execute')
              and has_function_privilege('service_role', p.oid, 'execute')
              and not has_function_privilege('anon', p.oid, 'execute'));
  perform r3_ok(bad is null,
                coalesce('privileges: ' || bad || ' lost the user-facing grant pattern',
                         'privileges: join_league is definer, pinned, authenticated + service_role'));
end $$;

\echo 'ALL ROUND-3 SQL CHECKS PASSED'
