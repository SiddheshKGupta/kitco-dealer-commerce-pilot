-- The counter table is only ever touched by submit_kitco_order (SECURITY
-- DEFINER, service-role only) -- lock it out of the anon/authenticated
-- PostgREST API, mirroring otp_challenges/dealer_applications.
alter table public.order_number_counters enable row level security;
