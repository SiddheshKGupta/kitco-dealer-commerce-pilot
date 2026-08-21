-- Bind dealer-authored rows to the canonical relationships they claim.
-- RLS ownership checks alone are not sufficient when a mutable row carries
-- foreign keys that could otherwise point at another dealer's records.

drop policy if exists cancellation_requests_dealer_insert on public.cancellation_requests;
create policy cancellation_requests_dealer_insert
on public.cancellation_requests
for insert
to authenticated
with check (
  cancellation_requests.status = 'PENDING'
  and cancellation_requests.decided_at is null
  and exists (
    select 1
    from public.orders o
    where o.id = cancellation_requests.order_id
      and o.organisation_id = cancellation_requests.organisation_id
      and o.dealer_id = cancellation_requests.dealer_id
      and o.status in ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED')
      and (select private.is_current_dealer(o.dealer_id, o.organisation_id))
  )
);

drop policy if exists draft_orders_dealer_insert on public.draft_orders;
drop policy if exists draft_orders_dealer_update on public.draft_orders;
create policy draft_orders_dealer_insert
on public.draft_orders
for insert
to authenticated
with check (
  (select private.is_current_dealer(draft_orders.dealer_id, draft_orders.organisation_id))
  and (
    draft_orders.bill_to_location_id is null
    or exists (
      select 1
      from public.dealer_locations bill_to
      where bill_to.id = draft_orders.bill_to_location_id
        and bill_to.organisation_id = draft_orders.organisation_id
        and bill_to.dealer_id = draft_orders.dealer_id
        and bill_to.location_type in ('BILL_TO', 'BOTH')
        and bill_to.active
    )
  )
);
create policy draft_orders_dealer_update
on public.draft_orders
for update
to authenticated
using ((select private.is_current_dealer(draft_orders.dealer_id, draft_orders.organisation_id)))
with check (
  (select private.is_current_dealer(draft_orders.dealer_id, draft_orders.organisation_id))
  and (
    draft_orders.bill_to_location_id is null
    or exists (
      select 1
      from public.dealer_locations bill_to
      where bill_to.id = draft_orders.bill_to_location_id
        and bill_to.organisation_id = draft_orders.organisation_id
        and bill_to.dealer_id = draft_orders.dealer_id
        and bill_to.location_type in ('BILL_TO', 'BOTH')
        and bill_to.active
    )
  )
);

drop policy if exists draft_order_lines_dealer_insert on public.draft_order_lines;
drop policy if exists draft_order_lines_dealer_update on public.draft_order_lines;
create policy draft_order_lines_dealer_insert
on public.draft_order_lines
for insert
to authenticated
with check (
  exists (
    select 1
    from public.draft_orders draft
    join public.commercial_offerings offering
      on offering.id = draft_order_lines.commercial_offering_id
     and offering.organisation_id = draft_order_lines.organisation_id
     and offering.published_at is not null
    where draft.id = draft_order_lines.draft_order_id
      and draft.organisation_id = draft_order_lines.organisation_id
      and (select private.is_current_dealer(draft.dealer_id, draft.organisation_id))
  )
);
create policy draft_order_lines_dealer_update
on public.draft_order_lines
for update
to authenticated
using (
  exists (
    select 1 from public.draft_orders draft
    where draft.id = draft_order_lines.draft_order_id
      and (select private.is_current_dealer(draft.dealer_id, draft.organisation_id))
  )
)
with check (
  exists (
    select 1
    from public.draft_orders draft
    join public.commercial_offerings offering
      on offering.id = draft_order_lines.commercial_offering_id
     and offering.organisation_id = draft_order_lines.organisation_id
     and offering.published_at is not null
    where draft.id = draft_order_lines.draft_order_id
      and draft.organisation_id = draft_order_lines.organisation_id
      and (select private.is_current_dealer(draft.dealer_id, draft.organisation_id))
  )
);

drop policy if exists draft_order_line_sizes_dealer_insert on public.draft_order_line_sizes;
drop policy if exists draft_order_line_sizes_dealer_update on public.draft_order_line_sizes;
create policy draft_order_line_sizes_dealer_insert
on public.draft_order_line_sizes
for insert
to authenticated
with check (
  exists (
    select 1
    from public.draft_order_lines line
    join public.draft_orders draft on draft.id = line.draft_order_id
    join public.commercial_offerings offering
      on offering.id = line.commercial_offering_id
     and offering.organisation_id = draft_order_line_sizes.organisation_id
     and offering.published_at is not null
    join public.product_size_values enabled_size
      on enabled_size.product_colourway_id = offering.product_colourway_id
     and enabled_size.size_value_id = draft_order_line_sizes.size_value_id
     and enabled_size.organisation_id = draft_order_line_sizes.organisation_id
     and enabled_size.enabled
    where line.id = draft_order_line_sizes.draft_order_line_id
      and line.organisation_id = draft_order_line_sizes.organisation_id
      and draft.organisation_id = draft_order_line_sizes.organisation_id
      and (select private.is_current_dealer(draft.dealer_id, draft.organisation_id))
  )
);
create policy draft_order_line_sizes_dealer_update
on public.draft_order_line_sizes
for update
to authenticated
using (
  exists (
    select 1
    from public.draft_order_lines line
    join public.draft_orders draft on draft.id = line.draft_order_id
    where line.id = draft_order_line_sizes.draft_order_line_id
      and (select private.is_current_dealer(draft.dealer_id, draft.organisation_id))
  )
)
with check (
  exists (
    select 1
    from public.draft_order_lines line
    join public.draft_orders draft on draft.id = line.draft_order_id
    join public.commercial_offerings offering
      on offering.id = line.commercial_offering_id
     and offering.organisation_id = draft_order_line_sizes.organisation_id
     and offering.published_at is not null
    join public.product_size_values enabled_size
      on enabled_size.product_colourway_id = offering.product_colourway_id
     and enabled_size.size_value_id = draft_order_line_sizes.size_value_id
     and enabled_size.organisation_id = draft_order_line_sizes.organisation_id
     and enabled_size.enabled
    where line.id = draft_order_line_sizes.draft_order_line_id
      and line.organisation_id = draft_order_line_sizes.organisation_id
      and draft.organisation_id = draft_order_line_sizes.organisation_id
      and (select private.is_current_dealer(draft.dealer_id, draft.organisation_id))
  )
);

drop policy if exists draft_delivery_allocations_dealer_insert on public.draft_delivery_allocations;
drop policy if exists draft_delivery_allocations_dealer_update on public.draft_delivery_allocations;
create policy draft_delivery_allocations_dealer_insert
on public.draft_delivery_allocations
for insert
to authenticated
with check (
  exists (
    select 1
    from public.draft_order_line_sizes size_line
    join public.draft_order_lines line on line.id = size_line.draft_order_line_id
    join public.draft_orders draft on draft.id = line.draft_order_id
    join public.dealer_locations ship_to
      on ship_to.id = draft_delivery_allocations.dealer_location_id
     and ship_to.organisation_id = draft_delivery_allocations.organisation_id
     and ship_to.dealer_id = draft.dealer_id
     and ship_to.location_type in ('SHIP_TO', 'BOTH')
     and ship_to.active
    where size_line.id = draft_delivery_allocations.draft_order_line_size_id
      and size_line.organisation_id = draft_delivery_allocations.organisation_id
      and line.organisation_id = draft_delivery_allocations.organisation_id
      and draft.organisation_id = draft_delivery_allocations.organisation_id
      and (select private.is_current_dealer(draft.dealer_id, draft.organisation_id))
  )
);
create policy draft_delivery_allocations_dealer_update
on public.draft_delivery_allocations
for update
to authenticated
using (
  exists (
    select 1
    from public.draft_order_line_sizes size_line
    join public.draft_order_lines line on line.id = size_line.draft_order_line_id
    join public.draft_orders draft on draft.id = line.draft_order_id
    where size_line.id = draft_delivery_allocations.draft_order_line_size_id
      and (select private.is_current_dealer(draft.dealer_id, draft.organisation_id))
  )
)
with check (
  exists (
    select 1
    from public.draft_order_line_sizes size_line
    join public.draft_order_lines line on line.id = size_line.draft_order_line_id
    join public.draft_orders draft on draft.id = line.draft_order_id
    join public.dealer_locations ship_to
      on ship_to.id = draft_delivery_allocations.dealer_location_id
     and ship_to.organisation_id = draft_delivery_allocations.organisation_id
     and ship_to.dealer_id = draft.dealer_id
     and ship_to.location_type in ('SHIP_TO', 'BOTH')
     and ship_to.active
    where size_line.id = draft_delivery_allocations.draft_order_line_size_id
      and size_line.organisation_id = draft_delivery_allocations.organisation_id
      and line.organisation_id = draft_delivery_allocations.organisation_id
      and draft.organisation_id = draft_delivery_allocations.organisation_id
      and (select private.is_current_dealer(draft.dealer_id, draft.organisation_id))
  )
);
