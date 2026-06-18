-- Cashford — schema (plan §5 + constraints §17.5)
-- All app objects live in a dedicated `cashford` schema (not public).
-- All timestamps are timestamptz (UTC); render local in the client.

-- ============================================================
-- Dedicated schema + role grants (so PostgREST/anon/authenticated can reach it;
-- RLS still restricts row access, service_role bypasses RLS).
-- The schema must ALSO be added to the project's Exposed Schemas (API settings).
-- ============================================================
create schema if not exists cashford;

grant usage on schema cashford to anon, authenticated, service_role;

-- Future objects created by postgres in this schema inherit these grants.
alter default privileges in schema cashford
  grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema cashford
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema cashford
  grant all on routines  to anon, authenticated, service_role;

-- ============================================================
-- profiles  (1:1 with auth.users; the must_change_password flag lives in
--            auth.users.raw_user_meta_data, not here — single source of truth §17.4)
-- ============================================================
create table if not exists cashford.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  display_name text,
  timezone     text,                              -- IANA, e.g. America/New_York
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- leagues
-- ============================================================
create table if not exists cashford.leagues (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text unique not null,
  default_stake_inr int  not null default 500 check (default_stake_inr > 0),
  status            text not null default 'active' check (status in ('active','archived')),
  created_at        timestamptz not null default now()
);

-- ============================================================
-- league_members  (many-to-many; ananth & utkarsh are in both)
-- ============================================================
create table if not exists cashford.league_members (
  league_id uuid not null references cashford.leagues(id)  on delete restrict,
  user_id   uuid not null references cashford.profiles(id) on delete restrict,
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index if not exists idx_league_members_user   on cashford.league_members(user_id);
create index if not exists idx_league_members_league on cashford.league_members(league_id);

-- ============================================================
-- teams  (synced from API-Football)
-- ============================================================
create table if not exists cashford.teams (
  id          uuid primary key default gen_random_uuid(),
  external_id int unique not null,
  name        text not null,
  short_name  text,
  flag_url    text,
  fifa_code   text
);

-- ============================================================
-- fixtures  (104 WC2026 matches; knockout teams resolve from TBD)
-- ============================================================
create table if not exists cashford.fixtures (
  id                    uuid primary key default gen_random_uuid(),
  external_id           int  unique not null,
  round                 text not null check (round in ('group','r32','r16','qf','sf','final','third')),
  group_label           text,
  is_knockout           boolean not null default false,
  home_team_id          uuid references cashford.teams(id) on delete set null,
  away_team_id          uuid references cashford.teams(id) on delete set null,
  home_label            text,                      -- e.g. "Winner Group A" while TBD
  away_label            text,
  venue                 text,
  venue_tz              text,
  kickoff_at            timestamptz not null,
  status                text not null default 'scheduled'
                          check (status in ('scheduled','live','finished','postponed','cancelled','abandoned')),
  status_detail         text,                      -- raw API short code (NS,1H,HT,FT,AET,PEN,...)
  minute                int,
  ht_home               int,
  ht_away               int,
  ft_home               int,                       -- end-of-90 (regulation) = grading scoreline
  ft_away               int,
  et_home               int,
  et_away               int,
  pen_home              int,
  pen_away              int,
  advancer_team_id      uuid references cashford.teams(id) on delete set null,
  finished_at           timestamptz,
  finished_confirmed_at timestamptz,               -- set on 2nd consecutive finished poll (§17.6)
  updated_at            timestamptz not null default now(),

  constraint chk_scores_nonneg check (
    (ht_home  is null or ht_home  >= 0) and (ht_away  is null or ht_away  >= 0) and
    (ft_home  is null or ft_home  >= 0) and (ft_away  is null or ft_away  >= 0) and
    (et_home  is null or et_home  >= 0) and (et_away  is null or et_away  >= 0) and
    (pen_home is null or pen_home >= 0) and (pen_away is null or pen_away >= 0)
  ),
  constraint chk_advancer_participant check (
    advancer_team_id is null
    or advancer_team_id = home_team_id
    or advancer_team_id = away_team_id
  ),
  constraint chk_advancer_ko_only check (advancer_team_id is null or is_knockout),
  constraint chk_pen_consistency check (
    status_detail is distinct from 'PEN' or (pen_home is not null and pen_away is not null)
  )
);
create index if not exists idx_fixtures_status  on cashford.fixtures(status);
create index if not exists idx_fixtures_kickoff on cashford.fixtures(kickoff_at);

-- ============================================================
-- contests  (one per league per fixture)
-- ============================================================
create table if not exists cashford.contests (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references cashford.leagues(id)  on delete restrict,
  fixture_id   uuid not null references cashford.fixtures(id) on delete restrict,
  stake_inr    int  not null check (stake_inr > 0),
  status       text not null default 'open'
                 check (status in ('open','locked','settling','void','cancelled','settled')),
  lock_at      timestamptz not null,               -- = kickoff_at - 30 min (denormalized)
  is_knockout  boolean not null default false,      -- denormalized for the no-draw guard / UI
  void_reason  text,
  settled_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (league_id, fixture_id)
);
create index if not exists idx_contests_lock    on cashford.contests(lock_at);
create index if not exists idx_contests_status  on cashford.contests(status);
create index if not exists idx_contests_fixture on cashford.contests(fixture_id);

-- ============================================================
-- predictions  (one per player per contest; immutable after lock)
-- ============================================================
create table if not exists cashford.predictions (
  id         uuid primary key default gen_random_uuid(),
  contest_id uuid not null references cashford.contests(id) on delete restrict,
  user_id    uuid not null references cashford.profiles(id) on delete restrict,
  outcome    text not null check (outcome in ('home','draw','away')),
  pred_home  int  not null check (pred_home >= 0),
  pred_away  int  not null check (pred_away >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (contest_id, user_id)
);
create index if not exists idx_predictions_contest_user on cashford.predictions(contest_id, user_id);

-- ============================================================
-- contest_results  (per player per contest — drives net leaderboard)
-- ============================================================
create table if not exists cashford.contest_results (
  contest_id    uuid not null references cashford.contests(id) on delete restrict,
  user_id       uuid not null references cashford.profiles(id) on delete restrict,
  result        text not null check (result in ('win','loss','push','not_entered','void')),
  net_inr       int  not null default 0,            -- derived: Σ(inbound)−Σ(outbound) transfers
  tiebreak_rank int,
  graded_at     timestamptz not null default now(),
  primary key (contest_id, user_id)
);

-- ============================================================
-- transfers  (directed loser→winner; drives pairwise dues)
--   corrections soft-delete via reversed=true — all reads filter reversed=false
-- ============================================================
create table if not exists cashford.transfers (
  id           uuid primary key default gen_random_uuid(),
  contest_id   uuid not null references cashford.contests(id) on delete restrict,
  league_id    uuid not null references cashford.leagues(id)  on delete restrict,
  from_user_id uuid not null references cashford.profiles(id) on delete restrict,
  to_user_id   uuid not null references cashford.profiles(id) on delete restrict,
  amount_inr   int  not null check (amount_inr > 0),
  reversed     boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint chk_transfer_distinct_users check (from_user_id <> to_user_id)
);
create index if not exists idx_transfers_league  on cashford.transfers(league_id) where reversed = false;
create index if not exists idx_transfers_contest on cashford.transfers(contest_id);

-- ============================================================
-- contest_audit_log  (who re-graded / cancelled what, when, why)
-- ============================================================
create table if not exists cashford.contest_audit_log (
  id           uuid primary key default gen_random_uuid(),
  contest_id   uuid references cashford.contests(id) on delete restrict,
  action       text not null,
  triggered_by uuid references cashford.profiles(id),
  note         text,
  created_at   timestamptz not null default now()
);
