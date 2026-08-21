-- Server-only, transactional admin mutations. These functions are reachable
-- through PostgREST only with the Cloudflare Worker's service-role credential.

create or replace function private.kitco_correlation_uuid(value text)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
begin
  return value::uuid;
exception when invalid_text_representation then
  return gen_random_uuid();
end;
$$;
revoke all on function private.kitco_correlation_uuid(text) from public, anon, authenticated;

create or replace function public.approve_kitco_order(
  p_organisation_id uuid,
  p_actor_auth_user_id uuid,
  p_order_id uuid,
  p_now timestamptz,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_status text;
  v_dealer_id uuid;
begin
  if not exists (
    select 1 from public.app_users
    where auth_user_id = p_actor_auth_user_id
      and organisation_id = p_organisation_id and app_role = 'ADMIN'
  ) then raise exception 'administrator access required' using errcode = '42501'; end if;

  select status, dealer_id into v_previous_status, v_dealer_id
  from public.orders
  where id = p_order_id and organisation_id = p_organisation_id
  for update;
  if v_previous_status is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if v_previous_status = 'APPROVED' then
    return pg_catalog.jsonb_build_object('order_id', p_order_id, 'changed', false);
  end if;
  if v_previous_status not in ('SUBMITTED', 'UNDER_REVIEW', 'PARTIALLY_APPROVED') then
    raise exception 'order cannot be approved from status %', v_previous_status using errcode = '22023';
  end if;

  update public.orders set status = 'APPROVED' where id = p_order_id;
  insert into public.order_status_history (organisation_id, order_id, from_status, to_status, changed_by, changed_at)
  values (p_organisation_id, p_order_id, v_previous_status, 'APPROVED', p_actor_auth_user_id, p_now);
  insert into public.audit_events (
    organisation_id, dealer_id, actor_auth_user_id, event_type, entity_type, entity_id, correlation_id, evidence, occurred_at
  ) values (
    p_organisation_id, v_dealer_id, p_actor_auth_user_id, 'ORDER_APPROVED', 'ORDER', p_order_id,
    private.kitco_correlation_uuid(p_correlation_id),
    pg_catalog.jsonb_build_object('from_status', v_previous_status, 'to_status', 'APPROVED'), p_now
  );
  return pg_catalog.jsonb_build_object('order_id', p_order_id, 'changed', true);
end;
$$;

create or replace function public.apply_kitco_credit_hold(
  p_organisation_id uuid,
  p_actor_auth_user_id uuid,
  p_order_id uuid,
  p_order_line_id uuid,
  p_size_label text,
  p_pairs integer,
  p_reason text,
  p_now timestamptz,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_line_size_id uuid;
  v_dealer_id uuid;
  v_approved_pairs integer;
  v_dispatched_pairs integer := 0;
  v_held_pairs integer := 0;
  v_hold_id uuid;
begin
  if p_pairs is null or p_pairs <= 0 then raise exception 'hold quantity must be positive' using errcode = '22023'; end if;
  if p_reason is null or length(trim(p_reason)) < 1 then raise exception 'hold reason required' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.app_users
    where auth_user_id = p_actor_auth_user_id
      and organisation_id = p_organisation_id and app_role = 'ADMIN'
  ) then raise exception 'administrator access required' using errcode = '42501'; end if;

  select size_line.id, orders.dealer_id, size_line.approved_quantity_pairs
    into v_order_line_size_id, v_dealer_id, v_approved_pairs
  from public.orders orders
  join public.order_versions version
    on version.order_id = orders.id and version.version_no = orders.current_version_no
  join public.order_lines line on line.order_version_id = version.id
  join public.order_line_sizes size_line on size_line.order_line_id = line.id
  join public.size_values size_value on size_value.id = size_line.size_value_id
  where orders.id = p_order_id and orders.organisation_id = p_organisation_id
    and orders.status in ('APPROVED', 'PARTIALLY_APPROVED')
    and line.id = p_order_line_id and upper(trim(size_value.label)) = upper(trim(p_size_label))
  for update of orders, size_line;
  if v_order_line_size_id is null then raise exception 'approved order allocation not found' using errcode = 'P0002'; end if;

  select coalesce(sum(quantity_pairs), 0)::integer into v_dispatched_pairs
  from (
    select dispatch_line.quantity_pairs, dispatch.status as dispatch_status
    from public.dispatch_lines dispatch_line
    join public.dispatches dispatch on dispatch.id = dispatch_line.dispatch_id
    where dispatch_line.order_line_size_id = v_order_line_size_id
  ) finalised where dispatch_status = 'FINALISED';
  select coalesce(sum(quantity_pairs), 0)::integer into v_held_pairs
  from (
    select allocation.quantity_pairs, hold_record.status as hold_status
    from public.hold_allocations allocation
    join public.holds hold_record on hold_record.id = allocation.hold_id
    where allocation.order_line_size_id = v_order_line_size_id
  ) active_holds where hold_status = 'ACTIVE';

  if p_pairs > v_approved_pairs - v_dispatched_pairs - v_held_pairs then
    raise exception 'hold exceeds available pending quantity' using errcode = '22023';
  end if;
  insert into public.holds (organisation_id, order_id, hold_type, status, reason, created_by, created_at)
  values (p_organisation_id, p_order_id, 'CREDIT', 'ACTIVE', trim(p_reason), p_actor_auth_user_id, p_now)
  returning id into v_hold_id;
  insert into public.hold_allocations (organisation_id, hold_id, order_line_size_id, quantity_pairs, created_at)
  values (p_organisation_id, v_hold_id, v_order_line_size_id, p_pairs, p_now);
  insert into public.audit_events (
    organisation_id, dealer_id, actor_auth_user_id, event_type, entity_type, entity_id, correlation_id, evidence, occurred_at
  ) values (
    p_organisation_id, v_dealer_id, p_actor_auth_user_id, 'CREDIT_HOLD_APPLIED', 'HOLD', v_hold_id,
    private.kitco_correlation_uuid(p_correlation_id),
    pg_catalog.jsonb_build_object('order_id', p_order_id, 'order_line_size_id', v_order_line_size_id, 'pairs', p_pairs), p_now
  );
  return pg_catalog.jsonb_build_object('hold_id', v_hold_id, 'order_id', p_order_id);
end;
$$;

create or replace function public.create_kitco_dispatch(
  p_organisation_id uuid,
  p_actor_auth_user_id uuid,
  p_order_id uuid,
  p_order_line_id uuid,
  p_size_label text,
  p_pairs integer,
  p_dealer_location_id uuid,
  p_now timestamptz,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_line_size_id uuid;
  v_dealer_id uuid;
  v_approved_pairs integer;
  v_dispatched_pairs integer := 0;
  v_held_pairs integer := 0;
  v_location_id uuid;
  v_location_count integer;
  v_dispatch_id uuid;
begin
  if p_pairs is null or p_pairs <= 0 then raise exception 'dispatch quantity must be positive' using errcode = '22023'; end if;
  if not exists (
    select 1 from public.app_users
    where auth_user_id = p_actor_auth_user_id
      and organisation_id = p_organisation_id and app_role = 'ADMIN'
  ) then raise exception 'administrator access required' using errcode = '42501'; end if;

  select size_line.id, orders.dealer_id, size_line.approved_quantity_pairs
    into v_order_line_size_id, v_dealer_id, v_approved_pairs
  from public.orders orders
  join public.order_versions version
    on version.order_id = orders.id and version.version_no = orders.current_version_no
  join public.order_lines line on line.order_version_id = version.id
  join public.order_line_sizes size_line on size_line.order_line_id = line.id
  join public.size_values size_value on size_value.id = size_line.size_value_id
  where orders.id = p_order_id and orders.organisation_id = p_organisation_id
    and orders.status in ('APPROVED', 'PARTIALLY_APPROVED')
    and line.id = p_order_line_id and upper(trim(size_value.label)) = upper(trim(p_size_label))
  for update of orders, size_line;
  if v_order_line_size_id is null then raise exception 'approved order allocation not found' using errcode = 'P0002'; end if;

  select coalesce(sum(quantity_pairs), 0)::integer into v_dispatched_pairs
  from (
    select dispatch_line.quantity_pairs, dispatch.status as dispatch_status
    from public.dispatch_lines dispatch_line
    join public.dispatches dispatch on dispatch.id = dispatch_line.dispatch_id
    where dispatch_line.order_line_size_id = v_order_line_size_id
  ) finalised where dispatch_status = 'FINALISED';
  select coalesce(sum(quantity_pairs), 0)::integer into v_held_pairs
  from (
    select allocation.quantity_pairs, hold_record.status as hold_status
    from public.hold_allocations allocation
    join public.holds hold_record on hold_record.id = allocation.hold_id
    where allocation.order_line_size_id = v_order_line_size_id
  ) active_holds where hold_status = 'ACTIVE';
  if p_pairs > v_approved_pairs - v_dispatched_pairs - v_held_pairs then
    raise exception 'dispatch exceeds available pending quantity' using errcode = '22023';
  end if;

  if p_dealer_location_id is not null then
    select id into v_location_id from public.dealer_locations
    where id = p_dealer_location_id and organisation_id = p_organisation_id and dealer_id = v_dealer_id
      and location_type in ('SHIP_TO', 'BOTH') and active;
  else
    select count(*) into v_location_count from public.dealer_locations
    where organisation_id = p_organisation_id and dealer_id = v_dealer_id
      and location_type in ('SHIP_TO', 'BOTH') and active;
    if v_location_count <> 1 then
      raise exception 'dealer location required when more than one active Ship-To exists' using errcode = '22023';
    end if;
    select id into v_location_id from public.dealer_locations
    where organisation_id = p_organisation_id and dealer_id = v_dealer_id
      and location_type in ('SHIP_TO', 'BOTH') and active
    limit 1;
  end if;
  if v_location_id is null then raise exception 'active dealer Ship-To location not found' using errcode = 'P0002'; end if;

  insert into public.dispatches (
    organisation_id, order_id, dispatch_number, status, dispatched_at, created_by, created_at
  ) values (
    p_organisation_id, p_order_id,
    'DSP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
    'FINALISED', p_now, p_actor_auth_user_id, p_now
  ) returning id into v_dispatch_id;
  insert into public.dispatch_lines (
    organisation_id, dispatch_id, order_line_size_id, dealer_location_id, quantity_pairs, created_at
  ) values (
    p_organisation_id, v_dispatch_id, v_order_line_size_id, v_location_id, p_pairs, p_now
  );
  insert into public.audit_events (
    organisation_id, dealer_id, actor_auth_user_id, event_type, entity_type, entity_id, correlation_id, evidence, occurred_at
  ) values (
    p_organisation_id, v_dealer_id, p_actor_auth_user_id, 'DISPATCH_FINALISED', 'DISPATCH', v_dispatch_id,
    private.kitco_correlation_uuid(p_correlation_id),
    pg_catalog.jsonb_build_object('order_id', p_order_id, 'order_line_size_id', v_order_line_size_id, 'pairs', p_pairs, 'dealer_location_id', v_location_id), p_now
  );
  return pg_catalog.jsonb_build_object('dispatch_id', v_dispatch_id, 'order_id', p_order_id);
end;
$$;

revoke all on function public.approve_kitco_order(uuid, uuid, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.approve_kitco_order(uuid, uuid, uuid, timestamptz, text)
  to service_role;
revoke all on function public.apply_kitco_credit_hold(uuid, uuid, uuid, uuid, text, integer, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.apply_kitco_credit_hold(uuid, uuid, uuid, uuid, text, integer, text, timestamptz, text)
  to service_role;
revoke all on function public.create_kitco_dispatch(uuid, uuid, uuid, uuid, text, integer, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.create_kitco_dispatch(uuid, uuid, uuid, uuid, text, integer, uuid, timestamptz, text)
  to service_role;
