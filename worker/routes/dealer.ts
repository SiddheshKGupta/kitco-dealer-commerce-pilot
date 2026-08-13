import type { Hono } from "hono";
import type { AuthVariables } from "../middleware/auth";
import type { CommerceRepository } from "../repository";

export function registerDealerRoutes(app: Hono<{ Variables: AuthVariables }>, repository: CommerceRepository) {
  app.get("/api/dealer/locations", async (context) =>
    context.json({ locations: await repository.listDealerLocations(context.get("session")) }));
}
