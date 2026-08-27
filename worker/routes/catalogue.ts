import type { Hono } from "hono";
import type { AuthVariables } from "../middleware/auth";
import type { CommerceRepository } from "../repository";

export function registerCatalogueRoutes(app: Hono<{ Variables: AuthVariables }>, repository: CommerceRepository) {
  app.get("/api/catalogue", async (context) => {
    const items = await repository.listCatalogue(context.get("session"));
    return context.json({ items: items.map((item) => ({
      colourwayId: item.colourwayId, articleNo: item.articleNo, brand: item.brand, colour: item.colour,
      familyId: item.familyId ?? null, familyName: item.familyName ?? null, category: item.category ?? null, gender: item.gender ?? null,
      mrpMinor: item.mrpMinor, currencyCode: item.currencyCode,
      mediaUrl: item.mediaKey ? `/api/media/${encodeURIComponent(item.mediaKey)}` : null,
      availability: item.stockPairs > 0 ? "AVAILABLE_TO_ORDER" : "UNAVAILABLE",
      offering: {
        id: item.offering.id, enabledSizes: item.offering.enabledSizes, moqPairs: item.offering.moqPairs,
        orderMultiplePairs: item.offering.orderMultiplePairs, type: item.offering.type,
        sizeSystemLabel: item.offering.sizeSystemLabel ?? null,
      },
    })) });
  });
}
