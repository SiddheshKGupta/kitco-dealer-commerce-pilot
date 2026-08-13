import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";
import { ApiError } from "../middleware/errors";
import type { CommerceRepository } from "../repository";
import { parseBody } from "./shared";

const submitSchema = z.object({ otpChallengeId: z.string().min(1), otpDigest: z.string().min(1) }).strict();
const cancellationSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

function dealerOrder(order: Awaited<ReturnType<CommerceRepository["findOrder"]>> & {}) {
  const current = order.versions.at(-1)!;
  return { ...order, version: current.version, retailValueMinor: current.retailValueMinor };
}

export function registerOrderRoutes(app: Hono<{ Variables: AuthVariables }>, repository: CommerceRepository) {
  app.post("/api/orders/submit", async (context) => {
    const input = await parseBody(context, submitSchema);
    const idempotencyKey = context.req.header("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 128) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
    const result = await repository.submitOrder(context.get("session"), { ...input, idempotencyKey, now: new Date().toISOString(), correlationId: context.get("correlationId") });
    return context.json({ order: dealerOrder(result.order) }, result.created ? 201 : 200);
  });
  app.get("/api/orders/:orderId", async (context) => {
    const order = await repository.findOrder(context.get("session"), context.req.param("orderId"));
    if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found");
    return context.json({ order: dealerOrder(order) });
  });
  app.post("/api/orders/:orderId/cancellations", async (context) => {
    const input = await parseBody(context, cancellationSchema);
    const cancellation = await repository.requestCancellation(context.get("session"), context.req.param("orderId"), input.reason, context.get("correlationId"));
    return context.json({ cancellation }, 201);
  });
}
