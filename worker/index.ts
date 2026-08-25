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
import { SupabaseDealerProfileStore } from "./supabase-dealer-profile";
import { SupabaseOrdersExporter } from "./supabase-orders-export";
import { SupabaseDealerApplicationsAdmin } from "./supabase-dealer-applications";
import { SupabaseAdminDealers } from "./supabase-admin-dealers";
import { SupabaseAdminUsersStore } from "./supabase-admin-users";
import { SupabaseSizeSetsAdmin } from "./supabase-admin-size-sets";
import { SupabaseDealerGroups } from "./supabase-dealer-groups";

export function createProductionCommerceApp(env: Env) {
  const client = createSupabaseAdminClient(env);
  const mediaStore = new R2CatalogueMediaStore(env.CATALOGUE_MEDIA);
  const sessions = new SessionService(env.SESSION_SECRET);
  const otpStore = new SupabaseOtpChallengeStore(client);
  const mailer = new ResendEmailProvider(env);
  const otp = new OtpService(otpStore, mailer, { pepper: env.SESSION_SECRET, pilotBypassCode: env.PILOT_STATIC_OTP });
  return createCommerceApp({
    repository: new SupabaseCommerceRepository(client),
    verifySession: createVerifiedSessionVerifier(client, sessions),
    refreshSessionCookie: async (session) => sessions.applicationCookie(await sessions.sealApplication({
      authUserId: session.userId, dealerId: session.dealerId, organisationId: session.organisationId, email: session.email ?? "",
    })),
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
    mediaStore: mediaStore,
    storefrontPhotos: mediaStore,
    dealerProfiles: new SupabaseDealerProfileStore(client),
    adminConsole: new SupabaseAdminConsoleReader(client),
    ordersExporter: new SupabaseOrdersExporter(client),
    dealerApplications: new SupabaseDealerApplicationsAdmin(client, mailer),
    adminDealers: new SupabaseAdminDealers(client),
    adminUsers: new SupabaseAdminUsersStore(client),
    sizeSetsAdmin: new SupabaseSizeSetsAdmin(client),
    dealerGroups: new SupabaseDealerGroups(client),
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
