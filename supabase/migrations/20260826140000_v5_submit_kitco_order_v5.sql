-- Phase 4: submit_kitco_order_v5 -- adds Bill-To/Ship-To partner functions, PO
-- number and delivery preference to order submission, on top of the already-applied
-- columns from 20260826130000_v5_order_partners_and_size_system.sql.
--
-- This is a NEW function alongside the existing public.submit_kitco_order, not an
-- in-place edit of it (project convention since Phase 0 -- old RPC stays untouched
-- and callable, the Worker switches which one it calls). Everything through the
-- draft-validation and order/version/line insert logic is unchanged from
-- 20260814150000_order_number_sequence.sql; only the partner/snapshot/PO/delivery
-- writes are new.
--
-- Partner ids are trusted params here: the Worker calls
-- SupabaseDealerGroups.resolveOrderPartners() first and only forwards ids that
-- function already proved belong to the ordering dealer's own organisation and
-- group (V5_DEALER_GROUP_MODEL.md §4). This function still re-checks organisation
-- membership on every partner row before building snapshots from it, as
-- defence-in-depth against a Worker bug -- a missing check here would be a real
-- cross-tenant read/write, not a cosmetic one (the Worker holds the service-role
-- key and bypasses RLS).
create or replace function public.submit_kitco_order_v5(
  p_organisation_id uuid,
  p_dealer_id uuid,
  p_actor_auth_user_id uuid,
  p_idempotency_key text,
  p_otp_challenge_id uuid,
  p_now timestamptz,
  p_correlation_id text,
  p_bill_to_dealer_id uuid,
  p_ship_to_dealer_id uuid,
  p_ship_to_location_id uuid,
  p_dealer_po_number text,
  p_delivery_preference text,
  p_requested_delivery_date date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft_id uuid;
  v_order_id uuid;
  v_version_id uuid;
  v_order_line_id uuid;
  v_retail_value bigint := 0;
  v_line record;
  v_correlation_id uuid;
  v_order_seq integer;
  v_order_number text;
  v_ordering_snapshot jsonb;
  v_bill_to_snapshot jsonb;
  v_ship_to_snapshot jsonb;
begin
  if p_idempotency_key is null or length(p_idempotency_key) < 1 or length(p_idempotency_key) > 128 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.app_users
    where auth_user_id = p_actor_auth_user_id
      and organisation_id = p_organisation_id
      and dealer_id = p_dealer_id
      and app_role = 'DEALER'
  ) or not exists (
    select 1 from public.dealers
    where id = p_dealer_id and organisation_id = p_organisation_id and activation_status = 'ACTIVE'
  ) then
    raise exception 'dealer session is no longer active' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_organisation_id::text || ':' || p_dealer_id::text || ':' || p_idempotency_key, 0)
  );
  select id into v_order_id from public.orders
  where organisation_id = p_organisation_id and dealer_id = p_dealer_id and idempotency_key = p_idempotency_key;
  if v_order_id is not null then
    return pg_catalog.jsonb_build_object('order_id', v_order_id, 'created', false);
  end if;

  if not exists (
    select 1 from public.otp_challenges
    where id = p_otp_challenge_id
      and organisation_id = p_organisation_id
      and dealer_id = p_dealer_id
      and auth_user_id = p_actor_auth_user_id
      and purpose = 'ORDER_SUBMISSION'
      and consumed_at is not null
      and consumed_at <= p_now
      and expires_at > consumed_at
  ) then
    raise exception 'valid consumed order OTP required' using errcode = '42501';
  end if;

  -- Defence-in-depth: the Worker already proved these ids via resolveOrderPartners,
  -- but this function never trusts a caller-supplied id without its own
  -- organisation_id check (same rule as every other RPC in this project).
  select pg_catalog.jsonb_build_object('dealerId', d.id, 'code', d.code, 'name', d.name,
           'gstin', g.gstin, 'addressLine1', d.address_line1, 'city', d.city, 'state', d.state, 'pinCode', d.pin_code)
  into v_ordering_snapshot
  from public.dealers d left join public.gst_registrations g on g.id = d.gst_registration_id
  where d.id = p_dealer_id and d.organisation_id = p_organisation_id;
  if v_ordering_snapshot is null then raise exception 'ordering dealer not found' using errcode = '42501'; end if;

  select pg_catalog.jsonb_build_object('dealerId', d.id, 'code', d.code, 'name', d.name,
           'gstin', g.gstin, 'addressLine1', d.address_line1, 'city', d.city, 'state', d.state, 'pinCode', d.pin_code)
  into v_bill_to_snapshot
  from public.dealers d left join public.gst_registrations g on g.id = d.gst_registration_id
  where d.id = p_bill_to_dealer_id and d.organisation_id = p_organisation_id;
  if v_bill_to_snapshot is null then raise exception 'bill-to dealer not found' using errcode = '42501'; end if;

  select pg_catalog.jsonb_build_object('dealerId', d.id, 'code', d.code, 'name', d.name,
           'gstin', g.gstin, 'addressLine1', d.address_line1, 'city', d.city, 'state', d.state, 'pinCode', d.pin_code)
  into v_ship_to_snapshot
  from public.dealers d left join public.gst_registrations g on g.id = d.gst_registration_id
  where d.id = p_ship_to_dealer_id and d.organisation_id = p_organisation_id;
  if v_ship_to_snapshot is null then raise exception 'ship-to dealer not found' using errcode = '42501'; end if;

  if p_ship_to_location_id is not null and not exists (
    select 1 from public.dealer_locations
    where id = p_ship_to_location_id and organisation_id = p_organisation_id and dealer_id = p_ship_to_dealer_id
  ) then
    raise exception 'ship-to location does not belong to the ship-to dealer' using errcode = '42501';
  end if;

  if p_delivery_preference not in ('ASAP', 'REQUESTED_DATE') then
    raise exception 'invalid delivery preference' using errcode = '22023';
  end if;
  if p_delivery_preference = 'REQUESTED_DATE' and p_requested_delivery_date is null then
    raise exception 'requested delivery date required' using errcode = '22023';
  end if;

  select id into v_draft_id from public.draft_orders
  where organisation_id = p_organisation_id and dealer_id = p_dealer_id
  for update;
  if v_draft_id is null then raise exception 'current order is empty' using errcode = '22023'; end if;

  for v_line in
    select l.id as draft_line_id, l.commercial_offering_id, o.product_colourway_id,
      o.mrp_minor, o.currency_code, o.moq_pairs, o.order_multiple, o.opens_at, o.closes_at,
      sum(s.quantity_pairs)::integer as total_pairs
    from public.draft_order_lines l
    join public.draft_order_line_sizes s on s.draft_order_line_id = l.id
    join public.commercial_offerings o on o.id = l.commercial_offering_id
    join public.product_colourways c on c.id = o.product_colourway_id
    where l.draft_order_id = v_draft_id
      and l.organisation_id = p_organisation_id
      and o.organisation_id = p_organisation_id
      and c.organisation_id = p_organisation_id
      and o.published_at is not null
      and c.published_at is not null
    group by l.id, l.commercial_offering_id, o.product_colourway_id, o.mrp_minor,
      o.currency_code, o.moq_pairs, o.order_multiple, o.opens_at, o.closes_at
  loop
    if v_line.opens_at is not null and p_now < v_line.opens_at then raise exception 'offering is not open' using errcode = '22023'; end if;
    if v_line.closes_at is not null and p_now > v_line.closes_at then raise exception 'offering is closed' using errcode = '22023'; end if;
    if v_line.total_pairs < v_line.moq_pairs or mod(v_line.total_pairs, v_line.order_multiple) <> 0 then
      raise exception 'draft violates MOQ or order_multiple' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.draft_order_line_sizes s
      where s.draft_order_line_id = v_line.draft_line_id
        and not exists (
          select 1 from public.product_size_values psv
          where psv.product_colourway_id = v_line.product_colourway_id
            and psv.size_value_id = s.size_value_id and psv.enabled
        )
    ) then raise exception 'draft includes disabled size' using errcode = '22023'; end if;
    v_retail_value := v_retail_value + (v_line.mrp_minor * v_line.total_pairs);
  end loop;
  if not found or v_retail_value <= 0 then raise exception 'current order is empty' using errcode = '22023'; end if;

  begin
    v_correlation_id := p_correlation_id::uuid;
  exception when invalid_text_representation then
    v_correlation_id := gen_random_uuid();
  end;

  insert into public.order_number_counters (organisation_id, period, last_value)
  values (p_organisation_id, pg_catalog.to_char(p_now, 'YYMM'), 1)
  on conflict (organisation_id, period)
  do update set last_value = public.order_number_counters.last_value + 1
  returning last_value into v_order_seq;
  v_order_number := 'KIT-' || pg_catalog.to_char(p_now, 'YYMM') || '-' || pg_catalog.lpad(v_order_seq::text, 5, '0');

  insert into public.orders (
    organisation_id, dealer_id, order_number, status, current_version_no, idempotency_key, submitted_at,
    bill_to_dealer_id, ship_to_dealer_id, ship_to_location_id,
    ordering_dealer_snapshot, bill_to_snapshot, ship_to_snapshot,
    dealer_po_number, delivery_preference, requested_delivery_date
  ) values (
    p_organisation_id, p_dealer_id,
    v_order_number,
    'SUBMITTED', 1, p_idempotency_key, p_now,
    p_bill_to_dealer_id, p_ship_to_dealer_id, p_ship_to_location_id,
    v_ordering_snapshot, v_bill_to_snapshot, v_ship_to_snapshot,
    nullif(trim(p_dealer_po_number), ''), p_delivery_preference, p_requested_delivery_date
  ) returning id into v_order_id;

  insert into public.order_versions (
    organisation_id, order_id, version_no, version_status, retail_value_minor,
    currency_code, otp_challenge_id, created_by
  ) values (
    p_organisation_id, v_order_id, 1, 'SUBMITTED', v_retail_value,
    'INR', p_otp_challenge_id, p_actor_auth_user_id
  ) returning id into v_version_id;

  for v_line in
    select l.id as draft_line_id, l.commercial_offering_id, o.product_colourway_id,
      o.mrp_minor, sum(s.quantity_pairs)::integer as total_pairs
    from public.draft_order_lines l
    join public.draft_order_line_sizes s on s.draft_order_line_id = l.id
    join public.commercial_offerings o on o.id = l.commercial_offering_id
    where l.draft_order_id = v_draft_id
    group by l.id, l.commercial_offering_id, o.product_colourway_id, o.mrp_minor
  loop
    insert into public.order_lines (
      organisation_id, order_version_id, commercial_offering_id, product_colourway_id,
      mrp_minor, approved_quantity_pairs
    ) values (
      p_organisation_id, v_version_id, v_line.commercial_offering_id, v_line.product_colourway_id,
      v_line.mrp_minor, v_line.total_pairs
    ) returning id into v_order_line_id;
    insert into public.order_line_sizes (
      organisation_id, order_line_id, size_value_id, ordered_quantity_pairs, approved_quantity_pairs
    ) select p_organisation_id, v_order_line_id, size_value_id, quantity_pairs, quantity_pairs
      from public.draft_order_line_sizes where draft_order_line_id = v_line.draft_line_id;
  end loop;

  insert into public.order_status_history (organisation_id, order_id, from_status, to_status, changed_by)
  values (p_organisation_id, v_order_id, null, 'SUBMITTED', p_actor_auth_user_id);
  insert into public.audit_events (
    organisation_id, dealer_id, actor_auth_user_id, event_type, entity_type, entity_id, correlation_id,
    evidence
  ) values (
    p_organisation_id, p_dealer_id, p_actor_auth_user_id, 'ORDER_SUBMITTED', 'ORDER', v_order_id,
    v_correlation_id, pg_catalog.jsonb_build_object(
      'version', 1, 'otp_challenge_id', p_otp_challenge_id,
      'bill_to_dealer_id', p_bill_to_dealer_id, 'ship_to_dealer_id', p_ship_to_dealer_id
    )
  );
  delete from public.draft_orders where id = v_draft_id;
  return pg_catalog.jsonb_build_object('order_id', v_order_id, 'created', true);
end;
$$;

revoke all on function public.submit_kitco_order_v5(uuid, uuid, uuid, text, uuid, timestamptz, text, uuid, uuid, uuid, text, text, date)
  from public, anon, authenticated;
grant execute on function public.submit_kitco_order_v5(uuid, uuid, uuid, text, uuid, timestamptz, text, uuid, uuid, uuid, text, text, date)
  to service_role;
