-- Runs once, before the migrations loop, on a fresh disposable DB only.
--
-- Migration 20260624000006_accounts_leagues_invites.sql backfills leagues.created_by to
-- the profile named 'ananth' — a precondition that was already true in prod (ananth's
-- account predates that migration) but does not exist on a brand-new database. This seeds
-- the minimal auth.users row so the on_auth_user_created trigger mirrors a matching
-- 'ananth' profile before that migration runs, replicating prod's real history instead of
-- editing the migration file itself.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  'ananth@cashford.internal',
  '',
  now(),
  '{"provider":"email","providers":["email"]}',
  '{"username":"ananth","display_name":"Ananth"}',
  now(), now()
)
on conflict (email) do nothing;
