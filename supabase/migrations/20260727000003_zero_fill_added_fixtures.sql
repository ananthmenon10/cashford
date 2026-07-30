-- Decision #42: an active fixture added to an unfrozen gameweek gives every existing entry
-- a 0-0 pick. The defensive needs_update / invalid states remain available for other forms
-- of incomplete data, but a normal FPL fixture add no longer creates either state.
--
-- This replaces only reconciliation. Lock order, lock strengths, score handling and version
-- bumps remain the Phase 2 implementation from 20260727000002.

begin;

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
  v_filled_move     int := 0;
  v_picks_filled    int := 0;
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
    select f.id as fixture_id, f.kickoff_at,
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
      -- Decide the whole destination outcome once, on transaction time. A destination that has
      -- frozen (locked/completed, deadline passed, or fixture already kicked off) records only an
      -- excluded CURRENT assignment. Otherwise it records an active assignment and fills it below.
      -- Decision #46: exclusion is final within an event; only an FPL event move can recover it.
      v_frozen := not (r.target_status in ('upcoming','open')
                       and (r.target_deadline is null or now() < r.target_deadline)
                       and (r.kickoff_at is null or now() < r.kickoff_at));

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
                                   'deadline_at', r.target_deadline,
                                   'kickoff_at', r.kickoff_at,
                                   'reason', case
                                     when r.kickoff_at is not null and r.kickoff_at <= now()
                                       then 'kickoff_passed'
                                     else 'frozen_gameweek'
                                   end));
      else
        -- The membership change owns the one input_version bump. Picks are filled only after
        -- that bump and do not call bump_gameweek_input themselves.
        v_bumped := v_bumped + cashford.bump_gameweek_input(r.target_gw_id, 'membership_change');
        v_touched_gws := v_touched_gws || r.target_gw_id;

        -- Decision #42. This branch is the exact complement of v_frozen, so every active insert
        -- fills every repairable entry. Provenance points at the new active membership. Defensive
        -- terminal states stay closed, and ON CONFLICT preserves any pick from prior membership
        -- history, including a user edit.
        insert into cashford.gameweek_picks
          (entry_id, membership_id, gameweek_id, fixture_id, competition_id,
           pred_home, pred_away)
        select e.id, v_new_id, r.target_gw_id, r.fixture_id, comp.id, 0, 0
          from cashford.gameweek_entries e
         where e.gameweek_id = r.target_gw_id
           and e.status in ('entered','needs_update')
        on conflict (entry_id, fixture_id) do nothing;
        get diagnostics v_filled_move = row_count;
        v_picks_filled := v_picks_filled + v_filled_move;

        if v_filled_move > 0 then
          insert into cashford.gameweek_audit_log
            (gameweek_contest_id, action, cause, input_version, detail)
          select e.gameweek_contest_id, 'fixture_zero_fill', 'membership_change',
                 gc.input_version,
                 jsonb_build_object(
                   'source', 'fpl',
                   'fixture_id', r.fixture_id,
                   'membership_id', v_new_id,
                   'prediction', jsonb_build_array(0, 0),
                   'entries_filled', count(*)
                 )
            from cashford.gameweek_picks p
            join cashford.gameweek_entries e on e.id = p.entry_id
            join cashford.gameweek_contests gc on gc.id = e.gameweek_contest_id
           where p.membership_id = v_new_id
             and p.fixture_id = r.fixture_id
           group by e.gameweek_contest_id, gc.input_version;
        end if;
      end if;
    end if;

    insert into cashford.fixture_moves (fixture_id, old_membership_id, new_membership_id)
    values (r.fixture_id, r.cur_id, v_new_id)
    on conflict do nothing;
    v_moves := v_moves + 1;
  end loop;

  -- The loop is query-driven because unnest of an empty array yields no rows. The dormant
  -- completeness repair still handles voids and legacy incomplete entries.
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
    'scores_applied', v_scores, 'contests_bumped', v_bumped,
    'picks_filled', v_picks_filled
  );
end;
$$;

-- CREATE OR REPLACE retains existing ACLs. Re-state the intended boundary in this migration.
revoke all on function cashford.apply_fpl_reconciliation(jsonb)
  from public, anon, authenticated;
grant execute on function cashford.apply_fpl_reconciliation(jsonb) to service_role;

commit;
