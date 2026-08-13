import type { Hono } from "hono";
import type { OtpService } from "../auth/otp-service";
import type { SessionService } from "../auth/session";

export interface AuthenticatedPasswordResult {
  authUserId: string;
  dealerId: string;
  organisationId: string;
  email: string;
  accessToken: string;
}

export interface PasswordAuthenticator {
  authenticate(email: string, password: string): Promise<AuthenticatedPasswordResult | null>;
  createUser(email: string, password: string): Promise<{ authUserId: string }>;
  noteReleased?(): void;
}

interface LoginDependencies {
  authenticator: PasswordAuthenticator;
  otp: OtpService;
  sessions: SessionService;
}

export function registerLoginRoutes(app: Hono<any>, dependencies: LoginDependencies): void {
  app.post("/api/login/password", async (context) => {
    const body = await context.req.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
    if (!body || typeof body.email !== "string" || typeof body.password !== "string") {
      return context.json({ error: "INVALID_LOGIN_REQUEST" }, 400);
    }
    const result = await dependencies.authenticator.authenticate(body.email.trim().toLowerCase(), body.password);
    if (!result) return context.json({ error: "INVALID_CREDENTIALS" }, 401);
    try {
      const challenge = await dependencies.otp.issue({
        organisationId: result.organisationId,
        dealerId: result.dealerId,
        authUserId: result.authUserId,
        to: result.email,
        purpose: "LOGIN",
      });
      const pending = await dependencies.sessions.sealPending({ kind: "login", challengeId: challenge.id, ...result });
      context.header("Set-Cookie", dependencies.sessions.pendingCookie(pending));
      return context.json({ otpRequired: true, challengeId: challenge.id }, 202);
    } catch {
      return context.json({ error: "EMAIL_DELIVERY_FAILED" }, 502);
    }
  });
}
