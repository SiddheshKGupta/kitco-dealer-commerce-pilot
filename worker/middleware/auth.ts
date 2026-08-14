import { createMiddleware } from "hono/factory";
import { ApiError } from "./errors";

export type AppRole = "DEALER" | "ADMIN" | "SUPERADMIN";

export interface SessionIdentity {
  readonly userId: string;
  readonly organisationId: string;
  readonly dealerId: string | null;
  readonly role: AppRole;
  readonly email?: string;
}

export type SessionVerifier = (request: Request) => Promise<SessionIdentity | null>;

export interface AuthVariables {
  session: SessionIdentity;
  correlationId: string;
}

/** ADMIN and SUPERADMIN both operate KITCO Control; SUPERADMIN additionally holds
 *  permissions ADMIN does not (see requireSuperAdmin). */
export function isAdminRole(role: AppRole): boolean {
  return role === "ADMIN" || role === "SUPERADMIN";
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

export function requireRole(...roles: AppRole[]) {
  return createMiddleware<{ Variables: AuthVariables }>(async (context, next) => {
    if (!roles.includes(context.get("session").role)) {
      throw new ApiError(403, "FORBIDDEN", "You do not have access to this resource");
    }
    await next();
  });
}

export function requireAdmin() {
  return requireRole("SUPERADMIN", "ADMIN");
}

export function requireSuperAdmin() {
  return requireRole("SUPERADMIN");
}
