import type { Hono } from "hono";
import type { OtpService } from "../auth/otp-service";
import type { AuthVariables } from "../middleware/auth";
import { ApiError } from "../middleware/errors";

export function registerOrderOtpRoutes(app: Hono<{ Variables: AuthVariables }>, otp: OtpService): void {
  app.post("/api/orders/otp", async (context) => {
    const session = context.get("session");
    if (!session.dealerId || !session.email) {
      throw new ApiError(409, "SESSION_EMAIL_REQUIRED", "A verified dealer email is required");
    }
    try {
      const challenge = await otp.issue({
        organisationId: session.organisationId,
        dealerId: session.dealerId,
        authUserId: session.userId,
        to: session.email,
        purpose: "ORDER_SUBMISSION",
        correlationId: context.get("correlationId") || undefined,
        enforceCooldown: true,
      });
      return context.json({ challengeId: challenge.id }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "EMAIL_DELIVERY_FAILED";
      if (message === "OTP_RESEND_COOLDOWN") throw new ApiError(429, message, "Wait before requesting another OTP");
      if (message === "EMAIL_DELIVERY_FAILED") throw new ApiError(502, message, "OTP delivery failed");
      throw error;
    }
  });
}
