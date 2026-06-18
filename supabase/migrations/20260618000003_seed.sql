-- Cashford — seed the two leagues (§16). Idempotent.
-- Player accounts + memberships are created post-deploy via the admin
-- create-user flow (Phase 2), since auth.users rows can't be seeded in SQL.

insert into public.leagues (name, slug, default_stake_inr) values
  ('KK Bois',  'kk-bois',  500),
  ('PES Bois', 'pes-bois', 500)
on conflict (slug) do nothing;
