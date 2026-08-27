-- Security advisor WARN, verified: 20260824110000_v5_order_line_decisions.sql defined
-- approve_entire_kitco_order / decide_kitco_order_line_v5 / reject_entire_kitco_order as
-- SECURITY DEFINER but never revoked the default PUBLIC execute grant, unlike its sibling
-- submit_kitco_order_v5 (20260826140000). Confirmed via pg_proc: all three were callable
-- by anon and authenticated directly through /rest/v1/rpc/... with no session at all --
-- each function does its own actor/role check internally, but that check should never be
-- reachable from an unauthenticated PostgREST call in the first place. Locking these down
-- to service_role only, matching submit_kitco_order_v5's existing pattern.
revoke all on function public.approve_entire_kitco_order(uuid, uuid, uuid, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.approve_entire_kitco_order(uuid, uuid, uuid, timestamptz, text)
  to service_role;

revoke all on function public.decide_kitco_order_line_v5(uuid, uuid, uuid, uuid, text, integer, integer, integer, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.decide_kitco_order_line_v5(uuid, uuid, uuid, uuid, text, integer, integer, integer, text, text, timestamptz, text)
  to service_role;

revoke all on function public.reject_entire_kitco_order(uuid, uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.reject_entire_kitco_order(uuid, uuid, uuid, text, timestamptz, text)
  to service_role;
