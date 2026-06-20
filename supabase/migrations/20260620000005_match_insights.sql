-- ============================================================
-- match insights  (plan 2026-06-20-003)
-- 1:1 cache of ESPN-derived decision-help data per fixture, shown on the predict screen.
-- Service-role writes only (poll/refresh jobs); any authenticated user may read.
-- Everything here is derived/disposable — cascade-deletes with its fixture.
-- Additive + non-destructive: safe to apply to the shared prod DB with no downtime.
-- ============================================================
create table if not exists cashford.fixture_insights (
  fixture_id     uuid primary key references cashford.fixtures(id) on delete cascade,

  -- raw odds (regulation/90-min, from the consensus/first provider in the summary)
  ml_home        int,
  ml_draw        int,
  ml_away        int,
  total_line     numeric,
  provider       text,

  -- derived (stored so the page does no maths) — see lib/odds-model.ts
  p_home         numeric,
  p_draw         numeric,
  p_away         numeric,
  lambda_home    numeric,
  lambda_away    numeric,
  top_scores     jsonb,            -- [{h,a,p}, …] top 5, sorted desc
  p_btts         numeric,
  p_cs_home      numeric,
  p_cs_away      numeric,
  p_over         numeric,          -- P(total goals over the line); de-vigged when available

  -- raw context (all from the single summary call)
  form_home      jsonb,            -- [{result:'W',score:'2-1',opponent:'…',date:'…'}, …]
  form_away      jsonb,
  h2h            jsonb,            -- { tally:{w,d,l}, games:[{date,competition,homeScore,awayScore,result}] }
  standings      jsonb,            -- { rows:[{team,id,gp,w,d,l,gd,pts,rank}] } — the fixture's group

  -- meta
  odds_available boolean not null default false,
  fetched_at     timestamptz,

  -- guard rails: derived values must stay in their domains (nullable-safe), so a model
  -- regression can't silently persist garbage into the shared DB.
  constraint chk_insights_probs check (
    (p_home is null or (p_home between 0 and 1)) and
    (p_draw is null or (p_draw between 0 and 1)) and
    (p_away is null or (p_away between 0 and 1)) and
    (p_btts is null or (p_btts between 0 and 1)) and
    (p_cs_home is null or (p_cs_home between 0 and 1)) and
    (p_cs_away is null or (p_cs_away between 0 and 1)) and
    (p_over is null or (p_over between 0 and 1))
  ),
  constraint chk_insights_1x2_sum check (
    p_home is null or abs(p_home + p_draw + p_away - 1) < 0.01
  )
);

alter table cashford.fixture_insights enable row level security;

-- mirror teams_select / fixtures_select (20260618000002): authenticated read-only.
-- No insert/update/delete policy → only service_role (which bypasses RLS) can write.
create policy fixture_insights_select on cashford.fixture_insights
  for select to authenticated using (true);

grant all    on cashford.fixture_insights to service_role;
grant select on cashford.fixture_insights to authenticated;
-- The schema's blanket `grant all … to anon, authenticated` (20260618000002) would otherwise grant
-- DML here; intent is service-role-writes-only, so revoke it (RLS already blocks rows, this matches
-- the grant posture to intent and stops a future stray INSERT policy from silently working).
revoke insert, update, delete on cashford.fixture_insights from anon, authenticated;
