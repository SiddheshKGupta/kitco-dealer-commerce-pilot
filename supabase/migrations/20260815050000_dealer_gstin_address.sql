-- Task 7 (v4.0 §13/§14, D5/D6): activation collects GSTIN + structured
-- address, required but explicitly unvalidated, pre-filled from whatever
-- KITCO already has on file. Additive only, nullable, never touches
-- master_email. city/state already exist on dealers.
alter table dealers add column if not exists gstin text;
alter table dealers add column if not exists address_line1 text;
alter table dealers add column if not exists address_line2 text;
alter table dealers add column if not exists pin_code text;
alter table dealers add column if not exists contact_person text;
alter table dealers add column if not exists mobile text;
