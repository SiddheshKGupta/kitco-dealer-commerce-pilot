import { Hono } from "hono";
import { createCommerceApp } from "./app";
import { createAuthApp } from "./auth/app";
import { OtpService } from "./auth/otp-service";
import { ResendEmailProvider } from "./auth/resend-provider";
import { SessionService } from "./auth/session";
import { SupabaseOtpChallengeStore } from "./auth/supabase-auth";
import { createVerifiedSessionVerifier } from "./auth/verified-session";
import type { Env } from "./env";
import { createSupabaseAdminClient } from "./lib/supabase-admin";
import { ApiError } from "./middleware/errors";
import { SupabaseAdminConsoleReader } from "./supabase-admin-console";
import { R2CatalogueMediaStore, SupabaseCommerceRepository } from "./supabase-commerce-repository";
import { SupabaseOrdersExporter } from "./supabase-orders-export";
import { SupabaseDealerApplicationsAdmin } from "./supabase-dealer-applications";

export function createProductionCommerceApp(env: Env) {
  const client = createSupabaseAdminClient(env);
  const sessions = new SessionService(env.SESSION_SECRET);
  const otpStore = new SupabaseOtpChallengeStore(client);
  const otp = new OtpService(otpStore, new ResendEmailProvider(env), { pepper: env.SESSION_SECRET, pilotBypassCode: env.PILOT_STATIC_OTP });
  return createCommerceApp({
    repository: new SupabaseCommerceRepository(client),
    verifySession: createVerifiedSessionVerifier(client, sessions),
    verifyOrderOtp: async (session, challengeId, code) => {
      try {
        const pending = await otpStore.get(challengeId);
        if (!pending || pending.organisationId !== session.organisationId || pending.dealerId !== session.dealerId || pending.authUserId !== session.userId) {
          throw new Error("OTP_SCOPE_MISMATCH");
        }
        await otp.verify(challengeId, code, "ORDER_SUBMISSION");
      } catch (error) {
        const code = error instanceof Error ? error.message : "OTP_INVALID";
        throw new ApiError(422, code, "OTP verification failed");
      }
    },
    mediaStore: new R2CatalogueMediaStore(env.CATALOGUE_MEDIA),
    adminConsole: new SupabaseAdminConsoleReader(client),
    ordersExporter: new SupabaseOrdersExporter(client),
    dealerApplications: new SupabaseDealerApplicationsAdmin(client),
  });
}

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (context) => context.json({ status: "ok" }));
app.all("/api/activation/*", (context) =>
  createAuthApp(context.env).fetch(context.req.raw, context.env, context.executionCtx),
);
app.all("/api/login/*", (context) =>
  createAuthApp(context.env).fetch(context.req.raw, context.env, context.executionCtx),
);
app.all("/api/otp/*", (context) =>
  createAuthApp(context.env).fetch(context.req.raw, context.env, context.executionCtx),
);
app.all("/api/register/*", (context) =>
  createAuthApp(context.env).fetch(context.req.raw, context.env, context.executionCtx),
);
app.all("/api/orders/otp", (context) =>
  createAuthApp(context.env).fetch(context.req.raw, context.env, context.executionCtx),
);
app.all("/api/logout", (context) =>
  createAuthApp(context.env).fetch(context.req.raw, context.env, context.executionCtx),
);
app.all("/api/*", (context) =>
  createProductionCommerceApp(context.env).fetch(context.req.raw, context.env, context.executionCtx),
);

export default app;
