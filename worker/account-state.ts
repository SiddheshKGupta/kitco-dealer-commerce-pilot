import { ApiError } from "./middleware/errors";

/** The v5 provisioning state machine (V5_AUTH_FLOW.md §5). The column lives on
 *  `dealers`; the legal moves live here, in one place, so no route can invent its own.
 *
 *      IMPORTED ──────────► CREDENTIALS_PENDING ──────► CREDENTIALS_ISSUED
 *          ▲  ╰───────────────────────╯ cancel                   │
 *          │              (no reachable email)                   ▼
 *          │                                            FIRST_LOGIN_PENDING
 *          │                                                     │
 *          │                                                     ▼
 *          │                    expired challenge ◄────────  OTP_PENDING
 *          │                                                     │
 *          │                                                     ▼
 *          │                                        PASSWORD_CHANGE_REQUIRED
 *          │                                                     │
 *          │                                                     ▼
 *          └── (nothing returns here)          SUSPENDED ◄──  ACTIVE  ──► DISABLED
 *
 *  Re-issuing credentials is legal from every live state and always lands on
 *  CREDENTIALS_ISSUED, which is what gives an admin a way out of any of them.
 *
 *  The rule this table encodes: **no state is terminal by accident.** Every state has
 *  a dealer's next action AND an admin escape hatch. v4's `dealer_applications`
 *  defaulted to DRAFT with neither, so a stalled application was invisible to the
 *  approval queue and unrescuable by an admin -- that stranding broke a demo.
 *  SUSPENDED and DISABLED are the only dead ends, and an admin reverses both.
 *
 *  Phases 3+ own the login-driven moves (FIRST_LOGIN_PENDING, OTP_PENDING,
 *  PASSWORD_CHANGE_REQUIRED). They are declared here rather than added later so the
 *  machine is one artefact to read, not a map that grows a state per phase. */
export const ACCOUNT_STATES = [
  "IMPORTED",
  "CREDENTIALS_PENDING",
  "CREDENTIALS_ISSUED",
  "FIRST_LOGIN_PENDING",
  "OTP_PENDING",
  "PASSWORD_CHANGE_REQUIRED",
  "ACTIVE",
  "SUSPENDED",
  "DISABLED",
] as const;

export type AccountState = (typeof ACCOUNT_STATES)[number];

const TRANSITIONS: Record<AccountState, readonly AccountState[]> = {
  // Straight to CREDENTIALS_ISSUED because issuance is synchronous here: the password
  // is generated in the same request. CREDENTIALS_PENDING is where a dealer lands when
  // issuance cannot complete -- no reachable email on file (V5_AUTH_FLOW.md §8) -- so
  // they surface as an admin exception rather than being silently skipped.
  // No SUSPENDED/DISABLED from either of these: neither state has a login yet, so
  // there is nothing to suspend. Their admin recovery is re-issuance, or cancelling
  // back to IMPORTED (V5_AUTH_FLOW.md §5). Keeping them out is what lets RESTORE
  // below always have a credentialed state to return to.
  IMPORTED: ["CREDENTIALS_PENDING", "CREDENTIALS_ISSUED"],
  CREDENTIALS_PENDING: ["CREDENTIALS_ISSUED", "IMPORTED"],
  CREDENTIALS_ISSUED: ["FIRST_LOGIN_PENDING", "CREDENTIALS_ISSUED", "CREDENTIALS_PENDING", "SUSPENDED", "DISABLED"],
  FIRST_LOGIN_PENDING: ["OTP_PENDING", "CREDENTIALS_ISSUED", "SUSPENDED", "DISABLED"],
  // Back to FIRST_LOGIN_PENDING on an expired challenge: OTP_PENDING must never be a
  // place a dealer parks with no way forward and no way back.
  OTP_PENDING: ["PASSWORD_CHANGE_REQUIRED", "FIRST_LOGIN_PENDING", "CREDENTIALS_ISSUED", "SUSPENDED", "DISABLED"],
  PASSWORD_CHANGE_REQUIRED: ["ACTIVE", "CREDENTIALS_ISSUED", "SUSPENDED", "DISABLED"],
  ACTIVE: ["PASSWORD_CHANGE_REQUIRED", "CREDENTIALS_ISSUED", "SUSPENDED", "DISABLED"],
  // Restoring a dealer who never completed first login goes to CREDENTIALS_ISSUED, not
  // ACTIVE: they still hold an admin-known password, and §2 step 4 must still force
  // them to replace it. Restoring straight to ACTIVE would leave that password valid
  // for good, which is the single-shared-secret problem v5 exists to remove.
  SUSPENDED: ["ACTIVE", "CREDENTIALS_ISSUED", "DISABLED"],
  DISABLED: ["ACTIVE", "CREDENTIALS_ISSUED"],
};

/** `null` is the pre-v5 state of the live pilot's dealers: `account_state` was added
 *  additively and nothing has backfilled it, because v4's `activation_status` is still
 *  what gates their login until the Phase 8 cutover. Treating null as IMPORTED is
 *  accurate -- as far as this machine is concerned they have been imported and nothing
 *  more -- and it means issuing credentials to an existing dealer needs no backfill. */
export function assertAccountTransition(from: string | null | undefined, to: AccountState): AccountState {
  const current = (from ?? "IMPORTED") as AccountState;
  if (!TRANSITIONS[current]?.includes(to)) {
    throw new ApiError(409, "ACCOUNT_STATE_INVALID_TRANSITION", `A dealer at ${current} cannot move to ${to}`);
  }
  return to;
}
