-- RLS Enabled No Policy (advisor INFO, verified) on 10 tables. RLS-enabled-with-no-policy
-- already denies anon/authenticated everything -- that IS the safe state, since the worker
-- talks to Postgres with the service-role key and bypasses RLS entirely. But the linter
-- flags it because an accidental gap (RLS enabled, policy just never got written) looks
-- identical to this deliberate deny-all. order_line_decisions (20260824110000) shows the
-- project's convention for a table that DOES need a policy: an explicit `create policy`
-- naming exactly who may do what. These 10 tables need no direct anon/authenticated access
-- at all, so the explicit policy is a same-shape deny-all -- it satisfies the linter and
-- documents the decision without changing any actual behaviour.
create policy no_direct_access on public.catalogue_import_jobs for all to anon, authenticated using (false);
create policy no_direct_access on public.catalogue_import_rows for all to anon, authenticated using (false);
create policy no_direct_access on public.dealer_applications for all to anon, authenticated using (false);
create policy no_direct_access on public.import_profiles for all to anon, authenticated using (false);
create policy no_direct_access on public.master_source_links for all to anon, authenticated using (false);
create policy no_direct_access on public.order_number_counters for all to anon, authenticated using (false);
create policy no_direct_access on public.size_systems for all to anon, authenticated using (false);
create policy no_direct_access on public.source_files for all to anon, authenticated using (false);
create policy no_direct_access on public.stock_snapshot_lines for all to anon, authenticated using (false);
create policy no_direct_access on public.stock_snapshots for all to anon, authenticated using (false);
