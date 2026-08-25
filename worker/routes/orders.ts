import type { Hono } from "hono";
import { z } from "zod";
import { describeMissingProfileFields, missingProfileFields } from "../../src/domain/dealer-profile";
import type { AuthVariables } from "../middleware/auth";
import { ApiError } from "../middleware/errors";
import type { CommerceRepository } from "../repository";
import type { DealerProfileStore } from "../supabase-dealer-profile";
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

/** Blocks submission until the dealer's profile carries the details KITCO needs to
 *  invoice and ship: GST number, address, contact person, mobile.
 *
 *  Enforced here, at the only path a dealer can reach order creation, rather than
 *  by disabling the checkout button. A disabled button is a courtesy to the
 *  dealer; it is not a control, and a stale tab or a direct API call walks
 *  straight past it. `missingProfileFields` is the same function the profile
 *  screen renders from, so the two can never disagree about why checkout is shut.
 */
async function requireCompleteProfile(
  session: import("../middleware/auth").SessionIdentity,
  profiles: DealerProfileStore | undefined,
): Promise<void> {
  if (!profiles) return;
  const profile = await profiles.get(session);
  const missing = missingProfileFields(profile);
  if (missing.length === 0) return;
  throw new ApiError(
    422,
    "PROFILE_INCOMPLETE",
    `Add ${describeMissingProfileFields(profile)} to your profile before placing an order.`,
    { missingFields: missing },
  );
}

export function registerOrderRoutes(
  app: Hono<{ Variables: AuthVariables }>,
  repository: CommerceRepository,
  verifyOrderOtp?: (session: import("../middleware/auth").SessionIdentity, challengeId: string, code: string) => Promise<void>,
  profiles?: DealerProfileStore,
) {
  app.get("/api/orders", async (context) => context.json({ orders: (await repository.listOrders(context.get("session"))).map(dealerOrder) }));
  app.post("/api/orders/submit", async (context) => {
    const input = await parseBody(context, submitSchema);
    const idempotencyKey = context.req.header("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 128) throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "A valid Idempotency-Key header is required");
    const session = context.get("session");
    const existing = await repository.findSubmittedOrderByIdempotency(session, idempotencyKey);
    // Idempotent replay first: an order already accepted stays accepted, even if
    // the gate has since been tightened. Only NEW submissions are gated.
    if (existing) return context.json({ order: dealerOrder(existing) }, 200);
    // Before the OTP, so an incomplete profile never burns a verification code.
    await requireCompleteProfile(session, profiles);
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
