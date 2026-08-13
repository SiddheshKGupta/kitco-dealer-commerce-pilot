import type { SessionIdentity } from "../../worker/middleware/auth";
import { InMemoryCommerceRepository, type CommerceSeed } from "../../worker/repository";

export const dealerA: SessionIdentity = {
  userId: "user-a",
  organisationId: "org-1",
  dealerId: "dealer-a",
  role: "DEALER",
};

export const dealerB: SessionIdentity = {
  userId: "user-b",
  organisationId: "org-1",
  dealerId: "dealer-b",
  role: "DEALER",
};

export const admin: SessionIdentity = {
  userId: "admin-1",
  organisationId: "org-1",
  dealerId: null,
  role: "ADMIN",
};

const seed: CommerceSeed = {
  catalogue: [
    {
      organisationId: "org-1",
      colourwayId: "cw-1",
      articleNo: "NK-101",
      brand: "Nike",
      colour: "Black",
      mrpMinor: 10000,
      currencyCode: "INR",
      mediaKey: "org-1/nk-101/600.webp",
      stockPairs: 73,
      offering: {
        id: "offer-1",
        enabledSizes: ["7", "8"],
        moqPairs: 4,
        orderMultiplePairs: 2,
        active: true,
        bookingOpensOn: "2026-01-01",
        bookingClosesOn: "2026-12-31",
      },
    },
  ],
  otpChallenges: [
    {
      id: "otp-order-a",
      organisationId: "org-1",
      dealerId: "dealer-a",
      purpose: "ORDER_SUBMISSION",
      secretDigest: "digest-ok",
      expiresAt: "2026-09-01T00:00:00Z",
      attempts: 0,
      maxAttempts: 3,
      consumedAt: null,
    },
  ],
};

export function repository(): InMemoryCommerceRepository {
  return new InMemoryCommerceRepository(seed);
}

export function verifier(tokens: Record<string, SessionIdentity>) {
  return async (request: Request): Promise<SessionIdentity | null> => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    return token ? tokens[token] ?? null : null;
  };
}

export const headers = (token: string, correlationId = "corr-test") => ({
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
  "x-correlation-id": correlationId,
});
