import type { Hono } from "hono";
import type { AccountState } from "../account-state";
import type { OtpService } from "../auth/otp-service";
import type { SessionService } from "../auth/session";
import type { AppRole } from "../middleware/auth";

/** V5_AUTH_FLOW.md §6: 12 characters, the bar v4 activation already stated. */
export const MINIMUM_PASSWORD_LENGTH = 12;

export interface LoginIdentity {
  authUserId: string;
  dealerId: string | null;
  organisationId: string;
  /** Where a one-time code is sent -- a dealer's chosen pilot/master/secondary address,
   *  which is a business preference and has nothing to do with what Supabase Auth
   *  authenticates the account by. Never echoed to the client. */
  email: string;
  /** The auth.users.email tied to authUserId -- the only value password sign-in may be
   *  checked against. Kept apart from `email` on purpose: a dealer's OTP address can be
   *  edited long after their auth user was created (or inherited from v4 activation
   *  under a different address entirely), and checking the password against the wrong
   *  one fails every time with no way to tell from the error that the password was
   *  actually right. */
  authEmail: string;
  role: AppRole;
  /** null for admins, who have no dealer row -- `mustChangePassword` plays the
   *  PASSWORD_CHANGE_REQUIRED role for them (V5_AUTH_FLOW.md §3). */
  accountState: AccountState | null;
  mustChangePassword: boolean;
  firstLoginAt: string | null;
}

/** Two factors: the password is checked by Supabase Auth (§6 -- there is no password
 *  column anywhere in `dealers`), then a one-time code proves the mailbox.
 *
 *  `resolve` takes a Dealer Code, or the registered email as an alias for it. §8 leaves
 *  that an open decision and names this as the safe default: it costs one extra lookup
 *  and strands nobody who holds the letter but not the code. Admins have no dealer
 *  record, so they always arrive by email. */
export interface LoginIdentityResolver {
  resolve(identifier: string): Promise<LoginIdentity | null>;
  byAuthUserId(authUserId: string): Promise<LoginIdentity | null>;
  verifyPassword(identity: LoginIdentity, password: string): Promise<boolean>;
  setPassword(identity: LoginIdentity, password: string): Promise<void>;
  /** Drives the dealer half of the state machine. Throws on an illegal move. */
  moveAccountState(identity: LoginIdentity, to: AccountState): Promise<void>;
  stampLogin(identity: LoginIdentity, first: boolean): Promise<void>;
}

interface LoginDependencies {
  identity: LoginIdentityResolver;
  otp: OtpService;
  sessions: SessionService;
}

/** Every rejection at the identifier/password step returns this, byte for byte:
 *  unknown Dealer Code, wrong password, never-credentialed dealer and suspended
 *  account are indistinguishable from outside (V5_AUTH_FLOW.md §4). Admin tooling
 *  tells them apart; the public surface does not. */
const INVALID_CREDENTIALS = { error: "INVALID_CREDENTIALS" } as const;

/** States from which a dealer may sign in at all. CREDENTIALS_PENDING is absent on
 *  purpose: that is where a dealer with no reachable email is parked (§8), and there
 *  is no password on their account to accept. IMPORTED has no credentials either. */
const SIGN_IN_STATES: readonly (AccountState | null)[] = [
  "CREDENTIALS_ISSUED",
  "FIRST_LOGIN_PENDING",
  "OTP_PENDING",
  "PASSWORD_CHANGE_REQUIRED",
  "ACTIVE",
];

/** A reset must not become a way around the issued password. A dealer who has never
 *  signed in still holds an admin-known password and their recovery is re-issuance by
 *  an admin (§5); letting them reset on mailbox control alone would hand the account
 *  to anyone who reads that mailbox, which is the v4 single-factor hole. */
const RESET_STATES: readonly (AccountState | null)[] = ["PASSWORD_CHANGE_REQUIRED", "ACTIVE"];

function readBody(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 && field.length <= 200 ? field : null;
}

export function registerLoginRoutes(app: Hono<any>, dependencies: LoginDependencies): void {
  /** Password only -- no second factor on sign-in (client decision: the OTP step some
   *  dealers hit on every login was the friction, not the value; the one-time code is
   *  kept where it actually matters, at order confirmation). The state machine itself is
   *  unchanged: a first-time login still walks CREDENTIALS_ISSUED -> FIRST_LOGIN_PENDING
   *  -> OTP_PENDING -> PASSWORD_CHANGE_REQUIRED, it just no longer pauses mid-walk waiting
   *  on an emailed code -- the whole walk happens in this one request now. Session
   *  issuance and the mustChangePassword wall below mirror exactly what /api/otp/verify's
   *  login branch used to do after a code was confirmed. */
  app.post("/api/login", async (context) => {
    const body = await context.req.json().catch(() => null);
    const identifier = readBody(body, "identifier");
    const password = readBody(body, "password");
    if (!identifier || !password) return context.json({ error: "INVALID_LOGIN_REQUEST" }, 400);

    const identity = await dependencies.identity.resolve(identifier.trim());
    if (!identity) return context.json(INVALID_CREDENTIALS, 401);
    if (identity.dealerId && !SIGN_IN_STATES.includes(identity.accountState)) return context.json(INVALID_CREDENTIALS, 401);
    if (!(await dependencies.identity.verifyPassword(identity, password))) return context.json(INVALID_CREDENTIALS, 401);

    // CREDENTIALS_ISSUED -> FIRST_LOGIN_PENDING -> OTP_PENDING -> PASSWORD_CHANGE_REQUIRED
    // is the first login; re-entering the password from OTP_PENDING walks the same steps,
    // which is what stops an abandoned first login parking a dealer there (§5). An already
    // ACTIVE dealer's state does not move at all -- repeat sign-in is not a provisioning
    // event.
    if (identity.accountState === "CREDENTIALS_ISSUED" || identity.accountState === "OTP_PENDING") {
      await dependencies.identity.moveAccountState(identity, "FIRST_LOGIN_PENDING");
      identity.accountState = "FIRST_LOGIN_PENDING";
    }
    if (identity.accountState === "FIRST_LOGIN_PENDING") {
      await dependencies.identity.moveAccountState(identity, "OTP_PENDING");
      identity.accountState = "OTP_PENDING";
    }
    const mustChangePassword = identity.mustChangePassword || identity.accountState === "OTP_PENDING";
    if (identity.accountState === "OTP_PENDING") {
      await dependencies.identity.moveAccountState(identity, "PASSWORD_CHANGE_REQUIRED");
    }
    // Only a login that is already finished stamps last_login_at. A first login is not
    // finished until the issued password has been replaced.
    if (!mustChangePassword) await dependencies.identity.stampLogin(identity, false);

    context.header("Set-Cookie", dependencies.sessions.applicationCookie(await dependencies.sessions.sealApplication({
      authUserId: identity.authUserId,
      dealerId: identity.dealerId,
      organisationId: identity.organisationId,
      email: identity.email,
    })));
    // This cookie reaches exactly one route while mustChangePassword holds: the session
    // verifier refuses it everywhere else (V5_AUTH_FLOW.md §2 step 4).
    return context.json({ authenticated: true, role: identity.role, mustChangePassword });
  });

  /** Recovery. The status, the body and the cookie are identical whether or not the
   *  account exists, so this form is not a free membership oracle (§4). When there is
   *  nobody to send a code to, the sealed session carries no identity and the code the
   *  caller eventually types fails as OTP_INVALID -- the same answer a real account
   *  gives for a wrong code. */
  app.post("/api/login/reset", async (context) => {
    const identifier = readBody(await context.req.json().catch(() => null), "identifier");
    if (!identifier) return context.json({ error: "INVALID_LOGIN_REQUEST" }, 400);

    const identity = await dependencies.identity.resolve(identifier.trim());
    const eligible = identity && (!identity.dealerId || RESET_STATES.includes(identity.accountState));

    let challengeId: string = crypto.randomUUID();
    if (eligible) {
      try {
        const challenge = await dependencies.otp.issue({
          organisationId: identity.organisationId,
          dealerId: identity.dealerId,
          authUserId: identity.authUserId,
          to: identity.email,
          purpose: "PASSWORD_RESET",
        });
        challengeId = challenge.id;
      } catch (reason) {
        // Still the same answer to the caller: a delivery failure must not be the one
        // response shape that proves an address is on file.
        console.error("login.reset.issue_failed", { reason: reason instanceof Error ? reason.message : String(reason) });
        return context.json({ otpRequired: true, challengeId }, 202);
      }
    }
    context.header("Set-Cookie", dependencies.sessions.pendingCookie(await dependencies.sessions.sealPending({
      kind: "reset",
      challengeId,
      authUserId: eligible ? identity.authUserId : null,
      verified: false,
    })));
    return context.json({ otpRequired: true, challengeId }, 202);
  });

  /** The only route a PASSWORD_CHANGE_REQUIRED session can reach: the session verifier
   *  refuses that cookie everywhere else, so §2 step 4 is a wall and not a prompt.
   *  Also serves a verified reset, which arrives on the pending cookie instead. */
  app.post("/api/login/password", async (context) => {
    const password = readBody(await context.req.json().catch(() => null), "password");
    if (!password || password.length < MINIMUM_PASSWORD_LENGTH) return context.json({ error: "PASSWORD_TOO_SHORT" }, 400);

    const cookies = context.req.header("cookie");
    const pendingToken = dependencies.sessions.readCookie(cookies, "kitco_pending");
    const pending = pendingToken ? await dependencies.sessions.openPending(pendingToken) : null;
    const reset = pending?.kind === "reset" && pending.verified ? pending.authUserId : null;

    let authUserId = reset;
    if (!authUserId) {
      const sealed = dependencies.sessions.readCookie(cookies, "kitco_session");
      const session = sealed ? await dependencies.sessions.openApplication(sealed) : null;
      if (!session) return context.json({ error: "UNAUTHENTICATED" }, 401);
      authUserId = session.authUserId;
    }

    const identity = await dependencies.identity.byAuthUserId(authUserId);
    // Without a reset, this endpoint exists only to satisfy a forced change. An
    // authenticated dealer cannot use it to rotate a password at will -- that is a
    // separate feature, and quietly allowing it here would make the forced-change
    // wall look optional.
    if (!identity || (!reset && !identity.mustChangePassword)) return context.json({ error: "UNAUTHENTICATED" }, 401);
    if (await dependencies.identity.verifyPassword(identity, password)) {
      return context.json({ error: "PASSWORD_UNCHANGED" }, 400);
    }

    await dependencies.identity.setPassword(identity, password);
    if (identity.dealerId && identity.accountState && identity.accountState !== "ACTIVE") {
      await dependencies.identity.moveAccountState(identity, "ACTIVE");
    }
    await dependencies.identity.stampLogin(identity, identity.firstLoginAt === null);

    context.header("Set-Cookie", dependencies.sessions.applicationCookie(await dependencies.sessions.sealApplication({
      authUserId: identity.authUserId,
      dealerId: identity.dealerId,
      organisationId: identity.organisationId,
      email: identity.email,
    })));
    context.header("Set-Cookie", dependencies.sessions.clearPendingCookie(), { append: true });
    return context.json({ authenticated: true, role: identity.role });
  });
}
