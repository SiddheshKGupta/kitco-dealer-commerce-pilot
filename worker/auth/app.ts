import { Hono } from "hono";
import type { Env } from "../env";
import { createSupabaseAdminClient } from "../lib/supabase-admin";
import { requireDealer, requireSession, type AuthVariables } from "../middleware/auth";
import { handleApiError } from "../middleware/errors";
import { registerLoginRoutes } from "../routes/login";
import { registerLogoutRoutes } from "../routes/logout";
import { registerOrderOtpRoutes } from "../routes/order-otp";
import { registerOtpRoutes } from "../routes/otp";
import { registerPincodeRoutes } from "../routes/pincode";
import { registerRegistrationRoutes } from "../routes/register";
import { OtpService } from "./otp-service";
import { ResendEmailProvider } from "./resend-provider";
import { SessionService } from "./session";
import { SupabaseLoginIdentityResolver, SupabaseOtpChallengeStore } from "./supabase-auth";
import { SupabaseDealerApplicationStore } from "../supabase-registration";
import { createVerifiedSessionVerifier } from "./verified-session";

export function createAuthApp(env: Env): Hono<{ Variables: AuthVariables }> {
  const client = createSupabaseAdminClient(env);
  const applicationStore = new SupabaseDealerApplicationStore(client);
  const identity = new SupabaseLoginIdentityResolver(client, env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  // Reinstated 2026-08-26 as a pilot-only testing aid -- see the comment on
  // OtpOptions.pilotBypassCode. Unset in production by default.
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
  registerLoginRoutes(app, { identity, otp, sessions });
  registerLogoutRoutes(app, sessions);
  registerOtpRoutes(app, { otp, sessions, identity, applicationStore });
  registerOrderOtpRoutes(app, otp);
  registerRegistrationRoutes(app, { store: applicationStore, otp, sessions });
  registerPincodeRoutes(app);
  return app;
}
