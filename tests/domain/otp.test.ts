import { verifyOtpChallenge } from "../../src/domain/otp";

describe("OTP domain rules", () => {
  const challenge = {
    purpose: "ORDER_SUBMISSION",
    secretDigest: "digest-for-123456",
    expiresAt: "2026-08-13T12:05:00.000Z",
    attempts: 0,
    maxAttempts: 3,
    consumedAt: null,
  } as const;

  it("rejects an expired challenge", () => {
    expect(
      verifyOtpChallenge(challenge, {
        purpose: "ORDER_SUBMISSION",
        secretDigest: "digest-for-123456",
        now: "2026-08-13T12:05:01.000Z",
      }),
    ).toEqual({ ok: false, reason: "OTP_EXPIRED", challenge });
  });

  it("rejects a challenge used for another purpose", () => {
    expect(
      verifyOtpChallenge(challenge, {
        purpose: "LOGIN",
        secretDigest: "digest-for-123456",
        now: "2026-08-13T12:00:00.000Z",
      }),
    ).toEqual({ ok: false, reason: "OTP_PURPOSE_MISMATCH", challenge });
  });

  it("records failed attempts and locks verification at the configured limit", () => {
    const oneFailedAttempt = verifyOtpChallenge(challenge, {
      purpose: "ORDER_SUBMISSION",
      secretDigest: "wrong-digest",
      now: "2026-08-13T12:00:00.000Z",
    });

    expect(oneFailedAttempt).toEqual({
      ok: false,
      reason: "OTP_INVALID",
      challenge: { ...challenge, attempts: 1 },
    });
    expect(
      verifyOtpChallenge({ ...challenge, attempts: 3 }, {
        purpose: "ORDER_SUBMISSION",
        secretDigest: "digest-for-123456",
        now: "2026-08-13T12:00:00.000Z",
      }),
    ).toEqual({ ok: false, reason: "OTP_ATTEMPTS_EXHAUSTED", challenge: { ...challenge, attempts: 3 } });
  });

  it("consumes a verified challenge and rejects replay", () => {
    const verified = verifyOtpChallenge(challenge, {
      purpose: "ORDER_SUBMISSION",
      secretDigest: "digest-for-123456",
      now: "2026-08-13T12:00:00.000Z",
    });

    expect(verified).toEqual({
      ok: true,
      challenge: { ...challenge, consumedAt: "2026-08-13T12:00:00.000Z" },
    });
    if (!verified.ok) throw new Error("expected a verified OTP");
    expect(
      verifyOtpChallenge(verified.challenge, {
        purpose: "ORDER_SUBMISSION",
        secretDigest: "digest-for-123456",
        now: "2026-08-13T12:00:01.000Z",
      }),
    ).toEqual({ ok: false, reason: "OTP_ALREADY_CONSUMED", challenge: verified.challenge });
  });
});
