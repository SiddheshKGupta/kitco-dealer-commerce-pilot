import { Hono } from "hono";
import type { Env } from "../env";
import { createSupabaseAdminClient } from "../lib/supabase-admin";
import { registerActivationRoutes } from "../routes/activation";
import { registerLoginRoutes } from "../routes/login";
import { registerOtpRoutes } from "../routes/otp";
import { OtpService } from "./otp-service";
import { ResendEmailProvider } from "./resend-provider";
import { SessionService } from "./session";
import { SupabaseActivationStore, SupabaseOtpChallengeStore, SupabasePasswordAuthenticator } from "./supabase-auth";

export function createAuthApp(env: Env): Hono {
  const client = createSupabaseAdminClient(env);
  const activationStore = new SupabaseActivationStore(client);
  const authenticator = new SupabasePasswordAuthenticator(client);
  const otp = new OtpService(new SupabaseOtpChallengeStore(client), new ResendEmailProvider(env), {
    pepper: env.SESSION_SECRET,
  });
  const sessions = new SessionService(env.SESSION_SECRET);
  const app = new Hono();
  registerActivationRoutes(app, { store: activationStore, otp, sessions, authenticator });
  registerLoginRoutes(app, { authenticator, otp, sessions });
  registerOtpRoutes(app, { otp, sessions, authenticator, activationStore });
  return app;
}
