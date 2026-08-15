-- A dealer can be reached at a secondary email in addition to master_email/
-- pilot_email (e.g. a second point of contact who should also be able to
-- sign in as this dealer). Additive only, nullable, never touches master_email.
alter table dealers add column if not exists secondary_email text;
