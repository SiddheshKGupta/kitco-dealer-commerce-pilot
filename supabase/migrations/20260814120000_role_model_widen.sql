-- Slice 1: widen app_users.app_role to the full future role vocabulary.
-- Only SUPERADMIN / ADMIN / DEALER are implemented in application code today;
-- the rest are reserved so later role rollout doesn't need another constraint change.
alter table public.app_users drop constraint app_users_app_role_check;
alter table public.app_users add constraint app_users_app_role_check
  check (app_role = any (array[
    'SUPERADMIN','ADMIN','MANAGEMENT','CATALOGUE_MANAGER','SALES',
    'ORDER_OPERATIONS','DISPATCH_OPERATIONS','FINANCE_REPORTS','READ_ONLY','DEALER'
  ]));

alter table public.app_users add column if not exists must_change_password boolean not null default false;
alter table public.app_users add column if not exists status text not null default 'ACTIVE';
