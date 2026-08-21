import type { Hono } from "hono";
import type { OtpService } from "../auth/otp-service";
import type { SessionService } from "../auth/session";
import type { AppRole } from "../middleware/auth";

export interface LoginIdentity {
  authUserId: string;
  dealerId: string | null;
  organisationId: string;
  email: string;
  role: AppRole;
}

/** OTP is the only login factor -- there is no password to check. resolve() maps
 *  an email to an existing, ACTIVE account (dealer or admin); createUser() is used
 *  only by the activation flow, to create the auth identity a new dealer will only
 *  ever sign into via OTP. */
export interface LoginIdentityResolver {
  resolve(email: string): Promise<LoginIdentity | null>;
  createUser(email: string): Promise<{ authUserId: string }>;
}

interface LoginDependencies {
  identity: LoginIdentityResolver;
  otp: OtpService;
  sessions: SessionService;
}

export function registerLoginRoutes(app: Hono<any>, dependencies: LoginDependencies): void {
  app.post("/api/login/otp", async (context) => {
    const body = await context.req.json().catch(() => null) as { email?: unknown } | null;
    if (!body || typeof body.email !== "string") {
      return context.json({ error: "INVALID_LOGIN_REQUEST" }, 400);
    }
    const identity = await dependencies.identity.resolve(body.email.trim().toLowerCase());
    if (!identity) return context.json({ error: "INVALID_CREDENTIALS" }, 401);
    try {
      const challenge = await dependencies.otp.issue({
        organisationId: identity.organisationId,
        dealerId: identity.dealerId,
        authUserId: identity.authUserId,
        to: identity.email,
        purpose: "LOGIN",
      });
      const pending = await dependencies.sessions.sealPending({
        kind: "login",
        challengeId: challenge.id,
        authUserId: identity.authUserId,
        dealerId: identity.dealerId,
        organisationId: identity.organisationId,
        email: identity.email,
        role: identity.role,
      });
      context.header("Set-Cookie", dependencies.sessions.pendingCookie(pending));
      return context.json({ otpRequired: true, challengeId: challenge.id }, 202);
    } catch (reason) {
      console.error("login.otp.issue_failed", { reason: reason instanceof Error ? reason.message : String(reason) });
      return context.json({ error: "EMAIL_DELIVERY_FAILED" }, 502);
    }
  });
}
