-- Phase 4 schema: order partner functions + immutable snapshots, PO number,
-- delivery dates, and the size system lookup. Column names and shapes are exactly
-- those frozen in docs/spec/V5_DATA_MODEL.md §6 -- written once here so the three
-- Phase 4/5/7 workstreams build against one real schema instead of each guessing.
--
-- Snapshots are jsonb, taken at submission, and never updated afterward: a dealer
-- renaming itself or editing its GSTIN next year must not silently rewrite last
-- year's invoice (V5_DEALER_GROUP_MODEL.md §3).

alter table public.orders
  add column if not exists bill_to_dealer_id uuid references public.dealers(id),
  add column if not exists ship_to_dealer_id uuid references public.dealers(id),
  add column if not exists ship_to_location_id uuid references public.dealer_locations(id),
  add column if not exists ordering_dealer_snapshot jsonb,
  add column if not exists bill_to_snapshot jsonb,
  add column if not exists ship_to_snapshot jsonb,
  add column if not exists dealer_po_number text,
  add column if not exists delivery_preference text,
  add column if not exists requested_delivery_date date,
  add column if not exists estimated_delivery_date date;

alter table public.orders
  add constraint orders_delivery_preference_check
  check (delivery_preference is null or delivery_preference in ('ASAP', 'REQUESTED_DATE'));

alter table public.orders
  add constraint orders_requested_delivery_date_check
  check (delivery_preference <> 'REQUESTED_DATE' or requested_delivery_date is not null);

-- Backfill: the pilot's existing orders predate partner functions entirely, so
-- ordering, bill-to and ship-to are all the same dealer -- exactly v4's behaviour,
-- which is the documented safe default for any dealer with no group
-- (V5_DEALER_GROUP_MODEL.md §7). Snapshots are built from the dealer row as it
-- stands today since no earlier snapshot ever existed to preserve.
update public.orders o
set bill_to_dealer_id = coalesce(o.bill_to_dealer_id, o.dealer_id),
    ship_to_dealer_id = coalesce(o.ship_to_dealer_id, o.dealer_id),
    delivery_preference = coalesce(o.delivery_preference, 'ASAP'),
    ordering_dealer_snapshot = coalesce(o.ordering_dealer_snapshot,
      (select jsonb_build_object('dealerId', d.id, 'code', d.code, 'name', d.name,
                'gstin', g.gstin, 'addressLine1', d.address_line1, 'city', d.city, 'state', d.state, 'pinCode', d.pin_code)
       from public.dealers d left join public.gst_registrations g on g.id = d.gst_registration_id
       where d.id = o.dealer_id)),
    bill_to_snapshot = coalesce(o.bill_to_snapshot,
      (select jsonb_build_object('dealerId', d.id, 'code', d.code, 'name', d.name,
                'gstin', g.gstin, 'addressLine1', d.address_line1, 'city', d.city, 'state', d.state, 'pinCode', d.pin_code)
       from public.dealers d left join public.gst_registrations g on g.id = d.gst_registration_id
       where d.id = o.dealer_id)),
    ship_to_snapshot = coalesce(o.ship_to_snapshot,
      (select jsonb_build_object('dealerId', d.id, 'code', d.code, 'name', d.name,
                'gstin', g.gstin, 'addressLine1', d.address_line1, 'city', d.city, 'state', d.state, 'pinCode', d.pin_code)
       from public.dealers d left join public.gst_registrations g on g.id = d.gst_registration_id
       where d.id = o.dealer_id));

-- From here on every new order must carry a full partner set; only the backfilled
-- rows above were ever allowed to arrive via default.
alter table public.orders
  alter column bill_to_dealer_id set not null,
  alter column ship_to_dealer_id set not null,
  alter column ordering_dealer_snapshot set not null,
  alter column bill_to_snapshot set not null,
  alter column ship_to_snapshot set not null,
  alter column delivery_preference set not null;

comment on column public.orders.ship_to_location_id is
  'Nullable: a dealer with no dealer_locations rows (the pre-v5 default) ships to the
   Ship-To dealer''s registered address with no location selection.';

-- Size system lookup (V5_PRODUCT_SPEC.md §4, "Size System is never optional").
-- Admin-extensible: KITCO can add a system beyond the five below without a migration.
create table if not exists public.size_systems (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  code text not null,
  label text not null,
  created_at timestamptz not null default now(),
  unique (organisation_id, code)
);
alter table public.size_systems enable row level security;
alter table public.size_systems force row level security;

alter table public.size_sets add column if not exists size_system_id uuid references public.size_systems(id);

insert into public.size_systems (organisation_id, code, label)
select o.id, v.code, v.label
from public.organisations o
cross join (values ('US','US'), ('UK','UK'), ('EU','EU'), ('CM','CM'), ('IN','IN')) as v(code, label)
on conflict (organisation_id, code) do nothing;
