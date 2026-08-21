create schema private;
revoke all on schema private from public, anon, authenticated;

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.dealers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  code text not null,
  name text not null,
  state text,
  city text,
  master_email text,
  pilot_email text,
  pilot_email_source text check (pilot_email_source in ('MASTER', 'SELF_DECLARED_PILOT')),
  activation_status text not null default 'UNACTIVATED' check (activation_status in ('UNACTIVATED', 'DEALER_SELECTED', 'EMAIL_SELECTED', 'EMAIL_OTP_PENDING', 'EMAIL_VERIFIED', 'PASSWORD_CREATED', 'ACTIVE')),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, code),
  unique (organisation_id, id)
);

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  dealer_id uuid,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  app_role text not null default 'DEALER' check (app_role in ('DEALER', 'ADMIN')),
  created_at timestamptz not null default now(),
  unique (organisation_id, auth_user_id),
  foreign key (organisation_id, dealer_id) references public.dealers(organisation_id, id)
);

create table public.dealer_source_records (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  dealer_id uuid not null references public.dealers(id), source_file_id uuid, source_row integer not null,
  raw_record jsonb not null, created_at timestamptz not null default now()
);
create table public.dealer_gst_registrations (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  dealer_id uuid not null references public.dealers(id), gstin text not null, is_primary boolean not null default false,
  created_at timestamptz not null default now(), unique (organisation_id, gstin)
);
create table public.dealer_locations (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  dealer_id uuid not null references public.dealers(id), name text not null, location_type text not null check (location_type in ('BILL_TO', 'SHIP_TO', 'BOTH')),
  address jsonb not null default '{}'::jsonb, active boolean not null default true, created_at timestamptz not null default now()
);
create table public.dealer_seller_mappings (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  dealer_id uuid not null references public.dealers(id), brand_code text not null, seller_code text not null,
  created_at timestamptz not null default now(), unique (organisation_id, brand_code, seller_code)
);

create table public.brands (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  code text not null, name text not null, active boolean not null default true, created_at timestamptz not null default now(),
  unique (organisation_id, code)
);
create table public.product_families (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  brand_id uuid not null references public.brands(id), family_key text not null, name text, category text, gender text,
  created_at timestamptz not null default now(), unique (organisation_id, brand_id, family_key)
);
create table public.product_colourways (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  product_family_id uuid not null references public.product_families(id), article_no text not null, colour text,
  mrp_minor bigint not null check (mrp_minor >= 0), currency_code text not null default 'INR', published_at timestamptz,
  created_at timestamptz not null default now(), unique (organisation_id, article_no)
);
create table public.size_sets (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  code text not null, name text not null, created_at timestamptz not null default now(), unique (organisation_id, code)
);
create table public.size_values (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  size_set_id uuid not null references public.size_sets(id), label text not null, sort_order integer not null,
  created_at timestamptz not null default now(), unique (size_set_id, label)
);
create table public.product_size_values (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  product_colourway_id uuid not null references public.product_colourways(id), size_value_id uuid not null references public.size_values(id),
  enabled boolean not null default true, created_at timestamptz not null default now(), unique (product_colourway_id, size_value_id)
);
create table public.product_media (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  product_colourway_id uuid not null references public.product_colourways(id), object_key text not null,
  media_kind text not null check (media_kind in ('SOURCE', 'WEBP_200', 'WEBP_600', 'WEBP_900', 'WEBP_1400')),
  content_sha256 text not null, width integer not null check (width > 0), height integer not null check (height > 0),
  published_at timestamptz, created_at timestamptz not null default now(), unique (organisation_id, object_key)
);
create table public.seasons (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  code text not null, name text not null, starts_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now(),
  unique (organisation_id, code)
);
create table public.delivery_windows (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  code text not null, name text not null, opens_at timestamptz not null, closes_at timestamptz not null,
  created_at timestamptz not null default now(), check (closes_at > opens_at), unique (organisation_id, code)
);
create table public.commercial_offerings (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  product_colourway_id uuid not null references public.product_colourways(id), season_id uuid references public.seasons(id),
  delivery_window_id uuid references public.delivery_windows(id), offering_type text not null check (offering_type in ('STOCK_IN_HAND', 'UPCOMING', 'PREBOOK')),
  mrp_minor bigint not null check (mrp_minor >= 0), currency_code text not null default 'INR', moq_pairs integer not null default 1 check (moq_pairs > 0),
  order_multiple integer not null default 1 check (order_multiple > 0), opens_at timestamptz, closes_at timestamptz,
  published_at timestamptz, created_at timestamptz not null default now()
);

create table public.import_profiles (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  code text not null, source_kind text not null, active boolean not null default true, created_at timestamptz not null default now(),
  unique (organisation_id, code)
);
create table public.source_files (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  object_key text not null, original_name text not null, content_sha256 text not null, byte_size bigint not null check (byte_size >= 0),
  mime_type text not null, uploaded_by uuid references auth.users(id), created_at timestamptz not null default now(),
  unique (organisation_id, content_sha256)
);
alter table public.dealer_source_records add constraint dealer_source_records_source_file_id_fkey foreign key (source_file_id) references public.source_files(id);
create table public.catalogue_import_jobs (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  source_file_id uuid not null references public.source_files(id), import_profile_id uuid not null references public.import_profiles(id),
  status text not null check (status in ('UPLOADED', 'STAGED', 'VALIDATED', 'COMMITTED', 'FAILED')),
  committed_at timestamptz, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table public.catalogue_import_rows (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  catalogue_import_job_id uuid not null references public.catalogue_import_jobs(id) on delete cascade, source_locator text not null,
  row_status text not null check (row_status in ('READY', 'WARNING', 'CONFLICT', 'NEEDS_ENRICHMENT', 'ERROR', 'IGNORED')),
  raw_record jsonb not null, normalized_record jsonb, validation_messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create table public.master_source_links (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  catalogue_import_row_id uuid not null references public.catalogue_import_rows(id), entity_type text not null, entity_id uuid not null,
  canonical_field text not null, created_at timestamptz not null default now()
);
create table public.stock_snapshots (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  catalogue_import_job_id uuid not null references public.catalogue_import_jobs(id), snapshot_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.stock_snapshot_lines (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  stock_snapshot_id uuid not null references public.stock_snapshots(id) on delete cascade,
  product_colourway_id uuid not null references public.product_colourways(id), size_value_id uuid not null references public.size_values(id),
  quantity_pairs integer not null check (quantity_pairs >= 0), created_at timestamptz not null default now(),
  unique (stock_snapshot_id, product_colourway_id, size_value_id)
);

create table public.schemes (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  code text not null, name text not null, starts_at timestamptz not null, ends_at timestamptz not null,
  published_at timestamptz, created_at timestamptz not null default now(), check (ends_at > starts_at), unique (organisation_id, code)
);
create table public.scheme_targets (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  scheme_id uuid not null references public.schemes(id) on delete cascade, brand_id uuid references public.brands(id),
  product_colourway_id uuid references public.product_colourways(id), created_at timestamptz not null default now()
);
create table public.scheme_audiences (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  scheme_id uuid not null references public.schemes(id) on delete cascade, dealer_id uuid references public.dealers(id),
  created_at timestamptz not null default now()
);
create table public.scheme_rules (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  scheme_id uuid not null references public.schemes(id) on delete cascade, rule_type text not null, rule jsonb not null,
  created_at timestamptz not null default now()
);

create table public.draft_orders (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  dealer_id uuid not null references public.dealers(id), bill_to_location_id uuid references public.dealer_locations(id),
  updated_at timestamptz not null default now(), created_at timestamptz not null default now(), unique (organisation_id, dealer_id)
);
create table public.draft_order_lines (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  draft_order_id uuid not null references public.draft_orders(id) on delete cascade,
  commercial_offering_id uuid not null references public.commercial_offerings(id), created_at timestamptz not null default now(),
  unique (draft_order_id, commercial_offering_id)
);
create table public.draft_order_line_sizes (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  draft_order_line_id uuid not null references public.draft_order_lines(id) on delete cascade,
  size_value_id uuid not null references public.size_values(id), quantity_pairs integer not null check (quantity_pairs > 0),
  created_at timestamptz not null default now(), unique (draft_order_line_id, size_value_id)
);
create table public.draft_delivery_allocations (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  draft_order_line_size_id uuid not null references public.draft_order_line_sizes(id) on delete cascade,
  dealer_location_id uuid not null references public.dealer_locations(id), quantity_pairs integer not null check (quantity_pairs > 0),
  created_at timestamptz not null default now(), unique (draft_order_line_size_id, dealer_location_id)
);
create table public.orders (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  dealer_id uuid not null references public.dealers(id), order_number text not null, status text not null check (status in ('SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'CANCELLED')),
  current_version_no integer not null default 1 check (current_version_no > 0), idempotency_key text not null,
  submitted_at timestamptz not null, created_at timestamptz not null default now(),
  unique (organisation_id, order_number), unique (organisation_id, dealer_id, idempotency_key)
);
create table public.order_versions (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  order_id uuid not null references public.orders(id), version_no integer not null check (version_no > 0),
  version_status text not null check (version_status in ('SUBMITTED', 'PROPOSED', 'ACCEPTED', 'REJECTED')),
  retail_value_minor bigint not null check (retail_value_minor >= 0), currency_code text not null default 'INR',
  otp_challenge_id uuid, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique (order_id, version_no)
);
create table public.order_lines (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  order_version_id uuid not null references public.order_versions(id), commercial_offering_id uuid not null references public.commercial_offerings(id),
  product_colourway_id uuid not null references public.product_colourways(id), mrp_minor bigint not null check (mrp_minor >= 0),
  approved_quantity_pairs integer not null check (approved_quantity_pairs >= 0), created_at timestamptz not null default now()
);
create table public.order_line_sizes (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  order_line_id uuid not null references public.order_lines(id), size_value_id uuid not null references public.size_values(id),
  ordered_quantity_pairs integer not null check (ordered_quantity_pairs >= 0), approved_quantity_pairs integer not null check (approved_quantity_pairs >= 0),
  created_at timestamptz not null default now(), unique (order_line_id, size_value_id)
);
create table public.order_delivery_allocations (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  order_line_size_id uuid not null references public.order_line_sizes(id), dealer_location_id uuid not null references public.dealer_locations(id),
  quantity_pairs integer not null check (quantity_pairs >= 0), created_at timestamptz not null default now()
);
create table public.order_status_history (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  order_id uuid not null references public.orders(id), from_status text, to_status text not null, reason text,
  changed_by uuid not null references auth.users(id), changed_at timestamptz not null default now()
);

create table public.dispatches (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  order_id uuid not null references public.orders(id), dispatch_number text not null, status text not null check (status in ('DRAFT', 'FINALISED', 'VOID')),
  dispatched_at timestamptz, created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  unique (organisation_id, dispatch_number)
);
create table public.dispatch_lines (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  dispatch_id uuid not null references public.dispatches(id), order_line_size_id uuid not null references public.order_line_sizes(id),
  dealer_location_id uuid not null references public.dealer_locations(id), quantity_pairs integer not null check (quantity_pairs > 0),
  created_at timestamptz not null default now()
);
create table public.holds (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  order_id uuid not null references public.orders(id), hold_type text not null check (hold_type in ('CREDIT', 'OPERATIONAL')),
  status text not null check (status in ('ACTIVE', 'RELEASED')), reason text not null, created_by uuid not null references auth.users(id),
  released_at timestamptz, created_at timestamptz not null default now()
);
create table public.hold_allocations (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  hold_id uuid not null references public.holds(id), order_line_size_id uuid references public.order_line_sizes(id),
  quantity_pairs integer check (quantity_pairs > 0), created_at timestamptz not null default now()
);
create table public.cancellation_requests (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  order_id uuid not null references public.orders(id), dealer_id uuid not null references public.dealers(id),
  reason text not null, status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  decided_at timestamptz, created_at timestamptz not null default now()
);

create table public.otp_challenges (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  dealer_id uuid not null references public.dealers(id), auth_user_id uuid references auth.users(id),
  purpose text not null check (purpose in ('ACTIVATION', 'LOGIN', 'ORDER_SUBMISSION', 'REVISION_ACCEPTANCE')),
  code_hash text not null, expires_at timestamptz not null, attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0), consumed_at timestamptz,
  correlation_id uuid not null, provider_delivery_id text, created_at timestamptz not null default now()
);
alter table public.order_versions add constraint order_versions_otp_challenge_id_fkey foreign key (otp_challenge_id) references public.otp_challenges(id);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  dealer_id uuid references public.dealers(id), actor_auth_user_id uuid references auth.users(id), event_type text not null,
  entity_type text not null, entity_id uuid, correlation_id uuid not null, evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create table public.export_jobs (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id),
  dealer_id uuid references public.dealers(id), export_type text not null, status text not null check (status in ('QUEUED', 'RUNNING', 'COMPLETE', 'FAILED')),
  object_key text, requested_by uuid not null references auth.users(id), created_at timestamptz not null default now(), completed_at timestamptz
);

-- PostgreSQL does not create indexes for foreign keys. Index every ownership and join key.
create index dealers_organisation_id_idx on public.dealers (organisation_id);
create index app_users_organisation_id_idx on public.app_users (organisation_id);
create index app_users_auth_user_id_idx on public.app_users (auth_user_id);
create index app_users_dealer_id_idx on public.app_users (dealer_id);
create index dealer_source_records_organisation_id_idx on public.dealer_source_records (organisation_id);
create index dealer_source_records_dealer_id_idx on public.dealer_source_records (dealer_id);
create index dealer_source_records_source_file_id_idx on public.dealer_source_records (source_file_id);
create index dealer_gst_registrations_organisation_id_idx on public.dealer_gst_registrations (organisation_id);
create index dealer_gst_registrations_dealer_id_idx on public.dealer_gst_registrations (dealer_id);
create index dealer_locations_organisation_id_idx on public.dealer_locations (organisation_id);
create index dealer_locations_dealer_id_idx on public.dealer_locations (dealer_id);
create index dealer_seller_mappings_organisation_id_idx on public.dealer_seller_mappings (organisation_id);
create index dealer_seller_mappings_dealer_id_idx on public.dealer_seller_mappings (dealer_id);
create index brands_organisation_id_idx on public.brands (organisation_id);
create index product_families_organisation_id_idx on public.product_families (organisation_id);
create index product_families_brand_id_idx on public.product_families (brand_id);
create index product_colourways_organisation_id_idx on public.product_colourways (organisation_id);
create index product_colourways_product_family_id_idx on public.product_colourways (product_family_id);
create index size_sets_organisation_id_idx on public.size_sets (organisation_id);
create index size_values_organisation_id_idx on public.size_values (organisation_id);
create index size_values_size_set_id_idx on public.size_values (size_set_id);
create index product_size_values_organisation_id_idx on public.product_size_values (organisation_id);
create index product_size_values_product_colourway_id_idx on public.product_size_values (product_colourway_id);
create index product_size_values_size_value_id_idx on public.product_size_values (size_value_id);
create index product_media_organisation_id_idx on public.product_media (organisation_id);
create index product_media_product_colourway_id_idx on public.product_media (product_colourway_id);
create index seasons_organisation_id_idx on public.seasons (organisation_id);
create index delivery_windows_organisation_id_idx on public.delivery_windows (organisation_id);
create index commercial_offerings_organisation_id_idx on public.commercial_offerings (organisation_id);
create index commercial_offerings_product_colourway_id_idx on public.commercial_offerings (product_colourway_id);
create index commercial_offerings_season_id_idx on public.commercial_offerings (season_id);
create index commercial_offerings_delivery_window_id_idx on public.commercial_offerings (delivery_window_id);
create index import_profiles_organisation_id_idx on public.import_profiles (organisation_id);
create index source_files_organisation_id_idx on public.source_files (organisation_id);
create index source_files_uploaded_by_idx on public.source_files (uploaded_by);
create index catalogue_import_jobs_organisation_id_idx on public.catalogue_import_jobs (organisation_id);
create index catalogue_import_jobs_source_file_id_idx on public.catalogue_import_jobs (source_file_id);
create index catalogue_import_jobs_import_profile_id_idx on public.catalogue_import_jobs (import_profile_id);
create index catalogue_import_jobs_created_by_idx on public.catalogue_import_jobs (created_by);
create index catalogue_import_rows_organisation_id_idx on public.catalogue_import_rows (organisation_id);
create index catalogue_import_rows_catalogue_import_job_id_idx on public.catalogue_import_rows (catalogue_import_job_id);
create index master_source_links_organisation_id_idx on public.master_source_links (organisation_id);
create index master_source_links_catalogue_import_row_id_idx on public.master_source_links (catalogue_import_row_id);
create index stock_snapshots_organisation_id_idx on public.stock_snapshots (organisation_id);
create index stock_snapshots_catalogue_import_job_id_idx on public.stock_snapshots (catalogue_import_job_id);
create index stock_snapshot_lines_organisation_id_idx on public.stock_snapshot_lines (organisation_id);
create index stock_snapshot_lines_stock_snapshot_id_idx on public.stock_snapshot_lines (stock_snapshot_id);
create index stock_snapshot_lines_product_colourway_id_idx on public.stock_snapshot_lines (product_colourway_id);
create index stock_snapshot_lines_size_value_id_idx on public.stock_snapshot_lines (size_value_id);
create index schemes_organisation_id_idx on public.schemes (organisation_id);
create index scheme_targets_organisation_id_idx on public.scheme_targets (organisation_id);
create index scheme_targets_scheme_id_idx on public.scheme_targets (scheme_id);
create index scheme_targets_brand_id_idx on public.scheme_targets (brand_id);
create index scheme_targets_product_colourway_id_idx on public.scheme_targets (product_colourway_id);
create index scheme_audiences_organisation_id_idx on public.scheme_audiences (organisation_id);
create index scheme_audiences_scheme_id_idx on public.scheme_audiences (scheme_id);
create index scheme_audiences_dealer_id_idx on public.scheme_audiences (dealer_id);
create index scheme_rules_organisation_id_idx on public.scheme_rules (organisation_id);
create index scheme_rules_scheme_id_idx on public.scheme_rules (scheme_id);
create index draft_orders_organisation_id_idx on public.draft_orders (organisation_id);
create index draft_orders_dealer_id_idx on public.draft_orders (dealer_id);
create index draft_orders_bill_to_location_id_idx on public.draft_orders (bill_to_location_id);
create index draft_order_lines_organisation_id_idx on public.draft_order_lines (organisation_id);
create index draft_order_lines_draft_order_id_idx on public.draft_order_lines (draft_order_id);
create index draft_order_lines_commercial_offering_id_idx on public.draft_order_lines (commercial_offering_id);
create index draft_order_line_sizes_organisation_id_idx on public.draft_order_line_sizes (organisation_id);
create index draft_order_line_sizes_draft_order_line_id_idx on public.draft_order_line_sizes (draft_order_line_id);
create index draft_order_line_sizes_size_value_id_idx on public.draft_order_line_sizes (size_value_id);
create index draft_delivery_allocations_organisation_id_idx on public.draft_delivery_allocations (organisation_id);
create index draft_delivery_allocations_draft_order_line_size_id_idx on public.draft_delivery_allocations (draft_order_line_size_id);
create index draft_delivery_allocations_dealer_location_id_idx on public.draft_delivery_allocations (dealer_location_id);
create index orders_organisation_id_idx on public.orders (organisation_id);
create index orders_dealer_id_idx on public.orders (dealer_id);
create index order_versions_organisation_id_idx on public.order_versions (organisation_id);
create index order_versions_order_id_idx on public.order_versions (order_id);
create index order_versions_otp_challenge_id_idx on public.order_versions (otp_challenge_id);
create index order_versions_created_by_idx on public.order_versions (created_by);
create index order_lines_organisation_id_idx on public.order_lines (organisation_id);
create index order_lines_order_version_id_idx on public.order_lines (order_version_id);
create index order_lines_commercial_offering_id_idx on public.order_lines (commercial_offering_id);
create index order_lines_product_colourway_id_idx on public.order_lines (product_colourway_id);
create index order_line_sizes_organisation_id_idx on public.order_line_sizes (organisation_id);
create index order_line_sizes_order_line_id_idx on public.order_line_sizes (order_line_id);
create index order_line_sizes_size_value_id_idx on public.order_line_sizes (size_value_id);
create index order_delivery_allocations_organisation_id_idx on public.order_delivery_allocations (organisation_id);
create index order_delivery_allocations_order_line_size_id_idx on public.order_delivery_allocations (order_line_size_id);
create index order_delivery_allocations_dealer_location_id_idx on public.order_delivery_allocations (dealer_location_id);
create index order_status_history_organisation_id_idx on public.order_status_history (organisation_id);
create index order_status_history_order_id_idx on public.order_status_history (order_id);
create index order_status_history_changed_by_idx on public.order_status_history (changed_by);
create index dispatches_organisation_id_idx on public.dispatches (organisation_id);
create index dispatches_order_id_idx on public.dispatches (order_id);
create index dispatches_created_by_idx on public.dispatches (created_by);
create index dispatch_lines_organisation_id_idx on public.dispatch_lines (organisation_id);
create index dispatch_lines_dispatch_id_idx on public.dispatch_lines (dispatch_id);
create index dispatch_lines_order_line_size_id_idx on public.dispatch_lines (order_line_size_id);
create index dispatch_lines_dealer_location_id_idx on public.dispatch_lines (dealer_location_id);
create index holds_organisation_id_idx on public.holds (organisation_id);
create index holds_order_id_idx on public.holds (order_id);
create index holds_created_by_idx on public.holds (created_by);
create index hold_allocations_organisation_id_idx on public.hold_allocations (organisation_id);
create index hold_allocations_hold_id_idx on public.hold_allocations (hold_id);
create index hold_allocations_order_line_size_id_idx on public.hold_allocations (order_line_size_id);
create index cancellation_requests_organisation_id_idx on public.cancellation_requests (organisation_id);
create index cancellation_requests_order_id_idx on public.cancellation_requests (order_id);
create index cancellation_requests_dealer_id_idx on public.cancellation_requests (dealer_id);
create index otp_challenges_organisation_id_idx on public.otp_challenges (organisation_id);
create index otp_challenges_dealer_id_idx on public.otp_challenges (dealer_id);
create index otp_challenges_auth_user_id_idx on public.otp_challenges (auth_user_id);
create index audit_events_organisation_id_idx on public.audit_events (organisation_id);
create index audit_events_dealer_id_idx on public.audit_events (dealer_id);
create index audit_events_actor_auth_user_id_idx on public.audit_events (actor_auth_user_id);
create index export_jobs_organisation_id_idx on public.export_jobs (organisation_id);
create index export_jobs_dealer_id_idx on public.export_jobs (dealer_id);
create index export_jobs_requested_by_idx on public.export_jobs (requested_by);

create or replace function private.is_current_organisation(target_organisation_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.app_users
    where auth_user_id = (select auth.uid()) and organisation_id = target_organisation_id
  );
$$;
create or replace function private.is_current_dealer(target_dealer_id uuid, target_organisation_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.app_users
    where auth_user_id = (select auth.uid()) and dealer_id = target_dealer_id
      and organisation_id = target_organisation_id and app_role = 'DEALER'
  );
$$;
revoke execute on function private.is_current_organisation(uuid) from public;
revoke execute on function private.is_current_dealer(uuid, uuid) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_current_organisation(uuid) to authenticated;
grant execute on function private.is_current_dealer(uuid, uuid) to authenticated;

create or replace function private.reject_mutation()
returns trigger language plpgsql set search_path = ''
as $$ begin raise exception '% is immutable', tg_table_name using errcode = '55000'; end; $$;
revoke execute on function private.reject_mutation() from public, anon, authenticated;

create trigger order_versions_immutable before update or delete on public.order_versions for each row execute function private.reject_mutation();
create trigger order_lines_immutable before update or delete on public.order_lines for each row execute function private.reject_mutation();
create trigger order_line_sizes_immutable before update or delete on public.order_line_sizes for each row execute function private.reject_mutation();
create trigger order_delivery_allocations_immutable before update or delete on public.order_delivery_allocations for each row execute function private.reject_mutation();
create trigger audit_events_append_only before update or delete on public.audit_events for each row execute function private.reject_mutation();

-- Explicit Data API grants: new Supabase projects no longer expose new tables automatically.
grant usage on schema public to authenticated;
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.draft_orders, public.draft_order_lines, public.draft_order_line_sizes, public.draft_delivery_allocations, public.cancellation_requests to authenticated;
revoke insert, update, delete on public.audit_events from anon, authenticated;

-- Every Data API table is protected, including tables that intentionally have no client policy.
alter table public.organisations enable row level security; alter table public.organisations force row level security;
alter table public.dealers enable row level security; alter table public.dealers force row level security;
alter table public.app_users enable row level security; alter table public.app_users force row level security;
alter table public.dealer_source_records enable row level security; alter table public.dealer_source_records force row level security;
alter table public.dealer_gst_registrations enable row level security; alter table public.dealer_gst_registrations force row level security;
alter table public.dealer_locations enable row level security; alter table public.dealer_locations force row level security;
alter table public.dealer_seller_mappings enable row level security; alter table public.dealer_seller_mappings force row level security;
alter table public.brands enable row level security; alter table public.brands force row level security;
alter table public.product_families enable row level security; alter table public.product_families force row level security;
alter table public.product_colourways enable row level security; alter table public.product_colourways force row level security;
alter table public.size_sets enable row level security; alter table public.size_sets force row level security;
alter table public.size_values enable row level security; alter table public.size_values force row level security;
alter table public.product_size_values enable row level security; alter table public.product_size_values force row level security;
alter table public.product_media enable row level security; alter table public.product_media force row level security;
alter table public.commercial_offerings enable row level security; alter table public.commercial_offerings force row level security;
alter table public.seasons enable row level security; alter table public.seasons force row level security;
alter table public.delivery_windows enable row level security; alter table public.delivery_windows force row level security;
alter table public.source_files enable row level security; alter table public.source_files force row level security;
alter table public.import_profiles enable row level security; alter table public.import_profiles force row level security;
alter table public.catalogue_import_jobs enable row level security; alter table public.catalogue_import_jobs force row level security;
alter table public.catalogue_import_rows enable row level security; alter table public.catalogue_import_rows force row level security;
alter table public.master_source_links enable row level security; alter table public.master_source_links force row level security;
alter table public.stock_snapshots enable row level security; alter table public.stock_snapshots force row level security;
alter table public.stock_snapshot_lines enable row level security; alter table public.stock_snapshot_lines force row level security;
alter table public.schemes enable row level security; alter table public.schemes force row level security;
alter table public.scheme_targets enable row level security; alter table public.scheme_targets force row level security;
alter table public.scheme_audiences enable row level security; alter table public.scheme_audiences force row level security;
alter table public.scheme_rules enable row level security; alter table public.scheme_rules force row level security;
alter table public.draft_orders enable row level security; alter table public.draft_orders force row level security;
alter table public.draft_order_lines enable row level security; alter table public.draft_order_lines force row level security;
alter table public.draft_order_line_sizes enable row level security; alter table public.draft_order_line_sizes force row level security;
alter table public.draft_delivery_allocations enable row level security; alter table public.draft_delivery_allocations force row level security;
alter table public.orders enable row level security; alter table public.orders force row level security;
alter table public.order_versions enable row level security; alter table public.order_versions force row level security;
alter table public.order_lines enable row level security; alter table public.order_lines force row level security;
alter table public.order_line_sizes enable row level security; alter table public.order_line_sizes force row level security;
alter table public.order_delivery_allocations enable row level security; alter table public.order_delivery_allocations force row level security;
alter table public.order_status_history enable row level security; alter table public.order_status_history force row level security;
alter table public.dispatches enable row level security; alter table public.dispatches force row level security;
alter table public.dispatch_lines enable row level security; alter table public.dispatch_lines force row level security;
alter table public.holds enable row level security; alter table public.holds force row level security;
alter table public.hold_allocations enable row level security; alter table public.hold_allocations force row level security;
alter table public.cancellation_requests enable row level security; alter table public.cancellation_requests force row level security;
alter table public.otp_challenges enable row level security; alter table public.otp_challenges force row level security;
alter table public.audit_events enable row level security; alter table public.audit_events force row level security;
alter table public.export_jobs enable row level security; alter table public.export_jobs force row level security;

create policy app_users_self_select on public.app_users for select to authenticated using ((select auth.uid()) = auth_user_id);
create policy organisations_member_select on public.organisations for select to authenticated using ((select private.is_current_organisation(id)));
create policy dealers_dealer_select on public.dealers for select to authenticated using ((select private.is_current_dealer(id, organisation_id)));
create policy dealer_source_records_dealer_select on public.dealer_source_records for select to authenticated using ((select private.is_current_dealer(dealer_id, organisation_id)));
create policy dealer_gst_registrations_dealer_select on public.dealer_gst_registrations for select to authenticated using ((select private.is_current_dealer(dealer_id, organisation_id)));
create policy dealer_locations_dealer_select on public.dealer_locations for select to authenticated using ((select private.is_current_dealer(dealer_id, organisation_id)));
create policy dealer_seller_mappings_dealer_select on public.dealer_seller_mappings for select to authenticated using ((select private.is_current_dealer(dealer_id, organisation_id)));

create policy brands_member_select on public.brands for select to authenticated using ((select private.is_current_organisation(organisation_id)));
create policy product_families_member_select on public.product_families for select to authenticated using ((select private.is_current_organisation(organisation_id)));
create policy product_colourways_member_select on public.product_colourways for select to authenticated using ((select private.is_current_organisation(organisation_id)) and published_at is not null);
create policy size_sets_member_select on public.size_sets for select to authenticated using ((select private.is_current_organisation(organisation_id)));
create policy size_values_member_select on public.size_values for select to authenticated using ((select private.is_current_organisation(organisation_id)));
create policy product_size_values_member_select on public.product_size_values for select to authenticated using ((select private.is_current_organisation(organisation_id)));
create policy product_media_member_select on public.product_media for select to authenticated using ((select private.is_current_organisation(organisation_id)) and published_at is not null);
create policy commercial_offerings_member_select on public.commercial_offerings for select to authenticated using ((select private.is_current_organisation(organisation_id)) and published_at is not null);
create policy seasons_member_select on public.seasons for select to authenticated using ((select private.is_current_organisation(organisation_id)));
create policy delivery_windows_member_select on public.delivery_windows for select to authenticated using ((select private.is_current_organisation(organisation_id)));
create policy schemes_member_select on public.schemes for select to authenticated using ((select private.is_current_organisation(organisation_id)) and published_at is not null);
create policy scheme_targets_member_select on public.scheme_targets for select to authenticated using ((select private.is_current_organisation(organisation_id)));
create policy scheme_audiences_dealer_select on public.scheme_audiences for select to authenticated using ((select private.is_current_organisation(organisation_id)) and (dealer_id is null or (select private.is_current_dealer(dealer_id, organisation_id))));
create policy scheme_rules_member_select on public.scheme_rules for select to authenticated using ((select private.is_current_organisation(organisation_id)));

create policy draft_orders_dealer_select on public.draft_orders for select to authenticated using ((select private.is_current_dealer(dealer_id, organisation_id)));
create policy draft_orders_dealer_insert on public.draft_orders for insert to authenticated with check ((select private.is_current_dealer(dealer_id, organisation_id)));
create policy draft_orders_dealer_update on public.draft_orders for update to authenticated using ((select private.is_current_dealer(dealer_id, organisation_id))) with check ((select private.is_current_dealer(dealer_id, organisation_id)));
create policy draft_orders_dealer_delete on public.draft_orders for delete to authenticated using ((select private.is_current_dealer(dealer_id, organisation_id)));

create policy draft_order_lines_dealer_select on public.draft_order_lines for select to authenticated using (exists (select 1 from public.draft_orders d where d.id = draft_order_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));
create policy draft_order_lines_dealer_insert on public.draft_order_lines for insert to authenticated with check (exists (select 1 from public.draft_orders d where d.id = draft_order_id and d.organisation_id = draft_order_lines.organisation_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));
create policy draft_order_lines_dealer_update on public.draft_order_lines for update to authenticated using (exists (select 1 from public.draft_orders d where d.id = draft_order_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id)))) with check (exists (select 1 from public.draft_orders d where d.id = draft_order_id and d.organisation_id = draft_order_lines.organisation_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));
create policy draft_order_lines_dealer_delete on public.draft_order_lines for delete to authenticated using (exists (select 1 from public.draft_orders d where d.id = draft_order_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));

create policy draft_order_line_sizes_dealer_select on public.draft_order_line_sizes for select to authenticated using (exists (select 1 from public.draft_order_lines l join public.draft_orders d on d.id = l.draft_order_id where l.id = draft_order_line_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));
create policy draft_order_line_sizes_dealer_insert on public.draft_order_line_sizes for insert to authenticated with check (exists (select 1 from public.draft_order_lines l join public.draft_orders d on d.id = l.draft_order_id where l.id = draft_order_line_id and l.organisation_id = draft_order_line_sizes.organisation_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));
create policy draft_order_line_sizes_dealer_update on public.draft_order_line_sizes for update to authenticated using (exists (select 1 from public.draft_order_lines l join public.draft_orders d on d.id = l.draft_order_id where l.id = draft_order_line_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id)))) with check (exists (select 1 from public.draft_order_lines l join public.draft_orders d on d.id = l.draft_order_id where l.id = draft_order_line_id and l.organisation_id = draft_order_line_sizes.organisation_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));
create policy draft_order_line_sizes_dealer_delete on public.draft_order_line_sizes for delete to authenticated using (exists (select 1 from public.draft_order_lines l join public.draft_orders d on d.id = l.draft_order_id where l.id = draft_order_line_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));

create policy draft_delivery_allocations_dealer_select on public.draft_delivery_allocations for select to authenticated using (exists (select 1 from public.draft_order_line_sizes s join public.draft_order_lines l on l.id = s.draft_order_line_id join public.draft_orders d on d.id = l.draft_order_id where s.id = draft_order_line_size_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));
create policy draft_delivery_allocations_dealer_insert on public.draft_delivery_allocations for insert to authenticated with check (exists (select 1 from public.draft_order_line_sizes s join public.draft_order_lines l on l.id = s.draft_order_line_id join public.draft_orders d on d.id = l.draft_order_id where s.id = draft_order_line_size_id and s.organisation_id = draft_delivery_allocations.organisation_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));
create policy draft_delivery_allocations_dealer_update on public.draft_delivery_allocations for update to authenticated using (exists (select 1 from public.draft_order_line_sizes s join public.draft_order_lines l on l.id = s.draft_order_line_id join public.draft_orders d on d.id = l.draft_order_id where s.id = draft_order_line_size_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id)))) with check (exists (select 1 from public.draft_order_line_sizes s join public.draft_order_lines l on l.id = s.draft_order_line_id join public.draft_orders d on d.id = l.draft_order_id where s.id = draft_order_line_size_id and s.organisation_id = draft_delivery_allocations.organisation_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));
create policy draft_delivery_allocations_dealer_delete on public.draft_delivery_allocations for delete to authenticated using (exists (select 1 from public.draft_order_line_sizes s join public.draft_order_lines l on l.id = s.draft_order_line_id join public.draft_orders d on d.id = l.draft_order_id where s.id = draft_order_line_size_id and (select private.is_current_dealer(d.dealer_id, d.organisation_id))));

create policy orders_dealer_select on public.orders for select to authenticated using ((select private.is_current_dealer(dealer_id, organisation_id)));
create policy order_versions_dealer_select on public.order_versions for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (select private.is_current_dealer(o.dealer_id, o.organisation_id))));
create policy order_lines_dealer_select on public.order_lines for select to authenticated using (exists (select 1 from public.order_versions v join public.orders o on o.id = v.order_id where v.id = order_version_id and (select private.is_current_dealer(o.dealer_id, o.organisation_id))));
create policy order_line_sizes_dealer_select on public.order_line_sizes for select to authenticated using (exists (select 1 from public.order_lines l join public.order_versions v on v.id = l.order_version_id join public.orders o on o.id = v.order_id where l.id = order_line_id and (select private.is_current_dealer(o.dealer_id, o.organisation_id))));
create policy order_delivery_allocations_dealer_select on public.order_delivery_allocations for select to authenticated using (exists (select 1 from public.order_line_sizes s join public.order_lines l on l.id = s.order_line_id join public.order_versions v on v.id = l.order_version_id join public.orders o on o.id = v.order_id where s.id = order_line_size_id and (select private.is_current_dealer(o.dealer_id, o.organisation_id))));
create policy order_status_history_dealer_select on public.order_status_history for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (select private.is_current_dealer(o.dealer_id, o.organisation_id))));
create policy dispatches_dealer_select on public.dispatches for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (select private.is_current_dealer(o.dealer_id, o.organisation_id))));
create policy dispatch_lines_dealer_select on public.dispatch_lines for select to authenticated using (exists (select 1 from public.dispatches d join public.orders o on o.id = d.order_id where d.id = dispatch_id and (select private.is_current_dealer(o.dealer_id, o.organisation_id))));
create policy holds_dealer_select on public.holds for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and (select private.is_current_dealer(o.dealer_id, o.organisation_id))));
create policy hold_allocations_dealer_select on public.hold_allocations for select to authenticated using (exists (select 1 from public.holds h join public.orders o on o.id = h.order_id where h.id = hold_id and (select private.is_current_dealer(o.dealer_id, o.organisation_id))));
create policy cancellation_requests_dealer_select on public.cancellation_requests for select to authenticated using ((select private.is_current_dealer(dealer_id, organisation_id)));
create policy cancellation_requests_dealer_insert on public.cancellation_requests for insert to authenticated with check ((select private.is_current_dealer(dealer_id, organisation_id)) and status = 'PENDING');
create policy otp_challenges_self_select on public.otp_challenges for select to authenticated using ((select auth.uid()) = auth_user_id and (select private.is_current_dealer(dealer_id, organisation_id)));
create policy audit_events_dealer_select on public.audit_events for select to authenticated using (dealer_id is not null and (select private.is_current_dealer(dealer_id, organisation_id)));
create policy export_jobs_dealer_select on public.export_jobs for select to authenticated using (dealer_id is not null and (select private.is_current_dealer(dealer_id, organisation_id)));
