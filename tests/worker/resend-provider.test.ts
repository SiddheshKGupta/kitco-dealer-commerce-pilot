import { ResendEmailProvider } from "../../worker/auth/resend-provider";

describe("ResendEmailProvider", () => {
  it("fails closed when RESEND_API_KEY is missing", () => {
    expect(() => new ResendEmailProvider({ OTP_FROM_EMAIL: "otp@example.test" })).toThrow(
      "RESEND_API_KEY and OTP_FROM_EMAIL are required",
    );
  });

  it("fails closed when OTP_FROM_EMAIL is missing", () => {
    expect(() => new ResendEmailProvider({ RESEND_API_KEY: "re_secret" })).toThrow(
      "RESEND_API_KEY and OTP_FROM_EMAIL are required",
    );
  });

  it("does not require VLCO_TEST_EMAIL to construct", () => {
    expect(() => new ResendEmailProvider({ RESEND_API_KEY: "re_secret", OTP_FROM_EMAIL: "otp@example.test" })).not.toThrow();
  });

  it("sends through the Resend HTTP API with the mandatory User-Agent header and logs only redacted evidence", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const logs: unknown[] = [];
    const provider = new ResendEmailProvider(
      {
        RESEND_API_KEY: "re_secret",
        OTP_FROM_EMAIL: "KITCO <otp@example.test>",
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
    expect(requests[0]?.init?.headers).toMatchObject({
      Authorization: "Bearer re_secret",
      "User-Agent": "kitco-dealer-commerce/1.0",
    });
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({ from: "KITCO <otp@example.test>", to: ["pilot@example.test"] });
    expect(body.text).toContain("482901");
    expect(JSON.stringify(logs)).toContain("delivery_123");
    expect(JSON.stringify(logs)).not.toContain("482901");
    expect(JSON.stringify(logs)).not.toContain("re_secret");
    expect(JSON.stringify(logs)).not.toContain("pilot@example.test");
  });

  it("captures the redacted provider error body on a 403 (missing User-Agent / blocked request)", async () => {
    const logs: unknown[] = [];
    const provider = new ResendEmailProvider(
      { RESEND_API_KEY: "re_secret", OTP_FROM_EMAIL: "otp@example.test" },
      async () => new Response('{"statusCode":403,"message":"error code: 1010","name":"blocked"}', { status: 403 }),
      { info: (...values) => logs.push(values), error: (...values) => logs.push(values) },
    );

    await expect(
      provider.sendOtp({ to: "pilot@example.test", code: "482901", purpose: "LOGIN", correlationId: "corr-403", challengeId: "challenge-403" }),
    ).rejects.toThrow("EMAIL_DELIVERY_FAILED");
    const logged = JSON.stringify(logs);
    expect(logged).toContain("403");
    expect(logged).toContain("error code: 1010");
    expect(logged).not.toContain("re_secret");
    expect(logged).not.toContain("482901");
  });

  it("captures the redacted provider error body on a 429 rate limit", async () => {
    const logs: unknown[] = [];
    const provider = new ResendEmailProvider(
      { RESEND_API_KEY: "re_secret", OTP_FROM_EMAIL: "otp@example.test" },
      async () => new Response('{"message":"Too many requests","name":"rate_limit_exceeded"}', { status: 429 }),
      { info: (...values) => logs.push(values), error: (...values) => logs.push(values) },
    );

    await expect(
      provider.sendOtp({ to: "pilot@example.test", code: "482901", purpose: "LOGIN", correlationId: "corr-429", challengeId: "challenge-429" }),
    ).rejects.toThrow("EMAIL_DELIVERY_FAILED");
    const logged = JSON.stringify(logs);
    expect(logged).toContain("429");
    expect(logged).toContain("rate_limit_exceeded");
  });

  it("returns a safe provider error and redacts the recipient email from the response body", async () => {
    const logs: unknown[] = [];
    const provider = new ResendEmailProvider(
      { RESEND_API_KEY: "re_secret", OTP_FROM_EMAIL: "otp@example.test" },
      async () => new Response('{"message":"bad recipient pilot@example.test"}', { status: 422 }),
      { info: (...values) => logs.push(values), error: (...values) => logs.push(values) },
    );

    await expect(
      provider.sendOtp({
        to: "pilot@example.test",
        code: "482901",
        purpose: "PASSWORD_RESET",
        correlationId: "corr-2",
        challengeId: "challenge-2",
      }),
    ).rejects.toThrow("EMAIL_DELIVERY_FAILED");
    const logged = JSON.stringify(logs);
    expect(logged).toContain("[redacted]");
    expect(logged).not.toContain("pilot@example.test");
    expect(logged).not.toContain("482901");
    expect(logged).not.toContain("re_secret");
  });

  it("fails closed on a malformed (non-JSON) success response", async () => {
    const logs: unknown[] = [];
    const provider = new ResendEmailProvider(
      { RESEND_API_KEY: "re_secret", OTP_FROM_EMAIL: "otp@example.test" },
      async () => new Response("not json", { status: 200 }),
      { info: (...values) => logs.push(values), error: (...values) => logs.push(values) },
    );

    await expect(
      provider.sendOtp({ to: "pilot@example.test", code: "482901", purpose: "LOGIN", correlationId: "corr-3", challengeId: "challenge-3" }),
    ).rejects.toThrow();
  });

  it("fails closed with no id in an otherwise successful response", async () => {
    const provider = new ResendEmailProvider(
      { RESEND_API_KEY: "re_secret", OTP_FROM_EMAIL: "otp@example.test" },
      async () => new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }),
      { info: () => undefined, error: () => undefined },
    );

    await expect(
      provider.sendOtp({ to: "pilot@example.test", code: "482901", purpose: "LOGIN", correlationId: "corr-4", challengeId: "challenge-4" }),
    ).rejects.toThrow("EMAIL_DELIVERY_FAILED");
  });
});
