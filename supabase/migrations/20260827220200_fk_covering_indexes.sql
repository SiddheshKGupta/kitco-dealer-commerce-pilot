-- Unindexed foreign keys (advisor INFO, performance). Column lists confirmed against
-- information_schema.key_column_usage -- three of these FKs are composite
-- (organisation_id, <column>) pairs enforcing same-tenant references, and a single-column
-- index on just the referencing column (several already exist, e.g.
-- dealers_dealer_group_id_idx) does not cover a composite constraint.
create index dealer_applications_created_dealer_id_idx on public.dealer_applications (created_dealer_id);
create index dealer_applications_reviewed_by_idx on public.dealer_applications (reviewed_by);
create index dgmr_decided_by_idx on public.dealer_group_membership_requests (decided_by);
create index dealer_groups_organisation_id_primary_dealer_id_idx on public.dealer_groups (organisation_id, primary_dealer_id);
create index dealers_organisation_id_dealer_group_id_idx on public.dealers (organisation_id, dealer_group_id);
create index dealers_organisation_id_gst_registration_id_idx on public.dealers (organisation_id, gst_registration_id);
create index orders_bill_to_dealer_id_idx on public.orders (bill_to_dealer_id);
create index orders_ship_to_dealer_id_idx on public.orders (ship_to_dealer_id);
create index orders_ship_to_location_id_idx on public.orders (ship_to_location_id);
create index size_sets_size_system_id_idx on public.size_sets (size_system_id);
