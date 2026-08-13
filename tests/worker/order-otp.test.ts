import { Hono } from "hono";
import { CaptureEmailProvider, type EmailOTPProvider } from "../../worker/auth/email-provider";
import { InMemoryOtpChallengeStore, OtpService } from "../../worker/auth/otp-service";
import { requireDealer, requireSession, type AuthVariables, type SessionIdentity } from "../../worker/middleware/auth";
import { handleApiError } from "../../worker/middleware/errors";
import { registerOrderOtpRoutes } from "../../worker/routes/order-otp";

const dealer: SessionIdentity = {
  userId: "user-1",
  organisationId: "org-1",
  dealerId: "dealer-1",
  role: "DEALER",
  email: "orders@dealer.test",
};

function createApp(provider: EmailOTPProvider = new CaptureEmailProvider()) {
  const store = new InMemoryOtpChallengeStore();
  const otp = new OtpService(store, provider, {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    code: () => "482901",
    id: (() => {
      let id = 0;
      return () => `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`;
    })(),
    pepper: "test-order-otp-pepper-at-least-32-characters",
  });
  const app = new Hono<{ Variables: AuthVariables }>();
  app.onError(handleApiError);
  app.use("/api/orders/otp", requireSession(async (request) =>
    request.headers.get("authorization") === "Bearer dealer" ? dealer : null));
  app.use("/api/orders/otp", requireDealer());
  registerOrderOtpRoutes(app, otp);
  return { app, provider, store };
}

describe("authenticated order OTP issuance", () => {
  it("requires a verified dealer session", async () => {
    const { app } = createApp();
    const response = await app.request("/api/orders/otp", { method: "POST" });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "UNAUTHENTICATED" } });
  });

  it("issues an ORDER_SUBMISSION challenge without exposing its code", async () => {
    const capture = new CaptureEmailProvider();
    const { app, store } = createApp(capture);
    const response = await app.request("/api/orders/otp", {
      method: "POST",
      headers: { authorization: "Bearer dealer" },
    });

    expect(response.status).toBe(202);
    const body = await response.text();
    const parsed = JSON.parse(body) as { challengeId: string };
    expect(parsed.challengeId).toBe(store.challenges[0]?.id);
    expect(body).not.toContain("482901");
    expect(capture.deliveries[0]).toMatchObject({
      to: "orders@dealer.test",
      purpose: "ORDER_SUBMISSION",
      challengeId: parsed.challengeId,
    });
  });

  it("enforces cooldown before another provider delivery", async () => {
    const capture = new CaptureEmailProvider();
    const { app } = createApp(capture);
    const request = () => app.request("/api/orders/otp", {
      method: "POST",
      headers: { authorization: "Bearer dealer" },
    });
    expect((await request()).status).toBe(202);
    const repeated = await request();
    expect(repeated.status).toBe(429);
    expect(await repeated.json()).toMatchObject({ error: { code: "OTP_RESEND_COOLDOWN" } });
    expect(capture.deliveries).toHaveLength(1);
  });

  it("returns a safe error when delivery fails", async () => {
    const provider: EmailOTPProvider = { sendOtp: async () => { throw new Error("recipient and secret leak"); } };
    const { app } = createApp(provider);
    const response = await app.request("/api/orders/otp", {
      method: "POST",
      headers: { authorization: "Bearer dealer" },
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: "EMAIL_DELIVERY_FAILED", message: "OTP delivery failed" } });
  });
});
