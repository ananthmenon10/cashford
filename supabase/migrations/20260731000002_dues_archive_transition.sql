-- Cashford Phase 5: Dues 2.0, archive guards, and World Cup → Premier League adoption.
-- Forward-only. This file is written for review and is not applied by the Phase 5 agent.

begin;

-- -----------------------------------------------------------------------------
-- 1. Membership lifecycle and payment facts
-- -----------------------------------------------------------------------------
alter table cashford.league_members add column if not exists left_at timestamptz;
alter table cashford.member_competitions add column if not exists left_at timestamptz;
alter table cashford.league_competitions
  add column if not exists adoption_client_request_id uuid,
  add column if not exists adopted_stake_inr int;

alter table cashford.league_competitions
  drop constraint if exists chk_league_adoption_shape;
alter table cashford.league_competitions
  add constraint chk_league_adoption_shape check (
    (adoption_client_request_id is null and adopted_stake_inr is null)
    or (adoption_client_request_id is not null and adopted_stake_inr between 50 and 1000000)
  );
create unique index if not exists uq_league_adoption_request
  on cashford.league_competitions(league_id, adoption_client_request_id)
  where adoption_client_request_id is not null;

create table if not exists cashford.payments (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references cashford.leagues(id) on delete restrict,
  kind text not null check (kind in ('payment','reversal')),
  payer_user_id uuid not null references cashford.profiles(id) on delete restrict,
  receiver_user_id uuid not null references cashford.profiles(id) on delete restrict,
  amount_inr int not null check (amount_inr between 1 and 100000000),
  paid_on date not null,
  note text check (note is null or char_length(note) <= 240),
  logged_by uuid not null references cashford.profiles(id) on delete restrict,
  logged_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','disputed','confirmed','cancelled')),
  status_changed_at timestamptz not null default now(),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  required_payer_confirmation boolean not null,
  required_receiver_confirmation boolean not null,
  reverses_payment_id uuid references cashford.payments(id) on delete restrict,
  client_request_id uuid not null,
  constraint chk_payment_parties_distinct check (payer_user_id <> receiver_user_id),
  constraint chk_payment_confirmation_required check (required_payer_confirmation or required_receiver_confirmation),
  constraint chk_payment_kind_link check ((kind = 'payment') = (reverses_payment_id is null)),
  constraint chk_payment_confirmed_at check (confirmed_at is null or status = 'confirmed'),
  constraint chk_payment_cancelled_at check (cancelled_at is null or status = 'cancelled')
);

create table if not exists cashford.payment_confirmations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references cashford.payments(id) on delete restrict,
  actor_user_id uuid not null references cashford.profiles(id) on delete restrict,
  action text not null check (action in ('confirm','dispute','cancel')),
  from_status text not null check (from_status in ('pending','disputed','confirmed','cancelled')),
  to_status text not null check (to_status in ('pending','disputed','confirmed','cancelled')),
  created_at timestamptz not null default now(),
  client_request_id uuid not null
);

create unique index if not exists uq_payment_request
  on cashford.payments(logged_by, client_request_id);
create unique index if not exists uq_live_payment_reversal
  on cashford.payments(reverses_payment_id)
  where kind = 'reversal' and status in ('pending','confirmed');
create index if not exists idx_payments_league_time on cashford.payments(league_id, logged_at desc);
create index if not exists idx_payments_party on cashford.payments(payer_user_id, receiver_user_id);
create index if not exists idx_payments_attention on cashford.payments(league_id, status)
  where status in ('pending','disputed');
create unique index if not exists uq_payment_confirmation_request
  on cashford.payment_confirmations(actor_user_id, client_request_id);
create index if not exists idx_payment_confirmations_payment_time
  on cashford.payment_confirmations(payment_id, created_at, id);
create unique index if not exists uq_open_dues_ledger_parity
  on cashford.sync_issues(ref)
  where source = 'dues' and kind = 'ledger_parity' and resolved_at is null;

-- -----------------------------------------------------------------------------
-- 2. Current-member helper and payment participant helpers
-- -----------------------------------------------------------------------------
create or replace function cashford.my_league_ids()
returns setof uuid
language sql security definer stable set search_path = ''
as $$
  select lm.league_id from cashford.league_members lm
   where lm.user_id = (select auth.uid()) and lm.left_at is null;
$$;

create or replace function cashford.dues_is_financial_participant(p_league_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$
  select exists (select 1 from cashford.league_members lm where lm.league_id = p_league_id and lm.user_id = p_user_id)
      or exists (select 1 from cashford.member_competitions mc where mc.league_id = p_league_id and mc.user_id = p_user_id)
      or exists (select 1 from cashford.contest_results cr join cashford.contests c on c.id = cr.contest_id where c.league_id = p_league_id and cr.user_id = p_user_id)
      or exists (select 1 from cashford.gameweek_entries ge where ge.league_id = p_league_id and ge.user_id = p_user_id)
      or exists (select 1 from cashford.payments p where p.league_id = p_league_id and (p.payer_user_id = p_user_id or p.receiver_user_id = p_user_id));
$$;

create or replace function cashford.dues_current_member(p_league_id uuid, p_user_id uuid)
returns boolean language sql security definer stable set search_path = ''
as $$ select exists (select 1 from cashford.league_members where league_id = p_league_id and user_id = p_user_id and left_at is null); $$;

-- -----------------------------------------------------------------------------
-- 3. Payment routines. All money writes are authenticated routine calls.
-- -----------------------------------------------------------------------------
drop function if exists cashford.log_payment(uuid, uuid, uuid, int, date, text, uuid, boolean);

create or replace function cashford.log_payment(
  p_league_id uuid, p_payer_user_id uuid, p_receiver_user_id uuid, p_amount_inr int,
  p_paid_on date, p_note text, p_client_request_id uuid, p_acknowledged_ids uuid[] default null
) returns table(outcome text, payment cashford.payments, matched_ids uuid[])
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid(); v_league record; v_existing cashford.payments;
  v_match cashford.payments; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_payer_required boolean; v_receiver_required boolean; v_match_key bigint;
  v_matching_ids uuid[];
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  select * into v_league from cashford.leagues where id = p_league_id for no key update;
  if not found or not cashford.dues_current_member(p_league_id, v_uid) then raise exception 'current league member required'; end if;
  if p_payer_user_id = p_receiver_user_id then raise exception 'payment parties must differ'; end if;
  if p_amount_inr is null or p_amount_inr < 1 or p_amount_inr > 100000000 then raise exception 'invalid payment amount'; end if;
  if not cashford.dues_is_financial_participant(p_league_id, p_payer_user_id)
     or not cashford.dues_is_financial_participant(p_league_id, p_receiver_user_id) then
    raise exception 'payment party is not in the league financial history';
  end if;
  if p_paid_on < (v_league.created_at at time zone 'Asia/Kolkata')::date
     or p_paid_on > (clock_timestamp() at time zone 'Asia/Kolkata')::date then raise exception 'payment date is outside the league'; end if;
  v_payer_required := v_uid <> p_payer_user_id;
  v_receiver_required := v_uid <> p_receiver_user_id;
  if not (v_payer_required or v_receiver_required) then raise exception 'a payment needs confirmation'; end if;

  select * into v_existing from cashford.payments where logged_by = v_uid and client_request_id = p_client_request_id for update;
  if found then
    if v_existing.league_id <> p_league_id or v_existing.kind <> 'payment' or v_existing.payer_user_id <> p_payer_user_id
       or v_existing.receiver_user_id <> p_receiver_user_id or v_existing.amount_inr <> p_amount_inr
       or v_existing.paid_on <> p_paid_on or v_existing.note is distinct from v_note then raise exception 'idempotency key facts changed'; end if;
    return query select 'retry', v_existing, '{}'::uuid[];
    return;
  end if;
  v_match_key := pg_catalog.hashtextextended(
    p_league_id::text || ':' || p_payer_user_id::text || ':' || p_receiver_user_id::text || ':' ||
    p_amount_inr::text || ':' || p_paid_on::text,
    0
  );
  perform pg_catalog.pg_advisory_xact_lock(v_match_key);
  -- Lock every current match before taking its ordered snapshot. The same lock is held while
  -- comparing the acknowledgement and inserting, so only the user who saw this exact set can
  -- intentionally create a duplicate.
  select coalesce(array_agg(m.id order by m.logged_at, m.id), '{}'::uuid[])
    into v_matching_ids
    from (
      select p.id, p.logged_at
        from cashford.payments p
       where p.league_id = p_league_id and p.kind = 'payment' and p.status <> 'cancelled'
         and p.payer_user_id = p_payer_user_id and p.receiver_user_id = p_receiver_user_id
         and p.amount_inr = p_amount_inr and p.paid_on = p_paid_on
       order by p.logged_at, p.id
       for update
    ) m;
  if cardinality(v_matching_ids) > 0 then
    select * into v_match from cashford.payments where id = v_matching_ids[1];
    if coalesce(cardinality(p_acknowledged_ids), 0) = 0
       or p_acknowledged_ids is distinct from v_matching_ids then
      return query select 'matching_existing', v_match, v_matching_ids;
      return;
    end if;
  elsif coalesce(cardinality(p_acknowledged_ids), 0) > 0 then
    -- A previously displayed match disappeared or the submitted facts changed. Do not turn a
    -- stale acknowledgement into an unreviewed insert; return the fresh empty set instead.
    return query select 'matching_existing', null::cashford.payments, v_matching_ids;
    return;
  end if;
  insert into cashford.payments(league_id, kind, payer_user_id, receiver_user_id, amount_inr, paid_on, note, logged_by, required_payer_confirmation, required_receiver_confirmation, client_request_id)
  values (p_league_id, 'payment', p_payer_user_id, p_receiver_user_id, p_amount_inr, p_paid_on, v_note, v_uid, v_payer_required, v_receiver_required, p_client_request_id)
  returning * into v_existing;
  return query select 'created', v_existing, '{}'::uuid[];
end; $$;

create or replace function cashford.respond_to_payment(p_payment_id uuid, p_action text, p_client_request_id uuid)
returns cashford.payments language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid(); p cashford.payments; prior cashford.payment_confirmations;
  v_latest record; v_required int; v_confirmed int; v_disputed boolean; v_status text;
begin
  if v_uid is null or p_action not in ('confirm','dispute') then raise exception 'invalid payment response'; end if;
  select * into p from cashford.payments where id = p_payment_id for update;
  if not found then raise exception 'payment not found'; end if;
  perform 1 from cashford.leagues where id = p.league_id for no key update;
  select * into prior from cashford.payment_confirmations where actor_user_id = v_uid and client_request_id = p_client_request_id for update;
  if found then
    if prior.payment_id <> p_payment_id or prior.action <> p_action then raise exception 'idempotency key scope changed'; end if;
    return p;
  end if;
  if p.status in ('confirmed','cancelled') then raise exception 'payment is terminal'; end if;
  if v_uid <> p.payer_user_id and v_uid <> p.receiver_user_id then raise exception 'payment party required'; end if;
  if (v_uid = p.payer_user_id and not p.required_payer_confirmation) or (v_uid = p.receiver_user_id and not p.required_receiver_confirmation) then raise exception 'this party does not confirm this payment'; end if;
  v_required := (case when p.required_payer_confirmation then 1 else 0 end)
             + (case when p.required_receiver_confirmation then 1 else 0 end);
  with latest as (
    select distinct on (actor_user_id) actor_user_id, action from (
      select actor_user_id, action, created_at, id from cashford.payment_confirmations where payment_id = p_payment_id
      union all select v_uid, p_action, clock_timestamp(), gen_random_uuid()
    ) events order by actor_user_id, created_at desc, id desc
  ) select count(*) filter (where action = 'confirm' and actor_user_id in (case when p.required_payer_confirmation then p.payer_user_id else null end, case when p.required_receiver_confirmation then p.receiver_user_id else null end)), coalesce(bool_or(action = 'dispute' and actor_user_id in (case when p.required_payer_confirmation then p.payer_user_id else null end, case when p.required_receiver_confirmation then p.receiver_user_id else null end)), false) into v_confirmed, v_disputed from latest;
  v_status := case when v_disputed then 'disputed' when v_confirmed = v_required then 'confirmed' else 'pending' end;
  insert into cashford.payment_confirmations(payment_id, actor_user_id, action, from_status, to_status, client_request_id)
  values (p_payment_id, v_uid, p_action, p.status, v_status, p_client_request_id);
  update cashford.payments set status = v_status, status_changed_at = clock_timestamp(), confirmed_at = case when v_status = 'confirmed' then coalesce(confirmed_at, clock_timestamp()) else null end where id = p_payment_id returning * into p;
  return p;
end; $$;

create or replace function cashford.cancel_payment(p_payment_id uuid, p_client_request_id uuid)
returns cashford.payments language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); p cashford.payments; prior cashford.payment_confirmations;
begin
  select * into p from cashford.payments where id = p_payment_id for update;
  if not found or p.logged_by <> v_uid then raise exception 'only the logger can cancel'; end if;
  perform 1 from cashford.leagues where id = p.league_id for no key update;
  select * into prior from cashford.payment_confirmations where actor_user_id = v_uid and client_request_id = p_client_request_id for update;
  if found then if prior.payment_id <> p_payment_id or prior.action <> 'cancel' then raise exception 'idempotency key scope changed'; end if; return p; end if;
  if p.status not in ('pending','disputed') then raise exception 'payment is terminal'; end if;
  insert into cashford.payment_confirmations(payment_id, actor_user_id, action, from_status, to_status, client_request_id) values (p_payment_id, v_uid, 'cancel', p.status, 'cancelled', p_client_request_id);
  update cashford.payments set status = 'cancelled', status_changed_at = clock_timestamp(), cancelled_at = clock_timestamp() where id = p_payment_id returning * into p;
  return p;
end; $$;

create or replace function cashford.reverse_payment(p_payment_id uuid, p_reason text, p_client_request_id uuid)
returns cashford.payments language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); source cashford.payments; p cashford.payments; prior cashford.payments; v_note text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into source from cashford.payments where id = p_payment_id for update;
  if not found or source.kind <> 'payment' or source.status <> 'confirmed' then raise exception 'only a confirmed ordinary payment can be reversed'; end if;
  if v_note is null then raise exception 'reversal reason is required'; end if;
  if not cashford.dues_current_member(source.league_id, v_uid) then raise exception 'current league member required'; end if;
  perform 1 from cashford.leagues where id = source.league_id for no key update;
  select * into prior from cashford.payments where logged_by = v_uid and client_request_id = p_client_request_id for update;
  if found then
    if prior.kind <> 'reversal' or prior.reverses_payment_id <> p_payment_id or prior.note <> v_note then raise exception 'idempotency key scope changed'; end if;
    return prior;
  end if;
  if exists (select 1 from cashford.payments where reverses_payment_id = p_payment_id and status in ('pending','confirmed')) then raise exception 'a live reversal already exists'; end if;
  insert into cashford.payments(league_id, kind, payer_user_id, receiver_user_id, amount_inr, paid_on, note, logged_by, required_payer_confirmation, required_receiver_confirmation, reverses_payment_id, client_request_id)
  values (source.league_id, 'reversal', source.payer_user_id, source.receiver_user_id, source.amount_inr, source.paid_on, v_note, v_uid, v_uid <> source.payer_user_id, v_uid <> source.receiver_user_id, source.id, p_client_request_id)
  returning * into p;
  return p;
end; $$;

-- -----------------------------------------------------------------------------
-- 4. Membership leave/rejoin, parity issue, and PL adoption
-- -----------------------------------------------------------------------------
create or replace function cashford.remove_league_member(p_league_id uuid, p_user_id uuid)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_left timestamptz := clock_timestamp(); v_league record;
begin
  select * into v_league from cashford.leagues where id = p_league_id for no key update;
  if not found or v_league.created_by <> v_uid then raise exception 'captain required'; end if;
  if p_user_id = v_uid then raise exception 'captain cannot be removed'; end if;
  for v_uid in select lc.competition_id from cashford.league_competitions lc where lc.league_id = p_league_id order by lc.competition_id loop
    perform cashford.lock_competition_gate(v_uid);
  end loop;
  perform cashford.lock_gameweeks(array(select gc.gameweek_id from cashford.gameweek_contests gc where gc.league_id = p_league_id));
  perform 1 from cashford.league_members where league_id = p_league_id and user_id = p_user_id for update;
  update cashford.league_members set left_at = v_left where league_id = p_league_id and user_id = p_user_id and left_at is null;
  update cashford.member_competitions set left_at = v_left where league_id = p_league_id and user_id = p_user_id and left_at is null;
  return v_left;
end; $$;

create or replace function cashford.record_dues_ledger_parity(p_league_id uuid, p_detail jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  insert into cashford.sync_issues(source, kind, ref, detail)
  values ('dues', 'ledger_parity', p_league_id::text, p_detail)
  on conflict (ref) where source = 'dues' and kind = 'ledger_parity' and resolved_at is null
  do update set detail = excluded.detail
  returning id into v_id;
  return v_id;
end; $$;

create or replace function cashford.resolve_dues_ledger_issue(p_issue_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_issue record; v_league uuid;
begin
  select * into v_issue from cashford.sync_issues where id = p_issue_id and source = 'dues' and kind = 'ledger_parity' and resolved_at is null for update;
  if not found then raise exception 'open dues issue not found'; end if;
  v_league := v_issue.ref::uuid;
  if exists (
    with result_fold as (
      select movement.user_id, sum(movement.net_inr) as net_inr
        from (
          select cr.user_id, cr.net_inr
            from cashford.contest_results cr
            join cashford.contests c on c.id = cr.contest_id
           where c.league_id = v_league
          union all
          select ge.user_id, ger.net_inr
            from cashford.gameweek_entry_results ger
            join cashford.gameweek_entries ge on ge.id = ger.entry_id
           where ge.league_id = v_league
        ) movement
       group by movement.user_id
    ), transfer_fold as (
      select movement.user_id, sum(movement.net_inr) as net_inr
        from (
          select t.from_user_id as user_id, -t.amount_inr as net_inr
            from cashford.transfers t
           where t.league_id = v_league and t.reversed = false
          union all
          select t.to_user_id as user_id, t.amount_inr as net_inr
            from cashford.transfers t
           where t.league_id = v_league and t.reversed = false
        ) movement
       group by movement.user_id
    ), users as (
      select user_id from result_fold
      union
      select user_id from transfer_fold
    ), totals as (
      select coalesce((select sum(net_inr) from result_fold), 0) as result_total,
             coalesce((select sum(net_inr) from transfer_fold), 0) as transfer_total
    ), checks as (
      select 1
        from users
        left join result_fold r using (user_id)
        left join transfer_fold t using (user_id)
       where coalesce(r.net_inr, 0) <> coalesce(t.net_inr, 0)
      union all
      select 1 from totals where result_total <> 0 or transfer_total <> 0
    )
    select 1 from checks
  ) then
    raise exception 'dues parity still broken';
  end if;
  update cashford.sync_issues set resolved_at = clock_timestamp() where id = p_issue_id;
end; $$;

create or replace function cashford.adopt_league_competition(
  p_league_id uuid, p_competition_slug text, p_ante_inr int, p_client_request_id uuid
) returns table(league_id uuid, competition_id uuid, eligible_from_gameweek_id uuid, gameweek_contest_id uuid, adopted boolean)
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_league record; v_comp record; v_comp_id uuid; v_other record; v_gw record; v_gw_id uuid; v_gw_deadline timestamptz; v_lc record; v_request_lc record; v_pot uuid;
begin
  select c.id into v_comp_id from cashford.competitions c where c.slug = p_competition_slug;
  if not found then raise exception 'unknown competition'; end if;
  perform cashford.lock_competition_gate(v_comp_id);
  select * into v_league from cashford.leagues where id = p_league_id for update;
  if not found or v_league.created_by <> v_uid then raise exception 'captain required'; end if;
  if v_league.status = 'archived' then raise exception 'league is archived'; end if;
  select * into v_comp from cashford.competitions where id = v_comp_id for update;
  if v_comp.status <> 'active' or v_comp.format <> 'league' then raise exception 'competition is not active'; end if;
  perform 1 from cashford.league_competitions lc where lc.league_id = p_league_id order by lc.competition_id for update;
  select * into v_request_lc from cashford.league_competitions lc
   where lc.league_id = p_league_id and lc.adoption_client_request_id = p_client_request_id
   for update;
  if found then
    if v_request_lc.competition_id <> v_comp.id or v_request_lc.adopted_stake_inr <> p_ante_inr then
      raise exception 'adoption idempotency facts changed';
    end if;
    select gc.id into v_pot from cashford.gameweek_contests gc
     where gc.league_id = p_league_id and gc.competition_id = v_comp.id
     order by gc.created_at desc limit 1;
    return query select p_league_id, v_comp.id, v_request_lc.eligible_from_gameweek_id, v_pot, false;
    return;
  end if;
  select * into v_lc from cashford.league_competitions lc
   where lc.league_id = p_league_id and lc.competition_id = v_comp.id
   for update;
  if found and v_lc.status = 'active' then
    select gc.id into v_pot from cashford.gameweek_contests gc
     where gc.league_id = p_league_id and gc.competition_id = v_comp.id
     order by gc.created_at desc limit 1;
    return query select p_league_id, v_comp.id, v_lc.eligible_from_gameweek_id, v_pot, false;
    return;
  end if;
  if found and v_lc.status = 'archived' then raise exception 'This league already archived %', v_comp.name; end if;
  if exists (select 1 from cashford.league_competitions lc where lc.league_id = p_league_id and lc.status = 'active') then
    select c.name into v_other from cashford.league_competitions lc join cashford.competitions c on c.id = lc.competition_id where lc.league_id = p_league_id and lc.status = 'active' limit 1;
    raise exception '% is already active for this league', v_other.name;
  end if;
  if p_ante_inr is null or p_ante_inr not between 50 and 1000000 then raise exception 'invalid ante'; end if;
  select g.* into v_gw from cashford.gameweeks g where g.competition_id = v_comp.id and g.status = 'open' and g.deadline_at > clock_timestamp() order by g.number limit 1;
  v_gw_id := v_gw.id;
  if v_gw_id is not null then perform cashford.lock_gameweeks(array[v_gw_id]); select g.* into v_gw from cashford.gameweeks g where g.id = v_gw_id; if v_gw.status <> 'open' or v_gw.deadline_at <= clock_timestamp() then v_gw_id := null; else v_gw_deadline := v_gw.deadline_at; end if; end if;
  update cashford.leagues set default_stake_inr = p_ante_inr where id = p_league_id;
  insert into cashford.league_competitions(league_id, competition_id, status, eligible_from_gameweek_id, adoption_client_request_id, adopted_stake_inr) values (p_league_id, v_comp.id, 'active', v_gw_id, p_client_request_id, p_ante_inr);
  for v_other in select lm.user_id from cashford.league_members lm where lm.league_id = p_league_id and lm.left_at is null loop
    insert into cashford.member_competitions(league_id, user_id, competition_id, eligible_from_gameweek_id) values (p_league_id, v_other.user_id, v_comp.id, v_gw_id);
  end loop;
  if v_gw_id is not null then
    insert into cashford.gameweek_contests(league_id, gameweek_id, competition_id, stake_inr, deadline_at) values (p_league_id, v_gw_id, v_comp.id, p_ante_inr, v_gw_deadline) on conflict on constraint gameweek_contests_league_id_gameweek_id_key do nothing;
    select gc.id into v_pot from cashford.gameweek_contests gc where gc.league_id = p_league_id and gc.gameweek_id = v_gw_id for update;
  end if;
  return query select p_league_id, v_comp.id, v_gw_id, v_pot, true;
end; $$;

-- Rejoin preserves the original membership identity and starts at the next future boundary.
create or replace function cashford.join_league(p_invite text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_inv record; v_league record; v_comp record; v_open uuid; v_active_count int;
begin
  select * into v_inv from cashford.league_invites where token = p_invite or short_code = upper(btrim(p_invite)) limit 1;
  if not found or v_inv.revoked_at is not null then raise exception 'join_league: invite is not active'; end if;
  select * into v_league from cashford.leagues where id = v_inv.league_id for no key update;
  if v_league.status = 'archived' then raise exception 'join_league: league is archived'; end if;
  select count(*) into v_active_count
    from cashford.league_competitions lc
    join cashford.competitions c on c.id = lc.competition_id
   where lc.league_id = v_league.id and lc.status = 'active' and c.format = 'league';
  if v_active_count = 0 then raise exception 'join_league: no active competition'; end if;
  insert into cashford.league_members(league_id, user_id) values (v_league.id, v_uid) on conflict (league_id, user_id) do update set left_at = null;
  for v_comp in select lc.competition_id from cashford.league_competitions lc join cashford.competitions c on c.id = lc.competition_id where lc.league_id = v_league.id and lc.status = 'active' and c.format = 'league' loop
    select g.id into v_open from cashford.gameweeks g where g.competition_id = v_comp.competition_id and g.status = 'open' and g.deadline_at > clock_timestamp() order by g.number limit 1;
    insert into cashford.member_competitions(league_id, user_id, competition_id, eligible_from_gameweek_id, active_from, left_at) values (v_league.id, v_uid, v_comp.competition_id, v_open, clock_timestamp(), null) on conflict (league_id, user_id, competition_id) do update set eligible_from_gameweek_id = excluded.eligible_from_gameweek_id, active_from = excluded.active_from, left_at = null;
  end loop;
  return v_league.id;
end; $$;

-- -----------------------------------------------------------------------------
-- 5. Archived-write guards and the Phase 2 mirror replacement
-- -----------------------------------------------------------------------------
create or replace function cashford.reject_archived_knockout_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tournament text;
begin
  v_tournament := case when tg_op = 'DELETE' then old.tournament_id else new.tournament_id end;
  if exists (
    select 1 from cashford.competitions c
     where c.slug = v_tournament and c.status = 'archived'
  ) then
    raise exception 'World Cup 2026 is archived. Bracket picks are read-only.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_reject_archived_knockout_prediction on cashford.knockout_predictions;
create trigger trg_reject_archived_knockout_prediction
  before insert or update or delete on cashford.knockout_predictions
  for each row execute function cashford.reject_archived_knockout_write();

drop trigger if exists trg_reject_archived_knockout_bracket on cashford.knockout_brackets;
create trigger trg_reject_archived_knockout_bracket
  before insert or update or delete on cashford.knockout_brackets
  for each row execute function cashford.reject_archived_knockout_write();

drop policy if exists predictions_insert on cashford.predictions;
create policy predictions_insert on cashford.predictions for insert to authenticated with check (
  user_id = (select auth.uid()) and cashford.password_change_done() and exists (
    select 1 from cashford.contests c join cashford.fixtures f on f.id = c.fixture_id join cashford.competitions co on co.id = f.competition_id join cashford.league_members lm on lm.league_id = c.league_id
    where c.id = predictions.contest_id and co.status <> 'archived' and lm.user_id = (select auth.uid()) and lm.left_at is null and c.lock_at > now() + interval '10 seconds'
  )
);
drop policy if exists predictions_update on cashford.predictions;
create policy predictions_update on cashford.predictions for update to authenticated using (user_id = (select auth.uid())) with check (
  user_id = (select auth.uid()) and cashford.password_change_done() and exists (
    select 1 from cashford.contests c join cashford.fixtures f on f.id = c.fixture_id join cashford.competitions co on co.id = f.competition_id join cashford.league_members lm on lm.league_id = c.league_id
    where c.id = predictions.contest_id and co.status <> 'archived' and lm.user_id = (select auth.uid()) and lm.left_at is null and c.lock_at > now() + interval '10 seconds'
  )
);

drop policy if exists knockout_pred_insert on cashford.knockout_predictions;
create policy knockout_pred_insert on cashford.knockout_predictions for insert to authenticated with check (
  user_id = (select auth.uid()) and cashford.password_change_done() and not cashford.bracket_locked(tournament_id)
  and exists (select 1 from cashford.competitions c where c.slug = tournament_id and c.status <> 'archived')
  and exists (select 1 from cashford.league_members lm where lm.user_id = (select auth.uid()) and lm.left_at is null)
  and (select f.kickoff_at from cashford.fixtures f where f.id = knockout_predictions.fixture_id) > now() + interval '10 seconds'
);
drop policy if exists knockout_pred_update on cashford.knockout_predictions;
create policy knockout_pred_update on cashford.knockout_predictions for update to authenticated using (
  user_id = (select auth.uid()) and not cashford.bracket_locked(tournament_id) and exists (select 1 from cashford.competitions c where c.slug = tournament_id and c.status <> 'archived') and exists (select 1 from cashford.league_members lm where lm.user_id = (select auth.uid()) and lm.left_at is null)
) with check (
  user_id = (select auth.uid()) and cashford.password_change_done() and not cashford.bracket_locked(tournament_id) and exists (select 1 from cashford.competitions c where c.slug = tournament_id and c.status <> 'archived') and exists (select 1 from cashford.league_members lm where lm.user_id = (select auth.uid()) and lm.left_at is null)
);
drop policy if exists knockout_pred_delete on cashford.knockout_predictions;
create policy knockout_pred_delete on cashford.knockout_predictions for delete to authenticated using (
  user_id = (select auth.uid()) and not cashford.bracket_locked(tournament_id) and exists (select 1 from cashford.competitions c where c.slug = tournament_id and c.status <> 'archived') and exists (select 1 from cashford.league_members lm where lm.user_id = (select auth.uid()) and lm.left_at is null)
);

create or replace function cashford.mirror_gameweek_entry(
  p_from_league_id uuid,
  p_gameweek_id uuid,
  p_targets jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_gw        record;
  v_src       record;
  v_target    record;
  v_contest   record;
  v_lc        record;
  v_mc        record;
  v_lc_from   int;
  v_mc_from   int;
  v_errors    jsonb := '[]'::jsonb;
  v_created   jsonb := '[]'::jsonb;
  v_err       text;
  v_entry_id  uuid;
  v_n         int;
  v_distinct  int;
  v_active    int;
  v_copied_active int;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if p_targets is null or jsonb_typeof(p_targets) <> 'array'
     or jsonb_array_length(p_targets) = 0 then
    raise exception 'pick at least one league to mirror into';
  end if;

  perform cashford.lock_gameweeks(array[p_gameweek_id]);
  select * into v_gw from cashford.gameweeks where id = p_gameweek_id;
  if not found then raise exception 'unknown gameweek'; end if;
  if exists (select 1 from cashford.competitions c where c.id = v_gw.competition_id and c.status <> 'active') then
    raise exception 'source competition is archived';
  end if;

  select count(*) into v_active
    from cashford.gameweek_effective_fixtures(p_gameweek_id) ef
   where ef.eff_state = 'active';
  if v_active = 0 then
    raise exception 'this gameweek has no fixtures to predict';
  end if;

  select e.* into v_src
    from cashford.gameweek_entries e
    join cashford.league_competitions lc
      on lc.league_id = e.league_id and lc.competition_id = e.competition_id
    join cashford.league_members lm
      on lm.league_id = e.league_id and lm.user_id = e.user_id and lm.left_at is null
   where e.league_id = p_from_league_id and e.gameweek_id = p_gameweek_id
     and e.user_id = v_uid and e.status = 'entered' and lc.status = 'active';
  if not found then raise exception 'you have not entered this gameweek in that league'; end if;

  select count(*), count(distinct (t->>'league_id')) into v_n, v_distinct
    from jsonb_array_elements(p_targets) t;
  if v_n <> v_distinct then raise exception 'the same league appears twice'; end if;
  if exists (select 1 from jsonb_to_recordset(p_targets) as t(league_id uuid)
              where t.league_id = p_from_league_id) then
    raise exception 'the source league cannot also be a target';
  end if;

  perform 1 from cashford.gameweek_contests gc
    where gc.gameweek_id = p_gameweek_id
      and gc.league_id in (select t.league_id from jsonb_to_recordset(p_targets)
                                                     as t(league_id uuid))
    order by gc.id for update;

  for v_target in
    select t.league_id, t.accepted_stake_inr,
           (select gc.id from cashford.gameweek_contests gc
             where gc.league_id = t.league_id and gc.gameweek_id = p_gameweek_id) as contest_id
      from jsonb_to_recordset(p_targets) as t(league_id uuid, accepted_stake_inr int)
     order by t.league_id
  loop
    v_err := null;
    select * into v_contest from cashford.gameweek_contests where id = v_target.contest_id;
    if v_target.contest_id is null then
      v_err := 'no pot for this league in this gameweek';
    elsif v_contest.status <> 'open' then
      v_err := 'this gameweek is closed';
    elsif clock_timestamp() >= v_contest.deadline_at then
      v_err := 'the deadline has passed';
    elsif v_target.accepted_stake_inr is distinct from v_contest.stake_inr then
      v_err := format('the stake is ₹%s, not ₹%s — reload and try again',
                      v_contest.stake_inr, coalesce(v_target.accepted_stake_inr::text, 'none'));
    end if;

    if v_err is null then
      select * into v_lc from cashford.league_competitions
       where league_id = v_target.league_id and competition_id = v_contest.competition_id
       for no key update;
      if not found or v_lc.status <> 'active' then
        v_err := 'this league is not playing this competition';
      elsif (select status from cashford.leagues where id = v_target.league_id) = 'archived' then
        v_err := 'this league is archived';
      end if;
    end if;

    if v_err is null then
      select * into v_mc from cashford.member_competitions
       where league_id = v_target.league_id and user_id = v_uid
         and competition_id = v_contest.competition_id
       for no key update;
      if not found then
        v_err := 'you are not a member of this league';
      elsif v_mc.left_at is not null then
        v_err := 'you have left this league';
      else
        select g.number into v_lc_from from cashford.gameweeks g
         where g.id = v_lc.eligible_from_gameweek_id;
        select g.number into v_mc_from from cashford.gameweeks g
         where g.id = v_mc.eligible_from_gameweek_id;
        if v_lc_from is null or v_lc_from > v_gw.number then
          v_err := 'this league is not eligible for this gameweek yet';
        elsif v_mc_from is null or v_mc_from > v_gw.number then
          v_err := 'you joined after this gameweek started';
        end if;
      end if;
    end if;

    if v_err is null and exists (
      select 1 from cashford.gameweek_effective_fixtures(p_gameweek_id) ef
       where ef.eff_state = 'active'
         and not exists (select 1 from cashford.gameweek_picks p
                          where p.entry_id = v_src.id and p.fixture_id = ef.fixture_id)
    ) then
      v_err := 'your predictions are out of date — reload and try again';
    end if;
    if v_err is not null then
      v_errors := v_errors || jsonb_build_object('league_id', v_target.league_id, 'error', v_err);
    end if;
  end loop;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors);
  end if;

  for v_target in
    select t.league_id,
           (select gc.id from cashford.gameweek_contests gc
             where gc.league_id = t.league_id and gc.gameweek_id = p_gameweek_id) as contest_id
      from jsonb_to_recordset(p_targets) as t(league_id uuid)
     order by t.league_id
  loop
    select * into v_contest from cashford.gameweek_contests where id = v_target.contest_id;
    select id into v_entry_id from cashford.gameweek_entries
     where gameweek_contest_id = v_contest.id and user_id = v_uid;
    if v_entry_id is null then
      insert into cashford.gameweek_entries
        (gameweek_contest_id, league_id, gameweek_id, competition_id, user_id, status)
      values (v_contest.id, v_target.league_id, p_gameweek_id, v_contest.competition_id,
              v_uid, 'entered')
      returning id into v_entry_id;
    else
      update cashford.gameweek_entries set status = 'entered', updated_at = now()
       where id = v_entry_id;
    end if;
    delete from cashford.gameweek_picks p
     where p.entry_id = v_entry_id
       and exists (select 1 from cashford.gameweek_picks sp
                    where sp.entry_id = v_src.id and sp.fixture_id = p.fixture_id);
    insert into cashford.gameweek_picks
      (entry_id, membership_id, gameweek_id, fixture_id, competition_id, pred_home, pred_away)
    select v_entry_id, sp.membership_id, p_gameweek_id, sp.fixture_id, v_contest.competition_id,
           sp.pred_home, sp.pred_away
      from cashford.gameweek_picks sp where sp.entry_id = v_src.id;
    get diagnostics v_n = row_count;
    select count(*) into v_copied_active
      from cashford.gameweek_picks p
      join cashford.gameweek_effective_fixtures(p_gameweek_id) ef
        on ef.fixture_id = p.fixture_id and ef.eff_state = 'active'
     where p.entry_id = v_entry_id;
    if v_copied_active <> v_active then
      raise exception 'mirror wrote % of % predictions for league %',
        v_copied_active, v_active, v_target.league_id;
    end if;
    v_created := v_created || jsonb_build_object('league_id', v_target.league_id,
                                                'entry_id', v_entry_id, 'picks', v_n);
  end loop;
  return jsonb_build_object('ok', true, 'mirrored', v_created);
end;
$$;

-- -----------------------------------------------------------------------------
-- 6. RLS and explicit grants
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on cashford.profiles;
create policy profiles_select on cashford.profiles for select to authenticated using (
  id = (select auth.uid()) or id in (select lm.user_id from cashford.league_members lm where lm.left_at is null and lm.league_id in (select cashford.my_league_ids()))
);
drop policy if exists league_members_select on cashford.league_members;
create policy league_members_select on cashford.league_members for select to authenticated using (league_id in (select cashford.my_league_ids()));
drop policy if exists league_competitions_select on cashford.league_competitions;
create policy league_competitions_select on cashford.league_competitions for select to authenticated using (league_id in (select cashford.my_league_ids()));
drop policy if exists member_competitions_select on cashford.member_competitions;
create policy member_competitions_select on cashford.member_competitions for select to authenticated using (league_id in (select cashford.my_league_ids()));

alter table cashford.payments enable row level security;
alter table cashford.payment_confirmations enable row level security;
drop policy if exists payments_select on cashford.payments;
create policy payments_select on cashford.payments for select to authenticated using (
  league_id in (select cashford.my_league_ids()) or payer_user_id = (select auth.uid()) or receiver_user_id = (select auth.uid())
);
drop policy if exists payment_confirmations_select on cashford.payment_confirmations;
create policy payment_confirmations_select on cashford.payment_confirmations for select to authenticated using (exists (select 1 from cashford.payments p where p.id = payment_id and (p.league_id in (select cashford.my_league_ids()) or p.payer_user_id = (select auth.uid()) or p.receiver_user_id = (select auth.uid()))));
revoke insert, update, delete on cashford.payments from anon, authenticated;
revoke insert, update, delete on cashford.payment_confirmations from anon, authenticated;
grant all on cashford.payments to service_role;
grant all on cashford.payment_confirmations to service_role;

do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'cashford' and tablename = 'payments') then execute 'alter publication supabase_realtime drop table cashford.payments'; end if;
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'cashford' and tablename = 'payment_confirmations') then execute 'alter publication supabase_realtime drop table cashford.payment_confirmations'; end if;
end $$;

revoke all on function cashford.log_payment(uuid, uuid, uuid, int, date, text, uuid, uuid[]) from public, anon, authenticated;
revoke all on function cashford.respond_to_payment(uuid, text, uuid) from public, anon, authenticated;
revoke all on function cashford.cancel_payment(uuid, uuid) from public, anon, authenticated;
revoke all on function cashford.reverse_payment(uuid, text, uuid) from public, anon, authenticated;
revoke all on function cashford.dues_is_financial_participant(uuid, uuid) from public, anon, authenticated;
revoke all on function cashford.dues_current_member(uuid, uuid) from public, anon, authenticated;
revoke all on function cashford.adopt_league_competition(uuid, text, int, uuid) from public, anon, authenticated;
revoke all on function cashford.remove_league_member(uuid, uuid) from public, anon, authenticated;
revoke all on function cashford.record_dues_ledger_parity(uuid, jsonb) from public, anon, authenticated;
revoke all on function cashford.resolve_dues_ledger_issue(uuid) from public, anon, authenticated;
revoke all on function cashford.reject_archived_knockout_write() from public, anon, authenticated;
revoke all on function cashford.mirror_gameweek_entry(uuid, uuid, jsonb) from public, anon;
grant execute on function cashford.log_payment(uuid, uuid, uuid, int, date, text, uuid, uuid[]) to authenticated;
grant execute on function cashford.respond_to_payment(uuid, text, uuid) to authenticated;
grant execute on function cashford.cancel_payment(uuid, uuid) to authenticated;
grant execute on function cashford.reverse_payment(uuid, text, uuid) to authenticated;
grant execute on function cashford.adopt_league_competition(uuid, text, int, uuid) to authenticated;
grant execute on function cashford.remove_league_member(uuid, uuid) to authenticated;
grant execute on function cashford.record_dues_ledger_parity(uuid, jsonb) to service_role;
grant execute on function cashford.resolve_dues_ledger_issue(uuid) to service_role;
grant execute on function cashford.mirror_gameweek_entry(uuid, uuid, jsonb) to authenticated, service_role;

commit;
