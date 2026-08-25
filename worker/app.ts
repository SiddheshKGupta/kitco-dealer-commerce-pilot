import { Hono } from "hono";
import { requireAdmin, requireDealer, requireSession, type AuthVariables, type SessionIdentity, type SessionVerifier } from "./middleware/auth";
import { correlation } from "./middleware/correlation";
import { handleApiError } from "./middleware/errors";
import type { CommerceRepository } from "./repository";
import { registerAdminConsoleRoutes, type AdminConsoleReader } from "./routes/admin-console";
import { registerAdminExportRoutes, type OrdersExporter } from "./routes/admin-export";
import { registerAdminOrderRoutes } from "./routes/admin-orders";
import { registerAdminProductExportRoutes, registerDealerProductExportRoutes } from "./routes/product-export";
import { registerDealerApplicationRoutes, type DealerApplicationsAdmin } from "./routes/admin-dealer-applications";
import { registerAdminUserRoutes, type AdminUsersStore } from "./routes/admin-users";
import { registerSizeSetsAdminRoutes, type SizeSetsAdmin } from "./routes/admin-size-sets";
import { registerDealerGroupRoutes, type DealerGroupsStore } from "./routes/dealer-groups";
import { registerCatalogueRoutes } from "./routes/catalogue";
import { registerDispatchRoutes } from "./routes/dispatch";
import { registerDealerRoutes } from "./routes/dealer";
import { registerDraftRoutes } from "./routes/drafts";
import { registerHoldRoutes } from "./routes/holds";
import { registerImportRoutes } from "./routes/imports";
import { registerMediaRoutes, type MediaStore } from "./routes/media";
import { registerOrderRoutes } from "./routes/orders";

export interface CommerceAppDependencies {
  repository: CommerceRepository;
  verifySession: SessionVerifier;
  verifyOrderOtp?: (session: import("./middleware/auth").SessionIdentity, challengeId: string, code: string) => Promise<void>;
  /** Re-issues the session cookie with a fresh expiry on every authenticated request --
   *  a sliding 1-hour idle window (not a hard cutoff from login) so an active dealer/admin
   *  is never signed out mid-task, but a genuinely idle session still expires. */
  refreshSessionCookie?: (session: SessionIdentity) => Promise<string>;
  mediaStore?: MediaStore;
  adminConsole?: AdminConsoleReader;
  ordersExporter?: OrdersExporter;
  dealerApplications?: DealerApplicationsAdmin;
  adminUsers?: AdminUsersStore;
  sizeSetsAdmin?: SizeSetsAdmin;
  dealerGroups?: DealerGroupsStore;
}

export function registerCommerceRoutes(app: Hono<{ Variables: AuthVariables }>, dependencies: CommerceAppDependencies) {
  app.use("/api/*", correlation);
  app.use("/api/*", requireSession(dependencies.verifySession));
  if (dependencies.refreshSessionCookie) {
    app.use("/api/*", async (context, next) => {
      context.header("Set-Cookie", await dependencies.refreshSessionCookie!(context.get("session")), { append: true });
      await next();
    });
  }
  app.use("/api/catalogue", requireDealer());
  app.use("/api/drafts/*", requireDealer());
  app.use("/api/orders", requireDealer());
  app.use("/api/orders/*", requireDealer());
  app.use("/api/dealer/*", requireDealer());
  app.use("/api/admin/*", requireAdmin());
  registerCatalogueRoutes(app, dependencies.repository);
  registerDraftRoutes(app, dependencies.repository);
  // Must precede registerOrderRoutes: its GET /api/orders/:orderId otherwise shadows
  // the literal /api/orders/export-products.csv route (Hono matches routes in
  // registration order and :orderId matches "export-products.csv").
  registerDealerProductExportRoutes(app, dependencies.ordersExporter);
  registerOrderRoutes(app, dependencies.repository, dependencies.verifyOrderOtp);
  registerDealerRoutes(app, dependencies.repository);
  // Must precede registerAdminOrderRoutes: its GET /api/admin/orders/:orderId
  // otherwise shadows these literal /api/admin/orders/export*.csv routes, since
  // Hono matches routes in registration order and :orderId matches "export.csv".
  registerAdminExportRoutes(app, dependencies.ordersExporter);
  registerAdminProductExportRoutes(app, dependencies.ordersExporter);
  registerAdminOrderRoutes(app, dependencies.repository);
  registerAdminConsoleRoutes(app, dependencies.adminConsole);
  registerDealerApplicationRoutes(app, dependencies.dealerApplications);
  registerAdminUserRoutes(app, dependencies.adminUsers);
  registerSizeSetsAdminRoutes(app, dependencies.sizeSetsAdmin);
  registerDealerGroupRoutes(app, dependencies.dealerGroups);
  registerDispatchRoutes(app, dependencies.repository);
  registerHoldRoutes(app, dependencies.repository);
  registerImportRoutes(app, dependencies.repository);
  registerMediaRoutes(app, dependencies.mediaStore);
  return app;
}

export function createCommerceApp(dependencies: CommerceAppDependencies) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.onError(handleApiError);
  return registerCommerceRoutes(app, dependencies);
}
