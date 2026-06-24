-- Cashford — self-serve accounts, league creation & invite-link joining (Phase 0: schema).
-- Plan: docs/plans/2026-06-24-001-feat-accounts-league-creation-invite-join-plan.md
--
-- Additive + safe on the single shared DB:
--   1. leagues.created_by  — the league captain (= creator). Backfilled to ananth for the
--      3 existing leagues, then made NOT NULL.
--   2. leagues stake floor — a stricter named CHECK (>= 50) alongside the existing (> 0).
--   3. league_invites      — one active invite per league (opaque token + 8-char short code).
--   4. RLS                 — enabled with NO policies (deny-all to authenticated/anon;
--      service_role bypasses), matching the contest_audit_log convention. All invite reads/
--      writes go through the service-role client server-side.
-- Idempotent: re-running is a no-op.

begin;

-- 1. League captain = creator ------------------------------------------------
alter table cashford.leagues
  add column if not exists created_by uuid references cashford.profiles(id) on delete restrict;

-- Backfill existing leagues to ananth (the de-facto captain) before enforcing NOT NULL.
update cashford.leagues
  set created_by = (select id from cashford.profiles where username = 'ananth')
  where created_by is null;

alter table cashford.leagues
  alter column created_by set not null;

-- 2. Minimum stake ₹50 (keep the existing > 0 check; add a stricter named one) -
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'leagues_default_stake_min'
      and conrelid = 'cashford.leagues'::regclass
  ) then
    alter table cashford.leagues
      add constraint leagues_default_stake_min check (default_stake_inr >= 50);
  end if;
end $$;

-- 3. Invite tokens -----------------------------------------------------------
create table if not exists cashford.league_invites (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references cashford.leagues(id) on delete cascade,
  token       text not null unique,            -- opaque, URL: /j/<token>
  short_code  text not null unique,            -- 8-char manual entry (WhatsApp)
  created_by  uuid not null references cashford.profiles(id),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz                      -- null = active
);

-- At most one ACTIVE invite per league. (token & short_code already get unique indexes
-- from their UNIQUE constraints, so no extra lookup index is needed.)
create unique index if not exists uq_league_invite_active
  on cashford.league_invites (league_id) where revoked_at is null;

-- Backfill one active invite per existing league (uses the league's captain as creator).
-- gen_random_uuid() is built-in (no pgcrypto dependency); 64-hex token, 8-hex upper short code.
insert into cashford.league_invites (league_id, token, short_code, created_by)
select l.id,
       replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
       upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
       l.created_by
from cashford.leagues l
where not exists (
  select 1 from cashford.league_invites i
  where i.league_id = l.id and i.revoked_at is null
);

-- 4. RLS: deny-all to authenticated/anon; service_role bypasses (contest_audit_log pattern).
alter table cashford.league_invites enable row level security;

commit;
