import { Hono } from "hono";
import type { Env } from "../env";
import { createSupabaseAdminClient } from "../lib/supabase-admin";
import { requireDealer, requireSession, type AuthVariables } from "../middleware/auth";
import { handleApiError } from "../middleware/errors";
import { registerActivationRoutes } from "../routes/activation";
import { registerLoginRoutes } from "../routes/login";
import { registerLogoutRoutes } from "../routes/logout";
import { registerOrderOtpRoutes } from "../routes/order-otp";
import { registerOtpRoutes } from "../routes/otp";
import { OtpService } from "./otp-service";
import { ResendEmailProvider } from "./resend-provider";
import { SessionService } from "./session";
import { SupabaseActivationStore, SupabaseOtpChallengeStore, SupabasePasswordAuthenticator } from "./supabase-auth";
import { createVerifiedSessionVerifier } from "./verified-session";

export function createAuthApp(env: Env): Hono<{ Variables: AuthVariables }> {
  const client = createSupabaseAdminClient(env);
  const activationStore = new SupabaseActivationStore(client);
  const authenticator = new SupabasePasswordAuthenticator(client, () => createSupabaseAdminClient(env));
  const otp = new OtpService(new SupabaseOtpChallengeStore(client), new ResendEmailProvider(env), {
    pepper: env.SESSION_SECRET,
    pilotBypassCode: env.PILOT_STATIC_OTP,
  });
  const sessions = new SessionService(env.SESSION_SECRET);
  const verifyApplicationSession = createVerifiedSessionVerifier(client, sessions);
  const app = new Hono<{ Variables: AuthVariables }>();
  app.onError(handleApiError);
  app.use("/api/orders/otp", requireSession(verifyApplicationSession));
  app.use("/api/orders/otp", requireDealer());
  registerActivationRoutes(app, { store: activationStore, otp, sessions, authenticator });
  registerLoginRoutes(app, { authenticator, otp, sessions });
  registerLogoutRoutes(app, sessions);
  registerOtpRoutes(app, { otp, sessions, authenticator, activationStore });
  registerOrderOtpRoutes(app, otp);
  return app;
}
