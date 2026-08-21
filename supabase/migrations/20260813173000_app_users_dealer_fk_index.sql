-- Cover the composite tenant/dealer foreign key reported by the Supabase advisor.
create index app_users_organisation_id_dealer_id_idx
  on public.app_users (organisation_id, dealer_id)
  where dealer_id is not null;
