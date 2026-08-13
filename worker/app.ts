import { Hono } from "hono";
import { requireAdmin, requireDealer, requireSession, type AuthVariables, type SessionVerifier } from "./middleware/auth";
import { correlation } from "./middleware/correlation";
import { handleApiError } from "./middleware/errors";
import type { CommerceRepository } from "./repository";
import { registerAdminOrderRoutes } from "./routes/admin-orders";
import { registerCatalogueRoutes } from "./routes/catalogue";
import { registerDispatchRoutes } from "./routes/dispatch";
import { registerDraftRoutes } from "./routes/drafts";
import { registerHoldRoutes } from "./routes/holds";
import { registerImportRoutes } from "./routes/imports";
import { registerMediaRoutes, type MediaStore } from "./routes/media";
import { registerOrderRoutes } from "./routes/orders";

export interface CommerceAppDependencies { repository: CommerceRepository; verifySession: SessionVerifier; mediaStore?: MediaStore }

export function registerCommerceRoutes(app: Hono<{ Variables: AuthVariables }>, dependencies: CommerceAppDependencies) {
  app.use("/api/*", correlation);
  app.use("/api/*", requireSession(dependencies.verifySession));
  app.use("/api/catalogue", requireDealer());
  app.use("/api/drafts/*", requireDealer());
  app.use("/api/orders/*", requireDealer());
  app.use("/api/admin/*", requireAdmin());
  registerCatalogueRoutes(app, dependencies.repository);
  registerDraftRoutes(app, dependencies.repository);
  registerOrderRoutes(app, dependencies.repository);
  registerAdminOrderRoutes(app, dependencies.repository);
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
