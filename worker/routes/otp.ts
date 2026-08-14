import type { Hono } from "hono";
import type { OtpPurpose, OtpService } from "../auth/otp-service";
import type { SessionService } from "../auth/session";
import type { ActivationStore } from "./activation";
import type { PasswordAuthenticator } from "./login";

interface OtpDependencies {
  otp: OtpService;
  sessions: SessionService;
  authenticator: PasswordAuthenticator;
  activationStore: ActivationStore;
}

const PURPOSES = new Set<OtpPurpose>(["ACTIVATION", "LOGIN", "ORDER_SUBMISSION", "REVISION_ACCEPTANCE"]);

export function registerOtpRoutes(app: Hono<any>, dependencies: OtpDependencies): void {
  app.post("/api/otp/resend", async (context) => {
    const body = await context.req.json().catch(() => null) as { challengeId?: unknown } | null;
    if (!body || typeof body.challengeId !== "string") return context.json({ error: "INVALID_OTP_REQUEST" }, 400);
    const pendingToken = dependencies.sessions.readCookie(context.req.header("cookie"), "kitco_pending");
    const pending = pendingToken ? await dependencies.sessions.openPending(pendingToken) : null;
    if (!pending || pending.challengeId !== body.challengeId) return context.json({ error: "PENDING_SESSION_REQUIRED" }, 401);
    try {
      const challenge = await dependencies.otp.resend(body.challengeId, pending.email);
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
      password?: unknown;
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
    if (!pending || pending.challengeId !== body.challengeId || pending.kind.toUpperCase() !== body.purpose) {
      return context.json({ error: "PENDING_SESSION_REQUIRED" }, 401);
    }
    if (pending.kind === "activation" && (typeof body.password !== "string" || body.password.length < 12)) {
      return context.json({ error: "PASSWORD_TOO_SHORT" }, 400);
    }

    try {
      await dependencies.otp.verify(body.challengeId, body.code, body.purpose as OtpPurpose);
      if (pending.kind === "login") {
        const token = await dependencies.sessions.sealApplication({
          authUserId: pending.authUserId,
          dealerId: pending.dealerId,
          organisationId: pending.organisationId,
          email: pending.email,
          accessToken: pending.accessToken,
        });
        dependencies.authenticator.noteReleased?.();
        context.header("Set-Cookie", dependencies.sessions.applicationCookie(token));
        context.header("Set-Cookie", dependencies.sessions.clearPendingCookie(), { append: true });
        return context.json({ authenticated: true, role: pending.role });
      }

      const created = await dependencies.authenticator.createUser(pending.email, body.password as string);
      if (!(await dependencies.activationStore.activate(pending.dealerId, created.authUserId))) {
        return context.json({ error: "DEALER_ALREADY_ACTIVE" }, 409);
      }
      const authenticated = await dependencies.authenticator.authenticate(pending.email, body.password as string);
      if (
        !authenticated?.accessToken ||
        authenticated.authUserId !== created.authUserId ||
        authenticated.dealerId !== pending.dealerId ||
        authenticated.organisationId !== pending.organisationId
      ) throw new Error("AUTH_SESSION_CREATION_FAILED");
      const token = await dependencies.sessions.sealApplication({
        authUserId: authenticated.authUserId,
        dealerId: authenticated.dealerId,
        organisationId: authenticated.organisationId,
        email: authenticated.email,
        accessToken: authenticated.accessToken,
      });
      context.header("Set-Cookie", dependencies.sessions.applicationCookie(token));
      context.header("Set-Cookie", dependencies.sessions.clearPendingCookie(), { append: true });
      return context.json({ authenticated: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OTP_INVALID";
      const status = message === "OTP_NOT_FOUND" ? 404 : 400;
      return context.json({ error: message }, status);
    }
  });
}
