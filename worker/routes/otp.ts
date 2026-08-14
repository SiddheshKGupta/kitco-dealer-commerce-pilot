import type { Hono } from "hono";
import type { OtpPurpose, OtpService } from "../auth/otp-service";
import type { SessionService } from "../auth/session";
import type { ActivationStore } from "./activation";
import type { LoginIdentityResolver } from "./login";
import type { DealerApplicationStore } from "./register";

interface OtpDependencies {
  otp: OtpService;
  sessions: SessionService;
  identity: LoginIdentityResolver;
  activationStore: ActivationStore;
  applicationStore?: DealerApplicationStore;
}

const PURPOSES = new Set<OtpPurpose>(["ACTIVATION", "LOGIN", "ORDER_SUBMISSION", "REVISION_ACCEPTANCE", "REGISTRATION"]);

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

    try {
      await dependencies.otp.verify(body.challengeId, body.code, body.purpose as OtpPurpose);
      if (pending.kind === "login") {
        const token = await dependencies.sessions.sealApplication({
          authUserId: pending.authUserId,
          dealerId: pending.dealerId,
          organisationId: pending.organisationId,
          email: pending.email,
        });
        context.header("Set-Cookie", dependencies.sessions.applicationCookie(token));
        context.header("Set-Cookie", dependencies.sessions.clearPendingCookie(), { append: true });
        return context.json({ authenticated: true, role: pending.role });
      }
      if (pending.kind === "registration") {
        if (!dependencies.applicationStore) return context.json({ error: "APPLICATION_NOT_FOUND" }, 404);
        const created = await dependencies.identity.createUser(pending.email);
        const activated = await dependencies.applicationStore.approveAndActivate(pending.applicationId, created.authUserId);
        if (!activated) return context.json({ error: "APPLICATION_NOT_FOUND" }, 404);
        const token = await dependencies.sessions.sealApplication({
          authUserId: created.authUserId,
          dealerId: activated.dealerId,
          organisationId: activated.organisationId,
          email: pending.email,
        });
        context.header("Set-Cookie", dependencies.sessions.applicationCookie(token));
        context.header("Set-Cookie", dependencies.sessions.clearPendingCookie(), { append: true });
        return context.json({ authenticated: true, role: "DEALER" });
      }

      const created = await dependencies.identity.createUser(pending.email);
      if (!(await dependencies.activationStore.activate(pending.dealerId, created.authUserId))) {
        return context.json({ error: "DEALER_ALREADY_ACTIVE" }, 409);
      }
      const token = await dependencies.sessions.sealApplication({
        authUserId: created.authUserId,
        dealerId: pending.dealerId,
        organisationId: pending.organisationId,
        email: pending.email,
      });
      context.header("Set-Cookie", dependencies.sessions.applicationCookie(token));
      context.header("Set-Cookie", dependencies.sessions.clearPendingCookie(), { append: true });
      return context.json({ authenticated: true, role: "DEALER" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OTP_INVALID";
      const status = message === "OTP_NOT_FOUND" ? 404 : 400;
      return context.json({ error: message }, status);
    }
  });
}
