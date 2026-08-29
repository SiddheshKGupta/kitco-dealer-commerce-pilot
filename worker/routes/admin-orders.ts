import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";
import { ApiError } from "../middleware/errors";
import type { CommerceRepository } from "../repository";
import { parseBody } from "./shared";

const approveSchema = z.object({}).strict();
const revisionSchema = z.object({ lines: z.array(z.object({ offeringId: z.string().min(1), quantities: z.record(z.string(), z.number().int().nonnegative()) }).strict()).min(1) }).strict();

// v5 Phase 5 order review -- decide_kitco_order_line_v5 / approve_entire_kitco_order /
// reject_entire_kitco_order (supabase/migrations/20260824110000_v5_order_line_decisions.sql).
const decideV5Schema = z.object({
  orderLineId: z.string().min(1),
  size: z.string().min(1),
  approvedQty: z.number().int().nonnegative(),
  creditReviewQty: z.number().int().nonnegative(),
  rejectedQty: z.number().int().nonnegative(),
  creditReviewReason: z.string().min(1).nullable().optional().default(null),
  rejectionReason: z.string().min(1).nullable().optional().default(null),
}).strict();
const rejectEntireSchema = z.object({ reason: z.string().min(1) }).strict();

export function registerAdminOrderRoutes(app: Hono<{ Variables: AuthVariables }>, repository: CommerceRepository) {
  app.get("/api/admin/orders", async (context) => context.json({ orders: await repository.listOrders(context.get("session")) }));
  app.get("/api/admin/orders/:orderId", async (context) => {
    const order = await repository.findOrder(context.get("session"), context.req.param("orderId"));
    if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found");
    return context.json({ order });
  });
  app.post("/api/admin/orders/:orderId/approve", async (context) => {
    await parseBody(context, approveSchema);
    return context.json({ order: await repository.approveOrder(context.get("session"), context.req.param("orderId"), context.get("correlationId")) });
  });
  app.post("/api/admin/orders/:orderId/revisions", async (context) => {
    const input = await parseBody(context, revisionSchema);
    const order = await repository.reviseOrder(context.get("session"), context.req.param("orderId"), input.lines, context.get("correlationId"));
    return context.json({ order }, 201);
  });

  // v5 Phase 5: article-tile order review. Additive alongside the routes above --
  // :orderId and :orderId/approve are untouched.
  app.get("/api/admin/orders/:orderId/review", async (context) => {
    const order = await repository.getOrderReview(context.get("session"), context.req.param("orderId"));
    if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found");
    return context.json({ order });
  });
  app.post("/api/admin/orders/:orderId/decide-v5", async (context) => {
    const input = await parseBody(context, decideV5Schema);
    const order = await repository.decideOrderLineV5(context.get("session"), { orderId: context.req.param("orderId"), ...input }, context.get("correlationId"));
    return context.json({ order });
  });
  app.post("/api/admin/orders/:orderId/approve-entire", async (context) => {
    await parseBody(context, approveSchema);
    const order = await repository.approveEntireOrder(context.get("session"), context.req.param("orderId"), context.get("correlationId"));
    return context.json({ order });
  });
  app.post("/api/admin/orders/:orderId/reject-entire", async (context) => {
    const input = await parseBody(context, rejectEntireSchema);
    const order = await repository.rejectEntireOrder(context.get("session"), context.req.param("orderId"), input.reason, context.get("correlationId"));
    return context.json({ order });
  });
}
