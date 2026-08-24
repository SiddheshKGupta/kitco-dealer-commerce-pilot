-- Corrective migration for the live database.
--
-- The first cut of approve_entire_kitco_order / reject_entire_kitco_order used
--     with x as (update ... returning pending_qty as added) select sum(added) ...
-- pending_qty is a GENERATED column, so RETURNING hands back the POST-update
-- value -- which is always 0 here, because the update is precisely what consumes
-- the pending quantity. Every bulk action therefore reported "0 pairs approved"
-- while actually approving them, and the audit evidence recorded 0 too.
--
-- Caught by running the RPC against real Postgres (see docs/plan/V5_EXECUTION_PLAN.md
-- §3.3). A mocked repository would never have exposed it.
--
-- 20260824110000_v5_order_line_decisions.sql already carries the corrected
-- bodies, so this file is a NO-OP on a fresh database (both are CREATE OR
-- REPLACE and identical). It exists so the file history matches what was
-- actually applied to the live database, which received the buggy version first.

create or replace function public.approve_entire_kitco_order(
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
  v_order_status text; v_dealer_id uuid; v_affected integer; v_approved_added bigint; v_new_status text;
begin
  if not exists (
    select 1 from public.app_users
    where auth_user_id = p_actor_auth_user_id and organisation_id = p_organisation_id
      and app_role in ('ADMIN', 'SUPERADMIN') and status = 'ACTIVE'
  ) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select o.status, o.dealer_id into v_order_status, v_dealer_id
  from public.orders o where o.id = p_order_id and o.organisation_id = p_organisation_id;
  if v_order_status is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order_status in ('REJECTED', 'CANCELLED') then
    raise exception 'order decisions are closed for status %', v_order_status using errcode = '22023';
  end if;

  select count(*), coalesce(sum(pending_qty), 0)
  into v_affected, v_approved_added
  from public.order_line_decisions
  where order_id = p_order_id and pending_qty > 0;

  update public.order_line_decisions
  set approved_qty = approved_qty + pending_qty,
      decided_by = p_actor_auth_user_id,
      decided_at = p_now
  where order_id = p_order_id and pending_qty > 0;

  v_new_status := private.recompute_kitco_order_status(p_order_id);

  insert into public.audit_events (
    organisation_id, dealer_id, actor_auth_user_id, event_type, entity_type, entity_id,
    correlation_id, evidence, occurred_at
  ) values (
    p_organisation_id, v_dealer_id, p_actor_auth_user_id, 'ORDER_APPROVED_IN_FULL', 'ORDER', p_order_id,
    private.kitco_correlation_uuid(p_correlation_id),
    pg_catalog.jsonb_build_object(
      'lines_affected', v_affected, 'pairs_approved', v_approved_added,
      'from_status', v_order_status, 'to_status', v_new_status
    ), p_now
  );

  return pg_catalog.jsonb_build_object(
    'order_id', p_order_id, 'order_status', v_new_status,
    'lines_affected', v_affected, 'pairs_approved', v_approved_added
  );
end;
$$;

create or replace function public.reject_entire_kitco_order(
  p_organisation_id uuid,
  p_actor_auth_user_id uuid,
  p_order_id uuid,
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
  v_order_status text; v_dealer_id uuid; v_affected integer; v_rejected_added bigint; v_new_status text;
begin
  if coalesce(nullif(trim(p_reason), ''), null) is null then
    raise exception 'a rejection reason is required' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.app_users
    where auth_user_id = p_actor_auth_user_id and organisation_id = p_organisation_id
      and app_role in ('ADMIN', 'SUPERADMIN') and status = 'ACTIVE'
  ) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select o.status, o.dealer_id into v_order_status, v_dealer_id
  from public.orders o where o.id = p_order_id and o.organisation_id = p_organisation_id;
  if v_order_status is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order_status in ('REJECTED', 'CANCELLED') then
    raise exception 'order decisions are closed for status %', v_order_status using errcode = '22023';
  end if;

  select count(*), coalesce(sum(pending_qty), 0)
  into v_affected, v_rejected_added
  from public.order_line_decisions
  where order_id = p_order_id and pending_qty > 0;

  update public.order_line_decisions
  set rejected_qty = rejected_qty + pending_qty,
      rejection_reason = p_reason,
      decided_by = p_actor_auth_user_id,
      decided_at = p_now
  where order_id = p_order_id and pending_qty > 0;

  v_new_status := private.recompute_kitco_order_status(p_order_id);

  insert into public.audit_events (
    organisation_id, dealer_id, actor_auth_user_id, event_type, entity_type, entity_id,
    correlation_id, evidence, occurred_at
  ) values (
    p_organisation_id, v_dealer_id, p_actor_auth_user_id, 'ORDER_REJECTED_IN_FULL', 'ORDER', p_order_id,
    private.kitco_correlation_uuid(p_correlation_id),
    pg_catalog.jsonb_build_object(
      'lines_affected', v_affected, 'pairs_rejected', v_rejected_added, 'reason', p_reason,
      'from_status', v_order_status, 'to_status', v_new_status
    ), p_now
  );

  return pg_catalog.jsonb_build_object(
    'order_id', p_order_id, 'order_status', v_new_status,
    'lines_affected', v_affected, 'pairs_rejected', v_rejected_added
  );
end;
$$;
