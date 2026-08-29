import type { Hono } from "hono";
import type { OtpPurpose, OtpService } from "../auth/otp-service";
import type { SessionService } from "../auth/session";
import type { LoginIdentityResolver } from "./login";
import type { DealerApplicationStore } from "./register";

interface OtpDependencies {
  otp: OtpService;
  sessions: SessionService;
  identity: LoginIdentityResolver;
  applicationStore?: DealerApplicationStore;
}

const PURPOSES = new Set<OtpPurpose>(["LOGIN", "PASSWORD_RESET", "ORDER_SUBMISSION", "REVISION_ACCEPTANCE", "REGISTRATION"]);

/** The pending cookie's kind and the purpose in the body must name the same flow, so a
 *  code minted for one cannot be spent on another. LOGIN has no entry: sign-in is
 *  password-only now (52df413), so no pending cookie is ever sealed with that kind --
 *  same as ORDER_SUBMISSION/REVISION_ACCEPTANCE, which are verified through their own
 *  dedicated routes rather than this pending-cookie flow. */
const KIND_FOR_PURPOSE: Record<string, string> = { PASSWORD_RESET: "reset", REGISTRATION: "registration" };

export function registerOtpRoutes(app: Hono<any>, dependencies: OtpDependencies): void {
  app.post("/api/otp/resend", async (context) => {
    const body = await context.req.json().catch(() => null) as { challengeId?: unknown } | null;
    if (!body || typeof body.challengeId !== "string") return context.json({ error: "INVALID_OTP_REQUEST" }, 400);
    const pendingToken = dependencies.sessions.readCookie(context.req.header("cookie"), "kitco_pending");
    const pending = pendingToken ? await dependencies.sessions.openPending(pendingToken) : null;
    if (!pending || pending.challengeId !== body.challengeId) return context.json({ error: "PENDING_SESSION_REQUIRED" }, 401);
    let to: string;
    if (pending.kind === "reset") {
      // A recovery for an identifier that matched nothing has no challenge and no
      // recipient. It answers exactly as a real one does on cooldown, because a resend
      // that behaved differently would give back the oracle /api/login/reset withholds.
      if (!pending.authUserId) return context.json({ error: "OTP_RESEND_COOLDOWN" }, 429);
      // The address is re-read rather than carried in the cookie, so a recovery cannot
      // be redirected by anything the caller holds.
      const identity = await dependencies.identity.byAuthUserId(pending.authUserId);
      if (!identity) return context.json({ error: "OTP_NOT_FOUND" }, 404);
      to = identity.email;
    } else {
      to = pending.email;
    }
    try {
      const challenge = await dependencies.otp.resend(body.challengeId, to);
      const replacement = await dependencies.sessions.sealPending({ ...pending, challengeId: challenge.id });
      context.header("Set-Cookie", dependencies.sessions.pendingCookie(replacement));
      return context.json({ otpRequired: true, challengeId: challenge.id }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OTP_INVALID";
      if (message === "OTP_RESEND_COOLDOWN") return context.json({ error: message }, 429);
      if (message === "EMAIL_DELIVERY_FAILED") return context.json({ error: message }, 502);
      return context.json({ error: message }, 400);
    }
  });

  app.post("/api/otp/verify", async (context) => {
    const body = await context.req.json().catch(() => null) as {
      challengeId?: unknown;
      code?: unknown;
      purpose?: unknown;
    } | null;
    if (
      !body ||
      typeof body.challengeId !== "string" ||
      typeof body.code !== "string" ||
      typeof body.purpose !== "string" ||
      !PURPOSES.has(body.purpose as OtpPurpose)
    ) return context.json({ error: "INVALID_OTP_REQUEST" }, 400);

    const pendingToken = dependencies.sessions.readCookie(context.req.header("cookie"), "kitco_pending");
    const pending = pendingToken ? await dependencies.sessions.openPending(pendingToken) : null;
    if (!pending || pending.challengeId !== body.challengeId || pending.kind !== KIND_FOR_PURPOSE[body.purpose]) {
      return context.json({ error: "PENDING_SESSION_REQUIRED" }, 401);
    }
    // The decoy recovery ends here, with the answer a real account gives for a wrong
    // code. Checked before otp.verify so a challenge id that was never issued cannot
    // come back as OTP_NOT_FOUND and give the game away.
    if (pending.kind === "reset" && !pending.authUserId) return context.json({ error: "OTP_INVALID" }, 400);

    try {
      await dependencies.otp.verify(body.challengeId, body.code, body.purpose as OtpPurpose);

      if (pending.kind === "reset") {
        context.header("Set-Cookie", dependencies.sessions.pendingCookie(
          await dependencies.sessions.sealPending({ ...pending, verified: true }),
        ));
        return context.json({ authenticated: false, passwordResetAuthorised: true });
      }

      if (pending.kind === "registration") {
        if (!dependencies.applicationStore) return context.json({ error: "APPLICATION_NOT_FOUND" }, 404);
        // Verifying the code proves the applicant owns the email address they
        // typed. That is all it proves. It does not make them a KITCO dealer:
        // this only moves the application into the review queue, creates no
        // auth user, creates no dealer row and issues no session. Only an admin
        // pressing Approve creates a dealer -- see SupabaseDealerApplicationsAdmin.
        if (!(await dependencies.applicationStore.submit(pending.applicationId))) {
          return context.json({ error: "APPLICATION_ALREADY_SUBMITTED" }, 409);
        }
        context.header("Set-Cookie", dependencies.sessions.clearPendingCookie());
        return context.json({ authenticated: false, submitted: true });
      }

      return context.json({ error: "PENDING_SESSION_REQUIRED" }, 401);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OTP_INVALID";
      const status = message === "OTP_NOT_FOUND" ? 404 : 400;
      return context.json({ error: message }, status);
    }
  });
}
