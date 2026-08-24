-- v5 Phase 5 foundation — Order Line Decisions (and the P0 fix)
--
-- THE BUG THIS FIXES
-- kitco_core.sql puts BEFORE UPDATE OR DELETE triggers running
-- private.reject_mutation() on order_versions / order_lines / order_line_sizes.
-- decide_kitco_order_line (20260815120000) then tries to UPDATE
-- order_line_sizes.approved_quantity_pairs and order_lines.approved_quantity_pairs.
-- Those two statements are logically incompatible: proven against the live
-- database, every call raises
--     55000: order_line_sizes is immutable
-- so partial approve/hold has never once worked in production. The whole test
-- suite passed because it exercises InMemoryCommerceRepository, never Postgres.
--
-- THE FIX
-- Stop trying to mutate the dealer's submitted order. The submission stays
-- immutable evidence of what the dealer asked for; KITCO's commercial decision
-- becomes its own mutable row alongside it:
--
--     order_line_sizes      (immutable)  "dealer ordered US 9 x 10"
--              |
--     order_line_decisions  (mutable)    "KITCO approved 6, credit review 2,
--                                         rejected 1, 1 still pending"
--
-- INVARIANT (v5 §29), enforced in the schema rather than by convention:
--     ordered = approved + credit_review + rejected + pending
-- pending_qty is a GENERATED column, so it can never be independently edited
-- or drift out of agreement with the other three.

-- ------------------------------------------------------- order_line_decisions
create table public.order_line_decisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  order_id uuid not null references public.orders(id),
  order_line_id uuid not null references public.order_lines(id),
  order_line_size_id uuid not null references public.order_line_sizes(id),

  -- Copied from the immutable submission at scaffold time so the decision row
  -- is self-contained and the invariant is checkable without a join.
  ordered_qty integer not null check (ordered_qty >= 0),

  approved_qty integer not null default 0 check (approved_qty >= 0),
  credit_review_qty integer not null default 0 check (credit_review_qty >= 0),
  rejected_qty integer not null default 0 check (rejected_qty >= 0),
  pending_qty integer generated always as
    (ordered_qty - approved_qty - credit_review_qty - rejected_qty) stored,

  credit_review_reason text,
  rejection_reason text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (order_line_size_id),
  constraint order_line_decisions_within_ordered
    check (approved_qty + credit_review_qty + rejected_qty <= ordered_qty)
);

create index order_line_decisions_organisation_id_idx on public.order_line_decisions (organisation_id);
create index order_line_decisions_order_id_idx on public.order_line_decisions (order_id);
create index order_line_decisions_order_line_id_idx on public.order_line_decisions (order_line_id);
create index order_line_decisions_order_line_size_id_idx on public.order_line_decisions (order_line_size_id);
create index order_line_decisions_decided_by_idx on public.order_line_decisions (decided_by);

create trigger order_line_decisions_touch_updated_at
  before update on public.order_line_decisions
  for each row execute function private.touch_updated_at();

-- ------------------------------------------------------------ auto-scaffold
-- Every submitted size line gets its decision row automatically, so an order is
-- never missing the scaffold the review UI reconciles against. INSERT only --
-- order_line_sizes' immutability trigger covers UPDATE/DELETE and is untouched.
create or replace function private.scaffold_order_line_decision()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_order_id uuid;
begin
  select order_version.order_id into v_order_id
  from public.order_lines order_line
  join public.order_versions order_version on order_version.id = order_line.order_version_id
  where order_line.id = new.order_line_id;

  insert into public.order_line_decisions (
    organisation_id, order_id, order_line_id, order_line_size_id, ordered_qty
  ) values (
    new.organisation_id, v_order_id, new.order_line_id, new.id, new.ordered_quantity_pairs
  )
  on conflict (order_line_size_id) do nothing;

  return new;
end;
$$;

create trigger order_line_sizes_scaffold_decision
  after insert on public.order_line_sizes
  for each row execute function private.scaffold_order_line_decision();

-- Backfill every order that already exists (includes the live pilot orders).
--
-- approved_qty is deliberately left at 0 rather than copied from
-- order_line_sizes.approved_quantity_pairs. In v4 that column is pre-set equal
-- to ordered at SUBMISSION time (see 20260815120000's own header) -- it records
-- what the dealer asked for, not a decision anybody made. Copying it would
-- silently mark every outstanding order as fully approved. Backfilling 0 states
-- the truth: nothing has been decided yet, so everything is pending.
insert into public.order_line_decisions (
  organisation_id, order_id, order_line_id, order_line_size_id, ordered_qty
)
select
  size_line.organisation_id,
  order_version.order_id,
  size_line.order_line_id,
  size_line.id,
  size_line.ordered_quantity_pairs
from public.order_line_sizes size_line
join public.order_lines order_line on order_line.id = size_line.order_line_id
join public.order_versions order_version on order_version.id = order_line.order_version_id
on conflict (order_line_size_id) do nothing;

-- ------------------------------------------------------- order status recompute
-- Commercial status only. Fulfilment (dispatched / remaining) is a separate
-- axis derived from dispatch_lines and is deliberately not folded in here.
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('SUBMITTED', 'UNDER_REVIEW', 'CREDIT_REVIEW', 'APPROVED', 'PARTIALLY_APPROVED', 'REJECTED', 'CANCELLED'));

create or replace function private.recompute_kitco_order_status(p_order_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_ordered bigint; v_approved bigint; v_credit bigint; v_rejected bigint; v_pending bigint;
  v_status text;
begin
  select
    coalesce(sum(ordered_qty), 0), coalesce(sum(approved_qty), 0),
    coalesce(sum(credit_review_qty), 0), coalesce(sum(rejected_qty), 0),
    coalesce(sum(pending_qty), 0)
  into v_ordered, v_approved, v_credit, v_rejected, v_pending
  from public.order_line_decisions where order_id = p_order_id;

  if v_ordered = 0 then
    return null;
  end if;

  if v_pending > 0 then
    -- Nothing decided yet keeps the dealer-facing status at SUBMITTED.
    v_status := case when (v_approved + v_credit + v_rejected) = 0 then 'SUBMITTED' else 'UNDER_REVIEW' end;
  elsif v_rejected = v_ordered then
    v_status := 'REJECTED';
  elsif v_approved = v_ordered then
    v_status := 'APPROVED';
  elsif v_credit > 0 then
    -- Fully decided but some quantity is awaiting credit clearance: that is the
    -- state a human must act on, so it wins over PARTIALLY_APPROVED.
    v_status := 'CREDIT_REVIEW';
  else
    v_status := 'PARTIALLY_APPROVED';
  end if;

  update public.orders set status = v_status where id = p_order_id and status <> 'CANCELLED';
  return v_status;
end;
$$;

-- ----------------------------------------------------- per line+size decision
create or replace function public.decide_kitco_order_line_v5(
  p_organisation_id uuid,
  p_actor_auth_user_id uuid,
  p_order_id uuid,
  p_order_line_id uuid,
  p_size_label text,
  p_approved_qty integer,
  p_credit_review_qty integer,
  p_rejected_qty integer,
  p_credit_review_reason text,
  p_rejection_reason text,
  p_now timestamptz,
  p_correlation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision public.order_line_decisions;
  v_order_line_size_id uuid;
  v_dealer_id uuid;
  v_order_status text;
  v_dispatched integer := 0;
  v_new_status text;
begin
  if p_approved_qty < 0 or p_credit_review_qty < 0 or p_rejected_qty < 0 then
    raise exception 'decision quantities cannot be negative' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.app_users
    where auth_user_id = p_actor_auth_user_id
      and organisation_id = p_organisation_id
      and app_role in ('ADMIN', 'SUPERADMIN')
      and status = 'ACTIVE'
  ) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  select o.status, o.dealer_id into v_order_status, v_dealer_id
  from public.orders o
  where o.id = p_order_id and o.organisation_id = p_organisation_id;

  if v_order_status is null then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if v_order_status in ('REJECTED', 'CANCELLED') then
    raise exception 'order decisions are closed for status %', v_order_status using errcode = '22023';
  end if;

  select size_line.id into v_order_line_size_id
  from public.order_line_sizes size_line
  join public.size_values sv on sv.id = size_line.size_value_id
  where size_line.order_line_id = p_order_line_id
    and size_line.organisation_id = p_organisation_id
    and sv.label = p_size_label;

  if v_order_line_size_id is null then
    raise exception 'order line size not found' using errcode = 'P0002';
  end if;

  -- Approved quantity may never fall below what has already physically shipped.
  select coalesce(sum(dispatch_line.quantity_pairs), 0) into v_dispatched
  from public.dispatch_lines dispatch_line
  join public.dispatches dispatch on dispatch.id = dispatch_line.dispatch_id
  where dispatch_line.order_line_size_id = v_order_line_size_id
    and dispatch.status = 'FINALISED';

  if p_approved_qty < v_dispatched then
    raise exception 'approved pairs cannot drop below the % pairs already dispatched', v_dispatched using errcode = '22023';
  end if;

  if p_credit_review_qty > 0 and coalesce(nullif(trim(p_credit_review_reason), ''), null) is null then
    raise exception 'a credit review reason is required when placing pairs under credit review' using errcode = '22023';
  end if;
  if p_rejected_qty > 0 and coalesce(nullif(trim(p_rejection_reason), ''), null) is null then
    raise exception 'a rejection reason is required when rejecting pairs' using errcode = '22023';
  end if;

  update public.order_line_decisions
  set approved_qty = p_approved_qty,
      credit_review_qty = p_credit_review_qty,
      rejected_qty = p_rejected_qty,
      credit_review_reason = case when p_credit_review_qty > 0 then p_credit_review_reason else null end,
      rejection_reason = case when p_rejected_qty > 0 then p_rejection_reason else null end,
      decided_by = p_actor_auth_user_id,
      decided_at = p_now
  where order_line_size_id = v_order_line_size_id
  returning * into v_decision;

  if v_decision.id is null then
    raise exception 'no decision row for this order line size' using errcode = 'P0002';
  end if;

  v_new_status := private.recompute_kitco_order_status(p_order_id);

  insert into public.audit_events (
    organisation_id, dealer_id, actor_auth_user_id, event_type, entity_type, entity_id,
    correlation_id, evidence, occurred_at
  ) values (
    p_organisation_id, v_dealer_id, p_actor_auth_user_id, 'ORDER_LINE_DECIDED', 'ORDER_LINE_DECISION', v_decision.id,
    private.kitco_correlation_uuid(p_correlation_id),
    pg_catalog.jsonb_build_object(
      'order_id', p_order_id, 'order_line_id', p_order_line_id, 'size', p_size_label,
      'ordered_qty', v_decision.ordered_qty, 'approved_qty', v_decision.approved_qty,
      'credit_review_qty', v_decision.credit_review_qty, 'rejected_qty', v_decision.rejected_qty,
      'pending_qty', v_decision.pending_qty, 'from_status', v_order_status, 'to_status', v_new_status
    ), p_now
  );

  return pg_catalog.jsonb_build_object(
    'order_id', p_order_id, 'order_status', v_new_status,
    'decision_id', v_decision.id, 'pending_qty', v_decision.pending_qty
  );
end;
$$;

-- ------------------------------------------------- whole-order bulk decisions
-- v5 §27: these must be ONE atomic backend operation, never a React loop over
-- 50 article calls that can half-apply on a network failure.
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

  -- Approves only what is still PENDING. Quantities already under credit review
  -- or already rejected are deliberately left alone (v5 §25): silently
  -- overriding an existing credit decision would need its own permissioned action.
  --
  -- Totals are read BEFORE the update. pending_qty is a generated column, so
  -- RETURNING pending_qty would hand back the post-update value -- which is
  -- always 0 here, because the update is precisely what consumes it.
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

  -- Rejects remaining PENDING quantity only; never un-dispatches or reverses an
  -- approval that has already shipped. Totals read before the update for the
  -- same generated-column reason as approve_entire_kitco_order.
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

-- ----------------------------------------------------------------------- RLS
alter table public.order_line_decisions enable row level security;
alter table public.order_line_decisions force row level security;

-- A dealer may read the decisions on its OWN orders (this is what drives
-- "Approved 15 / Credit Review 5" on the dealer's order screen). Read only:
-- decisions are written exclusively through the RPCs above.
create policy order_line_decisions_dealer_select
on public.order_line_decisions
for select
to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_line_decisions.order_id
      and o.organisation_id = order_line_decisions.organisation_id
      and (select private.is_current_dealer(o.dealer_id, o.organisation_id))
  )
);

revoke execute on function private.recompute_kitco_order_status(uuid) from public, anon, authenticated;
revoke execute on function private.scaffold_order_line_decision() from public, anon, authenticated;
