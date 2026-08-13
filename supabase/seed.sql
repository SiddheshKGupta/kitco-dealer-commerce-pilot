-- Runtime must set app.settings.vlco_test_email from VLCO_TEST_EMAIL before seeding.
-- No real inbox or fallback address is committed.
do $$
declare
  vlco_email text := nullif(current_setting('app.settings.vlco_test_email', true), '');
  kitco_id uuid;
  vlco_id uuid;
begin
  insert into public.organisations (code, name)
  values ('KITCO', 'KITCO')
  on conflict (code) do update set name = excluded.name
  returning id into kitco_id;

  if vlco_email is null then
    raise notice 'VLCO seed skipped: set app.settings.vlco_test_email from VLCO_TEST_EMAIL at runtime';
    return;
  end if;

  insert into public.dealers (
    organisation_id, code, name, state, city, pilot_email, pilot_email_source
  ) values (
    kitco_id, 'VLCO', 'VLCO', 'Bihar', 'Patna', vlco_email, 'SELF_DECLARED_PILOT'
  )
  on conflict (organisation_id, code) do update
  set pilot_email = excluded.pilot_email, updated_at = now()
  returning id into vlco_id;

  insert into public.dealer_locations (organisation_id, dealer_id, name, location_type)
  select kitco_id, vlco_id, 'VLCO Main', 'BOTH'
  where not exists (
    select 1 from public.dealer_locations where dealer_id = vlco_id and name = 'VLCO Main'
  );
end;
$$;

