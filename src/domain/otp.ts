export interface OtpChallenge {
  purpose: string;
  secretDigest: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: string | null;
}

export interface OtpVerification {
  purpose: string;
  secretDigest: string;
  now: string;
}

export type OtpVerificationResult =
  | { ok: true; challenge: OtpChallenge }
  | {
      ok: false;
      reason:
        | "OTP_INVALID_TIMESTAMP"
        | "OTP_INVALID_CHALLENGE"
        | "OTP_ALREADY_CONSUMED"
        | "OTP_EXPIRED"
        | "OTP_PURPOSE_MISMATCH"
        | "OTP_ATTEMPTS_EXHAUSTED"
        | "OTP_INVALID";
      challenge: OtpChallenge;
    };

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function parseInstant(value: string): number | null {
  if (!ISO_INSTANT.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function verifyOtpChallenge(challenge: OtpChallenge, verification: OtpVerification): OtpVerificationResult {
  const expiresAt = parseInstant(challenge.expiresAt);
  const now = parseInstant(verification.now);
  const consumedAt = challenge.consumedAt === null ? null : parseInstant(challenge.consumedAt);
  if (expiresAt === null || now === null || (challenge.consumedAt !== null && consumedAt === null)) {
    return { ok: false, reason: "OTP_INVALID_TIMESTAMP", challenge };
  }
  if (
    !Number.isSafeInteger(challenge.attempts) ||
    challenge.attempts < 0 ||
    !Number.isSafeInteger(challenge.maxAttempts) ||
    challenge.maxAttempts <= 0 ||
    challenge.attempts > challenge.maxAttempts
  ) {
    return { ok: false, reason: "OTP_INVALID_CHALLENGE", challenge };
  }
  if (challenge.consumedAt !== null) return { ok: false, reason: "OTP_ALREADY_CONSUMED", challenge };
  if (now >= expiresAt) return { ok: false, reason: "OTP_EXPIRED", challenge };
  if (verification.purpose !== challenge.purpose) return { ok: false, reason: "OTP_PURPOSE_MISMATCH", challenge };
  if (challenge.attempts >= challenge.maxAttempts) return { ok: false, reason: "OTP_ATTEMPTS_EXHAUSTED", challenge };
  if (verification.secretDigest !== challenge.secretDigest) {
    return { ok: false, reason: "OTP_INVALID", challenge: { ...challenge, attempts: challenge.attempts + 1 } };
  }

  return { ok: true, challenge: { ...challenge, consumedAt: verification.now } };
}
