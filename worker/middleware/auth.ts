import { createMiddleware } from "hono/factory";
import { ApiError } from "./errors";

export type AppRole = "DEALER" | "ADMIN";

export interface SessionIdentity {
  readonly userId: string;
  readonly organisationId: string;
  readonly dealerId: string | null;
  readonly role: AppRole;
}

export type SessionVerifier = (request: Request) => Promise<SessionIdentity | null>;

export interface AuthVariables {
  session: SessionIdentity;
  correlationId: string;
}

export function requireSession(verifySession: SessionVerifier) {
  return createMiddleware<{ Variables: AuthVariables }>(async (context, next) => {
    const session = await verifySession(context.req.raw);
    if (!session) throw new ApiError(401, "UNAUTHENTICATED", "A verified server session is required");
    context.set("session", session);
    await next();
  });
}

export function requireDealer() {
  return createMiddleware<{ Variables: AuthVariables }>(async (context, next) => {
    const session = context.get("session");
    if (session.role !== "DEALER" || !session.dealerId) {
      throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    }
    await next();
  });
}

export function requireAdmin() {
  return createMiddleware<{ Variables: AuthVariables }>(async (context, next) => {
    if (context.get("session").role !== "ADMIN") {
      throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    }
    await next();
  });
}
