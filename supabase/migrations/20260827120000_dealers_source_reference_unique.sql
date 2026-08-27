-- Duplicate-dealer risk on approve() retry: source_reference already ties a dealer
-- back to the application (or CSV row) that created it, but nothing enforced
-- uniqueness. If issueCredentials() failed mid-approval (no email on file, a
-- login-email collision), the application stayed reviewable and an admin retrying
-- "Approve" inserted a SECOND dealer row for the same application -- slugCode()'s
-- random suffix never collides, so there was nothing to stop it. This is exactly
-- what produced the duplicate "Figures Fashion" rows and stray test dealers found
-- and manually cleaned up this session.
--
-- NULL stays unconstrained (Postgres treats NULLs as distinct), which is what admin
-- console dealer creation needs: it never sets source_reference at all.
alter table public.dealers
  add constraint dealers_organisation_source_reference_key
  unique (organisation_id, source_reference);
