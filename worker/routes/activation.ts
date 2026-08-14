import type { Hono } from "hono";
import type { OtpService } from "../auth/otp-service";
import type { SessionService } from "../auth/session";
import type { PasswordAuthenticator } from "./login";

export interface DealerRecord {
  id: string;
  organisationId: string;
  name: string;
  city: string | null;
  masterEmail: string | null;
  pilotEmail: string | null;
  pilotEmailSource?: "MASTER" | "SELF_DECLARED_PILOT" | null;
  activationStatus: string;
  authUserId: string | null;
}

export interface ActivationStore {
  search(query: string): Promise<DealerRecord[]>;
  get(id: string): Promise<DealerRecord | null>;
  begin(id: string, pilotEmail: string, source?: "MASTER" | "SELF_DECLARED_PILOT"): Promise<boolean>;
  release?(id: string, pilotEmail: string | null, source: "MASTER" | "SELF_DECLARED_PILOT" | null): Promise<void>;
  activate(id: string, authUserId: string): Promise<boolean>;
}

interface ActivationDependencies {
  store: ActivationStore;
  otp: OtpService;
  sessions: SessionService;
  authenticator: PasswordAuthenticator;
}

function isEmail(value: unknown): value is string {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) && value.length <= 254;
}

/** Never expose a dealer's registered email in full -- only enough to let the
 *  dealer recognise their own inbox (v3.0 §10). */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  const visible = local.length <= 2 ? local[0] ?? "*" : `${local[0]}${local.at(-1)}`;
  return `${visible[0]}${"*".repeat(Math.max(local.length - visible.length, 1))}${visible.slice(1)}@${domain}`;
}

export function registerActivationRoutes(app: Hono<any>, dependencies: ActivationDependencies): void {
  app.get("/api/activation/dealers", async (context) => {
    const query = context.req.query("q")?.trim() ?? "";
    if (query.length < 3) return context.json({ error: "LOOKUP_PREFIX_TOO_SHORT" }, 400);
    const dealers = await dependencies.store.search(query);
    return context.json({ dealers: dealers.map(({ id, name, city }) => ({ id, name, city })) });
  });

  app.get("/api/activation/dealers/:id", async (context) => {
    const dealer = await dependencies.store.get(context.req.param("id"));
    if (!dealer) return context.json({ error: "DEALER_NOT_FOUND" }, 404);
    if (dealer.authUserId || dealer.activationStatus === "ACTIVE") return context.json({ error: "DEALER_ALREADY_ACTIVE" }, 409);
    return context.json({
      id: dealer.id, name: dealer.name, city: dealer.city,
      maskedMasterEmail: dealer.masterEmail ? maskEmail(dealer.masterEmail) : null,
    });
  });

  app.post("/api/activation/request-otp", async (context) => {
    const body = await context.req.json().catch(() => null) as {
      dealerId?: unknown;
      email?: unknown;
      emailChoice?: unknown;
    } | null;
    if (!body || typeof body.dealerId !== "string") {
      return context.json({ error: "INVALID_ACTIVATION_REQUEST" }, 400);
    }
    const dealer = await dependencies.store.get(body.dealerId);
    if (!dealer) return context.json({ error: "DEALER_NOT_FOUND" }, 404);
    if (dealer.authUserId || dealer.activationStatus === "ACTIVE") return context.json({ error: "DEALER_ALREADY_ACTIVE" }, 409);
    const useMaster = body.emailChoice === "MASTER";
    const email = useMaster ? dealer.masterEmail : body.email;
    if (!isEmail(email)) return context.json({ error: useMaster ? "MASTER_EMAIL_UNAVAILABLE" : "INVALID_ACTIVATION_REQUEST" }, 400);
    if (!(await dependencies.store.begin(dealer.id, email, useMaster ? "MASTER" : "SELF_DECLARED_PILOT"))) {
      return context.json({ error: "DEALER_ALREADY_ACTIVE" }, 409);
    }
    try {
      const challenge = await dependencies.otp.issue({
        organisationId: dealer.organisationId,
        dealerId: dealer.id,
        to: email,
        purpose: "ACTIVATION",
      });
      const pending = await dependencies.sessions.sealPending({
        kind: "activation",
        challengeId: challenge.id,
        organisationId: dealer.organisationId,
        dealerId: dealer.id,
        email,
      });
      context.header("Set-Cookie", dependencies.sessions.pendingCookie(pending));
      return context.json({ otpRequired: true, challengeId: challenge.id }, 202);
    } catch {
      await dependencies.store.release?.(dealer.id, dealer.pilotEmail, dealer.pilotEmailSource ?? null).catch(() => undefined);
      return context.json({ error: "EMAIL_DELIVERY_FAILED" }, 502);
    }
  });
}
