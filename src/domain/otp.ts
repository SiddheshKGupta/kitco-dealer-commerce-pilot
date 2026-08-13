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
      reason: "OTP_ALREADY_CONSUMED" | "OTP_EXPIRED" | "OTP_PURPOSE_MISMATCH" | "OTP_ATTEMPTS_EXHAUSTED" | "OTP_INVALID";
      challenge: OtpChallenge;
    };

export function verifyOtpChallenge(challenge: OtpChallenge, verification: OtpVerification): OtpVerificationResult {
  if (challenge.consumedAt !== null) return { ok: false, reason: "OTP_ALREADY_CONSUMED", challenge };
  if (verification.now > challenge.expiresAt) return { ok: false, reason: "OTP_EXPIRED", challenge };
  if (verification.purpose !== challenge.purpose) return { ok: false, reason: "OTP_PURPOSE_MISMATCH", challenge };
  if (challenge.attempts >= challenge.maxAttempts) return { ok: false, reason: "OTP_ATTEMPTS_EXHAUSTED", challenge };
  if (verification.secretDigest !== challenge.secretDigest) {
    return { ok: false, reason: "OTP_INVALID", challenge: { ...challenge, attempts: challenge.attempts + 1 } };
  }

  return { ok: true, challenge: { ...challenge, consumedAt: verification.now } };
}
