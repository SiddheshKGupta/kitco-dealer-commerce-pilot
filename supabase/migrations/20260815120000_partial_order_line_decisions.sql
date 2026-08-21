-- Task 5: real per-line/size approve/hold decisions.
-- approved_quantity_pairs was pre-set equal to ordered_quantity_pairs at
-- submission (atomic_order_submission.sql) with no path to write a smaller
-- number, and the only hold mechanism (apply_kitco_credit_hold) required the
-- order already be APPROVED first (approve-then-hold, not one atomic
-- decision). This migration adds a single audited function that lets an
-- admin approve/hold a specific order line + size in one atomic step.

-- 1. Widen the hold reason vocabulary to the plan's 6-value list. Existing
--    CREDIT/OPERATIONAL rows are migrated to their closest new value (kept
--    simple: rewrite history rather than support two vocabularies forever).
update public.holds set hold_type = 'CREDIT_HOLD' where hold_type = 'CREDIT';
update public.holds set hold_type = 'OTHER' where hold_type = 'OPERATIONAL';

alter table public.holds drop constraint holds_hold_type_check;
alter table public.holds add constraint holds_hold_type_check
  check (hold_type = any (array[
    'CREDIT_HOLD','STOCK_REVIEW','COMMERCIAL_REVIEW','ALLOCATION_PENDING','MANUAL_REVIEW','OTHER'
  ]));

-- 2. apply_kitco_credit_hold hardcoded hold_type = 'CREDIT', now invalid
--    against the widened constraint. Point it at the closest new value;
--    everything else about this function (post-approval operational hold,
--    unstructured reason) is unchanged and still used by the dispatch team.
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
  values (p_organisation_id, p_order_id, 'CREDIT_HOLD', 'ACTIVE', trim(p_reason), p_actor_auth_user_id, p_now)
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

-- 3. The atomic per-line/size decision. Sets approved_quantity_pairs and, in
--    the same transaction, an ACTIVE hold for held_quantity_pairs (replacing
--    any previous ACTIVE hold on this line+size), then recomputes the
--    order's overall status from every line+size's decision state. The
--    dealer's originally submitted order/version rows are never rewritten --
--    only the admin-decision fields (approved_quantity_pairs, holds) change.
create or replace function public.decide_kitco_order_line(
  p_organisation_id uuid,
  p_actor_auth_user_id uuid,
  p_order_id uuid,
  p_order_line_id uuid,
  p_size_label text,
  p_approved_pairs integer,
  p_held_pairs integer,
  p_hold_reason text,
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
  v_order_status text;
  v_ordered_pairs integer;
  v_dispatched_pairs integer := 0;
  v_hold_id uuid;
  v_all_decided boolean;
  v_any_held boolean;
  v_new_status text;
begin
  if p_approved_pairs is null or p_approved_pairs < 0 then
    raise exception 'approved quantity must be zero or more' using errcode = '22023';
  end if;
  if p_held_pairs is null or p_held_pairs < 0 then
    raise exception 'held quantity must be zero or more' using errcode = '22023';
  end if;
  if p_held_pairs > 0 and (p_hold_reason is null or p_hold_reason not in
    ('CREDIT_HOLD','STOCK_REVIEW','COMMERCIAL_REVIEW','ALLOCATION_PENDING','MANUAL_REVIEW','OTHER')
  ) then
    raise exception 'a valid hold reason is required when holding pairs' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.app_users
    where auth_user_id = p_actor_auth_user_id
      and organisation_id = p_organisation_id and app_role = 'ADMIN'
  ) then raise exception 'administrator access required' using errcode = '42501'; end if;

  select orders.status, orders.dealer_id into v_order_status, v_dealer_id
  from public.orders orders
  where orders.id = p_order_id and orders.organisation_id = p_organisation_id
  for update;
  if v_order_status is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if v_order_status in ('REJECTED', 'CANCELLED') then
    raise exception 'order decisions are closed for status %', v_order_status using errcode = '22023';
  end if;

  select size_line.id, size_line.ordered_quantity_pairs
    into v_order_line_size_id, v_ordered_pairs
  from public.orders orders
  join public.order_versions version
    on version.order_id = orders.id and version.version_no = orders.current_version_no
  join public.order_lines line on line.order_version_id = version.id and line.id = p_order_line_id
  join public.order_line_sizes size_line on size_line.order_line_id = line.id
  join public.size_values size_value on size_value.id = size_line.size_value_id
  where orders.id = p_order_id
    and upper(trim(size_value.label)) = upper(trim(p_size_label))
  for update of size_line;
  if v_order_line_size_id is null then raise exception 'order line size not found' using errcode = 'P0002'; end if;

  if p_approved_pairs + p_held_pairs > v_ordered_pairs then
    raise exception 'approved plus held pairs cannot exceed the % ordered', v_ordered_pairs using errcode = '22023';
  end if;

  select coalesce(sum(quantity_pairs), 0)::integer into v_dispatched_pairs
  from (
    select dispatch_line.quantity_pairs, dispatch.status as dispatch_status
    from public.dispatch_lines dispatch_line
    join public.dispatches dispatch on dispatch.id = dispatch_line.dispatch_id
    where dispatch_line.order_line_size_id = v_order_line_size_id
  ) finalised where dispatch_status = 'FINALISED';
  if p_approved_pairs < v_dispatched_pairs then
    raise exception 'approved pairs cannot drop below the % pairs already dispatched', v_dispatched_pairs using errcode = '22023';
  end if;

  update public.order_line_sizes set approved_quantity_pairs = p_approved_pairs where id = v_order_line_size_id;
  update public.order_lines set approved_quantity_pairs = (
    select coalesce(sum(approved_quantity_pairs), 0) from public.order_line_sizes where order_line_id = p_order_line_id
  ) where id = p_order_line_id;

  -- Replace any previous decision's hold on this line+size with the new one.
  update public.holds set status = 'RELEASED', released_at = p_now
  where status = 'ACTIVE' and id in (
    select hold_id from public.hold_allocations where order_line_size_id = v_order_line_size_id
  );
  if p_held_pairs > 0 then
    insert into public.holds (organisation_id, order_id, hold_type, status, reason, created_by, created_at)
    values (p_organisation_id, p_order_id, p_hold_reason, 'ACTIVE', p_hold_reason, p_actor_auth_user_id, p_now)
    returning id into v_hold_id;
    insert into public.hold_allocations (organisation_id, hold_id, order_line_size_id, quantity_pairs, created_at)
    values (p_organisation_id, v_hold_id, v_order_line_size_id, p_held_pairs, p_now);
  end if;

  -- Recompute the order's overall status from every line+size's decision
  -- state: fully decided (approved + active-held = ordered) for every line,
  -- and whether any of them are held.
  select
    not exists (
      select 1
      from public.order_line_sizes size_line
      join public.order_lines line on line.id = size_line.order_line_id
      join public.order_versions version on version.id = line.order_version_id
      where version.order_id = p_order_id and version.version_no = (select current_version_no from public.orders where id = p_order_id)
        and size_line.approved_quantity_pairs + coalesce((
          select sum(allocation.quantity_pairs) from public.hold_allocations allocation
          join public.holds hold_record on hold_record.id = allocation.hold_id
          where allocation.order_line_size_id = size_line.id and hold_record.status = 'ACTIVE'
        ), 0) < size_line.ordered_quantity_pairs
    ),
    exists (
      select 1
      from public.order_line_sizes size_line
      join public.order_lines line on line.id = size_line.order_line_id
      join public.order_versions version on version.id = line.order_version_id
      where version.order_id = p_order_id and version.version_no = (select current_version_no from public.orders where id = p_order_id)
        and exists (
          select 1 from public.hold_allocations allocation
          join public.holds hold_record on hold_record.id = allocation.hold_id
          where allocation.order_line_size_id = size_line.id and hold_record.status = 'ACTIVE'
        )
    )
  into v_all_decided, v_any_held;

  v_new_status := case when not v_all_decided then 'UNDER_REVIEW' when v_any_held then 'PARTIALLY_APPROVED' else 'APPROVED' end;

  if v_new_status <> v_order_status then
    update public.orders set status = v_new_status where id = p_order_id;
    insert into public.order_status_history (organisation_id, order_id, from_status, to_status, changed_by, changed_at)
    values (p_organisation_id, p_order_id, v_order_status, v_new_status, p_actor_auth_user_id, p_now);
  end if;

  insert into public.audit_events (
    organisation_id, dealer_id, actor_auth_user_id, event_type, entity_type, entity_id, correlation_id, evidence, occurred_at
  ) values (
    p_organisation_id, v_dealer_id, p_actor_auth_user_id, 'ORDER_LINE_DECIDED', 'ORDER_LINE_SIZE', v_order_line_size_id,
    private.kitco_correlation_uuid(p_correlation_id),
    pg_catalog.jsonb_build_object(
      'order_id', p_order_id, 'order_line_id', p_order_line_id, 'size', p_size_label,
      'approved_pairs', p_approved_pairs, 'held_pairs', p_held_pairs, 'hold_reason', p_hold_reason,
      'ordered_pairs', v_ordered_pairs, 'from_status', v_order_status, 'to_status', v_new_status
    ), p_now
  );

  return pg_catalog.jsonb_build_object(
    'order_id', p_order_id, 'order_line_size_id', v_order_line_size_id,
    'approved_pairs', p_approved_pairs, 'held_pairs', p_held_pairs, 'order_status', v_new_status
  );
end;
$$;

revoke all on function public.decide_kitco_order_line(uuid, uuid, uuid, uuid, text, integer, integer, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.decide_kitco_order_line(uuid, uuid, uuid, uuid, text, integer, integer, text, timestamptz, text)
  to service_role;
