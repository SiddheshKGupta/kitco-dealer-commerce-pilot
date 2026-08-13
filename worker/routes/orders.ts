import type { Hono } from "hono";
import { z } from "zod";
import type { AuthVariables } from "../middleware/auth";
import { ApiError } from "../middleware/errors";
import type { CommerceRepository } from "../repository";
import { parseBody } from "./shared";

const submitSchema = z.object({
  otpChallengeId: z.string().min(1),
  otpCode: z.string().regex(/^\d{6}$/u).optional(),
  otpDigest: z.string().min(1).optional(),
}).strict().refine((value) => Boolean(value.otpCode || value.otpDigest), "An OTP code is required");
const cancellationSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

function dealerOrder(order: Awaited<ReturnType<CommerceRepository["findOrder"]>> & {}) {
  const current = order.versions.at(-1)!;
  return { ...order, version: current.version, retailValueMinor: current.retailValueMinor };
}

export function registerOrderRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  repository: CommerceRepository,
  verifyOrderOtp?: (session: import("../middleware/auth").SessionIdentity, challengeId: string, code: string) => Promise<void>,
) {
  app.get("/api/orders", async (context) => context.json({ orders: (await repository.listOrders(context.get("session"))).map(dealerOrder) }));
  app.post("/api/orders/submit", async (context) => {
    const input = await parseBody(context, submitSchema);
    const idempotencyKey = context.req.header("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 128) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
    const session = context.get("session");
    const existing = await repository.findSubmittedOrderByIdempotency(session, idempotencyKey);
    if (existing) return context.json({ order: dealerOrder(existing) }, 200);
    if (verifyOrderOtp) {
      if (!input.otpCode) throw new ApiError(400, "OTP_CODE_REQUIRED", "A six-digit order OTP is required");
      await verifyOrderOtp(session, input.otpChallengeId, input.otpCode);
    }
    const result = await repository.submitOrder(session, { idempotencyKey, otpChallengeId: input.otpChallengeId, otpDigest: input.otpDigest, now: new Date().toISOString(), correlationId: context.get("correlationId") });
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
