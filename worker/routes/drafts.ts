import type { Hono } from "hono";
import { z } from "zod";
import { retailValueMinor, validatePurchaseQuantities } from "../../src/domain/orders";
import { canOrderOffering } from "../../src/domain/catalogue";
import type { AuthVariables } from "../middleware/auth";
import { ApiError } from "../middleware/errors";
import type { CommerceRepository } from "../repository";
import { parseBody } from "./shared";

const draftSchema = z.object({ offeringId: z.string().min(1), quantities: z.record(z.string(), z.number().int().nonnegative()) }).strict();

export function registerDraftRoutes(app: Hono<{ Variables: AuthVariables }>, repository: CommerceRepository) {
  app.put("/api/drafts/current", async (context) => {
    const input = await parseBody(context, draftSchema);
    const session = context.get("session");
    const product = await repository.findOffering(session, input.offeringId);
    if (!product) throw new ApiError(404, "OFFERING_NOT_FOUND", "Offering not found");
    const today = new Date().toISOString().slice(0, 10);
    if (!canOrderOffering(product.offering, today)) throw new ApiError(422, "OFFERING_CLOSED", "Offering is not open for ordering");
    const validation = validatePurchaseQuantities({ enabledSizes: product.offering.enabledSizes, moqPairs: product.offering.moqPairs, orderMultiplePairs: product.offering.orderMultiplePairs }, input.quantities);
    if (!validation.ok) throw new ApiError(422, validation.reason, "Purchase quantities are invalid");
    const line = { offeringId: input.offeringId, quantities: input.quantities, retailValueMinor: retailValueMinor(product.mrpMinor, input.quantities) };
    const lines = await repository.saveDraft(session, line, context.get("correlationId"));
    return context.json({ lines, retailValueMinor: lines.reduce((sum, item) => sum + item.retailValueMinor, 0), currencyCode: product.currencyCode });
  });
}
