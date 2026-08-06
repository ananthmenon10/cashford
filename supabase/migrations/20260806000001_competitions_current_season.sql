-- Dual-review fix (Blocker 1b): a discriminator for "which league-format competition is the
-- one real leagues should be offered to adopt." Before this, the adopt target was resolved as
-- the globally newest active league-format competition (`order by created_at desc limit 1`),
-- which is unfixable by ordering alone — a QA mock created after the real competition (e.g.
-- zzp1-mock-pl, created 2026-08-05, vs. the real pl-2026-27, created 2026-07-27) always wins
-- that ordering and would bind a real captain's adopt click to the mock.
--
-- NOT APPLIED — write-only per team-lead's constraint. Apply via the Management API after
-- re-review:
--   SCRATCH=/tmp; PAT=$SUPABASE_ACCESS_TOKEN; REF=fwqgyycqnslafpcetjqo
--   python3 -c "import json;open('$SCRATCH/b.json','w').write(json.dumps({'query':open('supabase/migrations/20260806000001_competitions_current_season.sql').read()}))"
--   curl -s -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
--     -H "Authorization: Bearer $PAT" -H "Content-Type: application/json" --data @"$SCRATCH/b.json"
--
-- Code-side degrade: lib/wc-live-competition.ts's resolveCurrentSeasonCompetition() catches
-- Postgres 42703 ("column does not exist") and returns null — every league sees "nothing to
-- adopt" (no CTA) until this migration lands, never a fallback to the old ordering.

alter table cashford.competitions
  add column if not exists is_current_season boolean not null default false;

-- Micro-round fix: at most one competition can ever be flagged is_current_season. Without this,
-- a rerun of this migration after a future season rollover (a new row flagged true, forgetting
-- to unset the old one) would leave two rows true — pickCurrentSeasonCompetition() and its
-- test only pin behavior for zero or one flagged row, not two, so that state is undefined at
-- the call site, not just at the DB level.
create unique index if not exists competitions_one_current_season
  on cashford.competitions ((is_current_season))
  where is_current_season;

-- Self-correcting form: sets pl-2026-27 true and every other row false in the same statement,
-- rather than only ever setting pl-2026-27 true and relying on every other row already being
-- false. Safe to rerun after a season rollover — rerunning with a new slug here is what performs
-- the rollover, and the unset half happens automatically instead of needing a second statement.
update cashford.competitions
  set is_current_season = (slug = 'pl-2026-27');
