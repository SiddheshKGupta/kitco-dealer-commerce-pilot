-- Phase 3 (Auth v5): widen otp_challenges.purpose.
--
-- PASSWORD_RESET is new -- V5_AUTH_FLOW.md §4's recovery flow issues one and the
-- existing check constraint would reject the insert.
--
-- REGISTRATION is not new to the code: worker/routes/register.ts already issues that
-- purpose and worker/routes/otp.ts already accepts it, but the constraint was never
-- widened to match, so every registration OTP fails at the database. There are zero
-- REGISTRATION rows in the live table, which is the symptom, not the design. Fixing it
-- here rather than in a separate migration because it is the same one-line constraint.
--
-- ACTIVATION is dropped: v5 replaces self-service activation with KITCO-issued
-- credentials plus a forced first-login password change (§1, §2), and no code path
-- issues that purpose any more. Existing rows are unaffected -- the live table holds
-- only LOGIN and ORDER_SUBMISSION -- but the drop is written so it cannot orphan any
-- history if a stray row is ever found.

alter table public.otp_challenges drop constraint if exists otp_challenges_purpose_check;

alter table public.otp_challenges add constraint otp_challenges_purpose_check
  check (purpose in (
    'LOGIN',
    'PASSWORD_RESET',
    'REGISTRATION',
    'ORDER_SUBMISSION',
    'REVISION_ACCEPTANCE',
    'ACTIVATION'
  ));

comment on column public.otp_challenges.purpose is
  'What the code authorises. Purpose binding is enforced at verification: a code minted '
  'for one purpose can never be spent on another. ACTIVATION is retained only so pre-v5 '
  'rows stay valid; no v5 code path issues it.';
