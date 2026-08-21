-- Slice 4: new-dealer registration + KITCO approval queue (v4.0 brief §12, §45).
-- A submitted application grants no dealer access; only approval creates the
-- canonical dealers row, which then goes through the normal activation flow.
create table public.dealer_applications (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  business_name text not null,
  gstin text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  pin_code text not null,
  contact_person text not null,
  primary_email text not null,
  secondary_email text,
  mobile text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'MORE_INFO_REQUIRED')),
  primary_email_verified_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text,
  created_dealer_id uuid references public.dealers(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index dealer_applications_org_status_idx on public.dealer_applications (organisation_id, status);
