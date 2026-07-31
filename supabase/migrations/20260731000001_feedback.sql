-- Cashford — in-app beta feedback.
-- Additive only. Apply separately when the feedback widget is ready to use.

begin;

create table cashford.feedback (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  user_id     uuid not null references auth.users(id),
  path        text not null,
  league_slug text,
  message     text not null check (char_length(message) between 1 and 2000),
  app_version int,
  resolved_at timestamptz
);

create index feedback_user_created_at_idx
  on cashford.feedback (user_id, created_at desc);

alter table cashford.feedback enable row level security;

create policy feedback_insert on cashford.feedback
  for insert to authenticated
  with check (user_id = auth.uid());

-- The schema-wide default grant is broader than this table's boundary. Feedback is
-- written by the server action and reviewed with the service-role client only.
revoke all on cashford.feedback from anon, authenticated;
grant insert on cashford.feedback to authenticated;
grant all on cashford.feedback to service_role;

commit;
