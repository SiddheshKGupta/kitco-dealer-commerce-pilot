import type { Hono } from "hono";
import { z } from "zod";
import { HOLD_REASONS } from "../../src/domain/holds";
import type { AuthVariables } from "../middleware/auth";
import type { CommerceRepository } from "../repository";
import { parseBody } from "./shared";

const approveSchema = z.object({}).strict();
const revisionSchema = z.object({ lines: z.array(z.object({ offeringId: z.string().min(1), quantities: z.record(z.string(), z.number().int().nonnegative()) }).strict()).min(1) }).strict();
const decideSchema = z.object({
  orderLineId: z.string().min(1),
  size: z.string().min(1),
  approvedPairs: z.number().int().nonnegative(),
  heldPairs: z.number().int().nonnegative(),
  holdReason: z.enum(HOLD_REASONS).nullable(),
}).strict();

export function registerAdminOrderRoutes(app: Hono<{ Variables: AuthVariables }>, repository: CommerceRepository) {
  app.get("/api/admin/orders", async (context) => context.json({ orders: await repository.listOrders(context.get("session")) }));
  app.get("/api/admin/orders/:orderId", async (context) => {
    const order = await repository.findOrder(context.get("session"), context.req.param("orderId"));
    if (!order) return context.json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } }, 404);
    return context.json({ order });
  });
  app.post("/api/admin/orders/:orderId/approve", async (context) => {
    await parseBody(context, approveSchema);
    return context.json({ order: await repository.approveOrder(context.get("session"), context.req.param("orderId"), context.get("correlationId")) });
  });
  app.post("/api/admin/orders/:orderId/decide", async (context) => {
    const input = await parseBody(context, decideSchema);
    const order = await repository.decideOrderLine(context.get("session"), { orderId: context.req.param("orderId"), ...input }, context.get("correlationId"));
    return context.json({ order });
  });
  app.post("/api/admin/orders/:orderId/revisions", async (context) => {
    const input = await parseBody(context, revisionSchema);
    const order = await repository.reviseOrder(context.get("session"), context.req.param("orderId"), input.lines, context.get("correlationId"));
    return context.json({ order }, 201);
  });
}
