import { ResendEmailProvider } from "../../worker/auth/resend-provider";

describe("ResendEmailProvider", () => {
  it("fails closed when deployed email configuration is missing", () => {
    expect(() => new ResendEmailProvider({})).toThrow(
      "RESEND_API_KEY, OTP_FROM_EMAIL and VLCO_TEST_EMAIL are required",
    );
  });

  it("sends through the Resend HTTP API and logs only redacted evidence", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const logs: unknown[] = [];
    const provider = new ResendEmailProvider(
      {
        RESEND_API_KEY: "re_secret",
        OTP_FROM_EMAIL: "KITCO <otp@example.test>",
        VLCO_TEST_EMAIL: "pilot@example.test",
      },
      async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify({ id: "delivery_123" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      { info: (...values) => logs.push(values), error: (...values) => logs.push(values) },
    );

    await expect(
      provider.sendOtp({
        to: "pilot@example.test",
        code: "482901",
        purpose: "LOGIN",
        correlationId: "corr-1",
        challengeId: "challenge-1",
      }),
    ).resolves.toEqual({ deliveryId: "delivery_123" });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.resend.com/emails");
    expect(requests[0]?.init?.headers).toMatchObject({ Authorization: "Bearer re_secret" });
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({ from: "KITCO <otp@example.test>", to: ["pilot@example.test"] });
    expect(body.text).toContain("482901");
    expect(JSON.stringify(logs)).toContain("delivery_123");
    expect(JSON.stringify(logs)).not.toContain("482901");
    expect(JSON.stringify(logs)).not.toContain("re_secret");
    expect(JSON.stringify(logs)).not.toContain("pilot@example.test");
  });

  it("returns a safe provider error and redacts the response body", async () => {
    const logs: unknown[] = [];
    const provider = new ResendEmailProvider(
      {
        RESEND_API_KEY: "re_secret",
        OTP_FROM_EMAIL: "otp@example.test",
        VLCO_TEST_EMAIL: "pilot@example.test",
      },
      async () => new Response('{"message":"bad recipient pilot@example.test"}', { status: 422 }),
      { info: (...values) => logs.push(values), error: (...values) => logs.push(values) },
    );

    await expect(
      provider.sendOtp({
        to: "pilot@example.test",
        code: "482901",
        purpose: "ACTIVATION",
        correlationId: "corr-2",
        challengeId: "challenge-2",
      }),
    ).rejects.toThrow("EMAIL_DELIVERY_FAILED");
    expect(JSON.stringify(logs)).not.toContain("pilot@example.test");
    expect(JSON.stringify(logs)).not.toContain("482901");
    expect(JSON.stringify(logs)).not.toContain("re_secret");
  });
});
