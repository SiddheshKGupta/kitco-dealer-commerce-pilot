-- v5 Phase 1 — Dealer Identity Foundation
--
-- Three structural changes the v4 model cannot express:
--
-- 1. DEALER GROUP sits above the dealer. The group is the ONLY thing that
--    authorises one dealer to name another as Bill-To / Ship-To. Group
--    membership never implies visibility of another dealer's orders, credit,
--    logins or activity (v5 §3) -- that stays denied by default here.
--
-- 2. GST REGISTRATION becomes its own entity rather than a column on dealers.
--    Indian GST issues one GSTIN per PAN per state, covering a principal place
--    of business plus unlimited additional places. Multiple KITCO outlet
--    accounts in the same state therefore legitimately SHARE one GSTIN, so the
--    registration is stored once and pointed at:
--        one gst_registration -> many dealers
--        one dealer           -> exactly one gst_registration
--    GSTIN is unique per organisation on the REGISTRATION row (one row per real
--    registration). It is deliberately NOT unique on dealers.
--
-- 3. A deterministic account state machine. v4's dealers.activation_status is
--    left untouched so the live pilot keeps working; account_state is the v5
--    column. No dealer can be stranded the way the DRAFT application flow
--    allowed (v5 §10).
--
-- Additive only. No existing migration is rewritten and no v4 column is dropped.

-- ---------------------------------------------------------------- dealer_groups
create table public.dealer_groups (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  group_code text not null,
  group_name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  -- primary/main dealer of the group; FK added after dealers gains the column
  primary_dealer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, group_code),
  unique (organisation_id, id)
);

-- ----------------------------------------------------------- gst_registrations
-- One row per real GST registration. Shared by every dealer operating under it.
create table public.gst_registrations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  gstin text not null,
  -- Statutory fields, populated from the GST provider. legal_name is never
  -- reformatted for display (v5 §7) -- dealers.display_name exists for that.
  legal_name text,
  trade_name text,
  gst_status text check (gst_status in ('ACTIVE', 'CANCELLED', 'SUSPENDED', 'PROVISIONAL', 'UNKNOWN')),
  registration_date date,
  constitution text,
  taxpayer_type text,
  principal_address jsonb not null default '{}'::jsonb,
  state text,
  pin_code text,
  business_activities jsonb not null default '[]'::jsonb,
  -- NOT_LIVE_VERIFIED is the honest default until a real GSP provider is wired
  -- (v5 §6): never present mock data as officially GST verified.
  verification_status text not null default 'UNVERIFIED'
    check (verification_status in ('UNVERIFIED', 'NOT_LIVE_VERIFIED', 'VERIFIED', 'FAILED')),
  verified_at timestamptz,
  provider text,
  provider_reference text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organisation_id, gstin),
  unique (organisation_id, id)
);

-- ------------------------------------------------------------ dealer additions
alter table public.dealers add column if not exists dealer_group_id uuid;
alter table public.dealers add column if not exists gst_registration_id uuid;
-- Statutory name exactly as GST returns it; never auto-formatted (v5 §7).
alter table public.dealers add column if not exists legal_name text;
-- Admin-editable, human-readable name used everywhere in the UI.
alter table public.dealers add column if not exists display_name text;
-- Facade photo of the retail outlet. Object key in the existing private R2
-- bucket -- deliberately not called "profile photo" in business UI (v5 §8).
alter table public.dealers add column if not exists storefront_photo_key text;
alter table public.dealers add column if not exists is_main_dealer boolean not null default false;
-- v5 provisioning state machine. Deliberately separate from v4's
-- activation_status, which stays authoritative for the live pilot until cutover.
alter table public.dealers add column if not exists account_state text
  check (account_state in (
    'IMPORTED',
    'CREDENTIALS_PENDING',
    'CREDENTIALS_ISSUED',
    'FIRST_LOGIN_PENDING',
    'OTP_PENDING',
    'PASSWORD_CHANGE_REQUIRED',
    'ACTIVE',
    'SUSPENDED',
    'DISABLED'
  ));
alter table public.dealers add column if not exists credentials_issued_at timestamptz;
alter table public.dealers add column if not exists first_login_at timestamptz;
alter table public.dealers add column if not exists last_login_at timestamptz;
-- Provenance: this portal is not automatically master of every field (v5 §42).
alter table public.dealers add column if not exists source_system text;
alter table public.dealers add column if not exists source_reference text;
alter table public.dealers add column if not exists last_synced_at timestamptz;

-- Composite FKs so a dealer can never point at another organisation's group or
-- GST registration, mirroring the (organisation_id, id) pattern already used
-- between app_users and dealers.
alter table public.dealers
  add constraint dealers_dealer_group_fk
  foreign key (organisation_id, dealer_group_id)
  references public.dealer_groups (organisation_id, id);

alter table public.dealers
  add constraint dealers_gst_registration_fk
  foreign key (organisation_id, gst_registration_id)
  references public.gst_registrations (organisation_id, id);

alter table public.dealer_groups
  add constraint dealer_groups_primary_dealer_fk
  foreign key (organisation_id, primary_dealer_id)
  references public.dealers (organisation_id, id);

-- ------------------------------------------ dealer_group_membership_requests
-- A dealer asks to join a group by quoting its code; KITCO admin approves.
-- Deliberately NOT auto-join: a group code is discoverable, so self-joining
-- would turn it into a de-facto password and hand the joiner Bill-To/Ship-To
-- reach into that group's dealers (v5 §3).
create table public.dealer_group_membership_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  dealer_id uuid not null references public.dealers(id),
  requested_group_code text not null,
  resolved_group_id uuid references public.dealer_groups(id),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_notes text,
  created_at timestamptz not null default now()
);

-- Only one live request per dealer at a time.
create unique index dealer_group_membership_requests_one_pending_idx
  on public.dealer_group_membership_requests (organisation_id, dealer_id)
  where status = 'PENDING';

-- ------------------------------------------------------------------- indexes
-- PostgreSQL does not create indexes for foreign keys. Index every ownership
-- and join key (same rule as kitco_core.sql).
create index dealer_groups_organisation_id_idx on public.dealer_groups (organisation_id);
create index dealer_groups_primary_dealer_id_idx on public.dealer_groups (primary_dealer_id);
create index gst_registrations_organisation_id_idx on public.gst_registrations (organisation_id);
create index gst_registrations_gstin_idx on public.gst_registrations (gstin);
create index dealers_dealer_group_id_idx on public.dealers (dealer_group_id);
create index dealers_gst_registration_id_idx on public.dealers (gst_registration_id);
create index dealers_account_state_idx on public.dealers (account_state);
create index dgmr_organisation_id_idx on public.dealer_group_membership_requests (organisation_id);
create index dgmr_dealer_id_idx on public.dealer_group_membership_requests (dealer_id);
create index dgmr_resolved_group_id_idx on public.dealer_group_membership_requests (resolved_group_id);
create index dgmr_status_idx on public.dealer_group_membership_requests (status);

-- ----------------------------------------------------------- group membership
-- Is the caller a dealer in this group? Used by RLS to let a dealer see the
-- SIBLINGS it may name as Bill-To/Ship-To -- and nothing else about them.
create or replace function private.is_dealer_in_group(target_group_id uuid, target_organisation_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
    and target_group_id is not null
    and exists (
      select 1
      from public.app_users au
      join public.dealers d
        on d.id = au.dealer_id
       and d.organisation_id = au.organisation_id
      where au.auth_user_id = (select auth.uid())
        and au.organisation_id = target_organisation_id
        and au.app_role = 'DEALER'
        and d.dealer_group_id = target_group_id
    );
$$;
revoke execute on function private.is_dealer_in_group(uuid, uuid) from public;
grant execute on function private.is_dealer_in_group(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------- RLS
alter table public.dealer_groups enable row level security;
alter table public.dealer_groups force row level security;
alter table public.gst_registrations enable row level security;
alter table public.gst_registrations force row level security;
alter table public.dealer_group_membership_requests enable row level security;
alter table public.dealer_group_membership_requests force row level security;

-- A dealer may read only its OWN group row (needed to render "OpenAI Group"
-- and to list selectable Bill-To/Ship-To siblings). No write access: group
-- structure is KITCO-controlled and the Worker mutates it with the service role.
create policy dealer_groups_member_select
on public.dealer_groups
for select
to authenticated
using ((select private.is_dealer_in_group(dealer_groups.id, dealer_groups.organisation_id)));

-- A dealer may read a GST registration only if it is the one attached to a
-- dealer in its own group (Bill-To/Ship-To selection shows the GSTIN).
create policy gst_registrations_group_select
on public.gst_registrations
for select
to authenticated
using (
  exists (
    select 1
    from public.dealers d
    where d.gst_registration_id = gst_registrations.id
      and d.organisation_id = gst_registrations.organisation_id
      and (select private.is_dealer_in_group(d.dealer_group_id, d.organisation_id))
  )
);

-- A dealer may raise and read its own membership request, and nothing else.
create policy dgmr_dealer_select
on public.dealer_group_membership_requests
for select
to authenticated
using ((select private.is_current_dealer(dealer_group_membership_requests.dealer_id, dealer_group_membership_requests.organisation_id)));

create policy dgmr_dealer_insert
on public.dealer_group_membership_requests
for insert
to authenticated
with check (
  dealer_group_membership_requests.status = 'PENDING'
  and dealer_group_membership_requests.decided_by is null
  and dealer_group_membership_requests.decided_at is null
  and dealer_group_membership_requests.resolved_group_id is null
  and (select private.is_current_dealer(dealer_group_membership_requests.dealer_id, dealer_group_membership_requests.organisation_id))
);

-- --------------------------------------------------------------- updated_at
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end; $$;

create trigger dealer_groups_touch_updated_at
  before update on public.dealer_groups
  for each row execute function private.touch_updated_at();
create trigger gst_registrations_touch_updated_at
  before update on public.gst_registrations
  for each row execute function private.touch_updated_at();
