import { describe, expect, it, vi } from "vitest";
import { createCommerceApp } from "../../worker/app";
import type { SessionIdentity } from "../../worker/middleware/auth";
import { ApiError } from "../../worker/middleware/errors";
import type {
  DealerProfileRecord,
  DealerProfileStore,
  DealerProfileUpdate,
} from "../../worker/supabase-dealer-profile";
import { dealerA, headers, repository, verifier } from "./fixtures";

const COMPLETE = {
  gstin: "22AAAAA0000A1Z5",
  addressLine1: "12 MG Road",
  city: "Patna",
  state: "Bihar",
  pinCode: "800001",
  contactPerson: "Asha Rao",
  mobile: "9800000000",
};

/** In-memory double for the store, so these tests exercise the route layer, the
 *  gate and the shared completeness rule without Supabase. The store's own
 *  Postgres behaviour (gst_registrations reuse, RLS) belongs in tests/db. */
class FakeProfileStore implements DealerProfileStore {
  /** GSTIN -> registration id, mirroring the real unique(organisation_id, gstin). */
  readonly registrations = new Map<string, string>();
  readonly audit: string[] = [];
  private profile: DealerProfileRecord;

  constructor(initial: Partial<DealerProfileRecord> = {}) {
    this.profile = {
      dealerId: "dealer-a", dealerCode: "VLCO", displayName: "VLCO", legalName: null,
      gstin: null, gstVerificationStatus: null,
      addressLine1: null, addressLine2: null, city: null, state: null, pinCode: null,
      mobile: null, contactPerson: null, secondaryEmail: null, storefrontPhotoKey: null,
      ...initial,
    };
  }

  /** Simulates a required field going missing after an order was accepted. */
  clear(field: keyof DealerProfileRecord): void {
    (this.profile as unknown as Record<string, unknown>)[field] = null;
  }

  async get(session: SessionIdentity): Promise<DealerProfileRecord> {
    if (session.role !== "DEALER" || !session.dealerId) {
      throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    }
    return { ...this.profile };
  }

  async update(_session: SessionIdentity, input: DealerProfileUpdate, correlationId: string) {
    if (input.gstin !== undefined) {
      const normalised = input.gstin.trim().toUpperCase();
      if (!this.registrations.has(normalised)) {
        this.registrations.set(normalised, `reg-${this.registrations.size + 1}`);
      }
      this.profile.gstin = normalised;
      this.profile.gstVerificationStatus = "UNVERIFIED";
    }
    for (const key of ["addressLine1", "addressLine2", "city", "state", "pinCode", "contactPerson", "mobile", "secondaryEmail"] as const) {
      if (input[key] !== undefined) (this.profile as unknown as Record<string, unknown>)[key] = input[key];
    }
    this.audit.push(`DEALER_PROFILE_UPDATED:${correlationId}`);
    return { ...this.profile };
  }

  async setStorefrontPhoto(_session: SessionIdentity, objectKey: string, correlationId: string) {
    this.profile.storefrontPhotoKey = objectKey;
    this.audit.push(`DEALER_STOREFRONT_PHOTO_UPDATED:${correlationId}`);
    return { ...this.profile };
  }
}

function appWith(store: FakeProfileStore, extras: Record<string, unknown> = {}) {
  return createCommerceApp({
    repository: repository(),
    verifySession: verifier({ a: dealerA }),
    dealerProfiles: store,
    ...extras,
  } as Parameters<typeof createCommerceApp>[0]);
}

describe("GET /api/dealer/profile", () => {
  it("reports every missing field so the dealer is told what to fix, not just that it failed", async () => {
    const response = await appWith(new FakeProfileStore()).request("/api/dealer/profile", { headers: headers("a") });
    const body = await response.json() as { profileComplete: boolean; missingFields: string[] };

    expect(response.status).toBe(200);
    expect(body.profileComplete).toBe(false);
    expect(body.missingFields).toEqual(["gstin", "addressLine1", "city", "state", "pinCode", "contactPerson", "mobile"]);
  });

  it("reports a complete profile as ready to order", async () => {
    const response = await appWith(new FakeProfileStore(COMPLETE)).request("/api/dealer/profile", { headers: headers("a") });
    const body = await response.json() as { profileComplete: boolean; missingFields: string[] };

    expect(body.profileComplete).toBe(true);
    expect(body.missingFields).toEqual([]);
  });
});

describe("PUT /api/dealer/profile", () => {
  it("saves details and recomputes the gate in the same response", async () => {
    const store = new FakeProfileStore();
    const response = await appWith(store).request("/api/dealer/profile", {
      method: "PUT", headers: headers("a"), body: JSON.stringify(COMPLETE),
    });
    const body = await response.json() as { profileComplete: boolean };

    expect(response.status).toBe(200);
    expect(body.profileComplete).toBe(true);
    expect(store.audit).toContainEqual(expect.stringContaining("DEALER_PROFILE_UPDATED"));
  });

  it("normalises a lowercase GSTIN rather than rejecting it", async () => {
    const store = new FakeProfileStore();
    const response = await appWith(store).request("/api/dealer/profile", {
      method: "PUT", headers: headers("a"), body: JSON.stringify({ gstin: "22aaaaa0000a1z5" }),
    });

    expect(response.status).toBe(200);
    expect(store.registrations.has("22AAAAA0000A1Z5")).toBe(true);
  });

  it("rejects a GSTIN that is not 15 characters, without writing anything", async () => {
    const store = new FakeProfileStore();
    const response = await appWith(store).request("/api/dealer/profile", {
      method: "PUT", headers: headers("a"), body: JSON.stringify({ gstin: "TOOSHORT" }),
    });

    expect(response.status).toBe(400);
    expect(store.registrations.size).toBe(0);
  });

  it("rejects 15 characters in the wrong structure -- the old check only counted length", async () => {
    const store = new FakeProfileStore();
    // Digits where the 5-letter PAN block belongs: same length as a real GSTIN,
    // but not the state/PAN/entity shape the old bare 15-char regex missed.
    const response = await appWith(store).request("/api/dealer/profile", {
      method: "PUT", headers: headers("a"), body: JSON.stringify({ gstin: "22123450000A1Z5" }),
    });

    expect(response.status).toBe(400);
    expect(store.registrations.size).toBe(0);
  });

  it("reuses one registration when a second dealer supplies the same GSTIN", async () => {
    // Several outlets in one state legitimately share a GSTIN, so the second save
    // must attach to the existing registration rather than create a duplicate.
    const store = new FakeProfileStore();
    const app = appWith(store);
    await app.request("/api/dealer/profile", { method: "PUT", headers: headers("a"), body: JSON.stringify({ gstin: COMPLETE.gstin }) });
    await app.request("/api/dealer/profile", { method: "PUT", headers: headers("a"), body: JSON.stringify({ gstin: COMPLETE.gstin }) });

    expect([...store.registrations.values()]).toEqual(["reg-1"]);
  });

  it("rejects a mobile number that is not a valid Indian mobile shape", async () => {
    const response = await appWith(new FakeProfileStore()).request("/api/dealer/profile", {
      method: "PUT", headers: headers("a"), body: JSON.stringify({ mobile: "1234567890" }), // starts with 1, not 6-9
    });
    expect(response.status).toBe(400);
  });

  it("rejects a PIN code that is not 6 digits", async () => {
    const response = await appWith(new FakeProfileStore()).request("/api/dealer/profile", {
      method: "PUT", headers: headers("a"), body: JSON.stringify({ pinCode: "12345" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects an unknown field instead of silently ignoring it", async () => {
    const response = await appWith(new FakeProfileStore()).request("/api/dealer/profile", {
      method: "PUT", headers: headers("a"), body: JSON.stringify({ creditLimit: 999999 }),
    });
    expect(response.status).toBe(400);
  });
});

describe("the order gate", () => {
  async function submit(app: ReturnType<typeof appWith>, idempotencyKey: string) {
    await app.request("/api/drafts/current", {
      method: "PUT", headers: headers("a"), body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4 } }),
    });
    return app.request("/api/orders/submit", {
      method: "POST",
      headers: { ...headers("a"), "idempotency-key": idempotencyKey },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }),
    });
  }

  it("blocks submission when the profile is incomplete, naming what is missing", async () => {
    const response = await submit(appWith(new FakeProfileStore()), "gate-blocked");
    const body = await response.json() as { error: { code: string; message: string; details: { missingFields: string[] } } };

    expect(response.status).toBe(422);
    expect(body.error.code).toBe("PROFILE_INCOMPLETE");
    expect(body.error.message).toContain("GST number");
    expect(body.error.details.missingFields).toContain("gstin");
  });

  it("blocks on a single missing field, not just an empty profile", async () => {
    const response = await submit(appWith(new FakeProfileStore({ ...COMPLETE, mobile: null })), "gate-one-field");
    const body = await response.json() as { error: { message: string; details: { missingFields: string[] } } };

    expect(response.status).toBe(422);
    expect(body.error.details.missingFields).toEqual(["mobile"]);
    expect(body.error.message).toContain("mobile number");
  });

  it("allows submission once the profile is complete", async () => {
    const response = await submit(appWith(new FakeProfileStore(COMPLETE)), "gate-allowed");
    expect(response.status).toBe(201);
  });

  it("does not gate on secondary email", async () => {
    const response = await submit(appWith(new FakeProfileStore({ ...COMPLETE, secondaryEmail: null })), "gate-no-secondary");
    expect(response.status).toBe(201);
  });

  it("does not gate on a missing storefront photo", async () => {
    const response = await submit(appWith(new FakeProfileStore({ ...COMPLETE, storefrontPhotoKey: null })), "gate-no-photo");
    expect(response.status).toBe(201);
  });

  it("refuses before the OTP is verified, so an incomplete profile never burns a code", async () => {
    const verifyOrderOtp = vi.fn(async () => undefined);
    const response = await submit(appWith(new FakeProfileStore(), { verifyOrderOtp }), "gate-before-otp");

    expect(response.status).toBe(422);
    expect(verifyOrderOtp).not.toHaveBeenCalled();
  });

  it("still replays an already-accepted order, so tightening the gate cannot strand a submitted order", async () => {
    const store = new FakeProfileStore(COMPLETE);
    const app = appWith(store);
    const first = await submit(app, "gate-replay");
    expect(first.status).toBe(201);

    // The profile later loses a required field -- a fresh KITCO requirement, or an
    // admin clearing bad data. The already-accepted order must still replay.
    store.clear("mobile");
    const replay = await app.request("/api/orders/submit", {
      method: "POST", headers: { ...headers("a"), "idempotency-key": "gate-replay" },
      body: JSON.stringify({ otpChallengeId: "otp-order-a", otpDigest: "digest-ok" }),
    });

    expect(replay.status).toBe(200);
    // ...while a genuinely new order is now refused.
    const fresh = await submit(app, "gate-after-clear");
    expect(fresh.status).toBe(422);
  });

  it("leaves ordering untouched when no profile store is configured", async () => {
    const app = createCommerceApp({
      repository: repository(),
      verifySession: verifier({ a: dealerA }),
    } as Parameters<typeof createCommerceApp>[0]);
    const response = await submit(app as ReturnType<typeof appWith>, "gate-absent");
    expect(response.status).toBe(201);
  });
});

describe("POST /api/dealer/profile/photo", () => {
  function upload(store: FakeProfileStore, contentType: string, bytes: number) {
    const uploads: string[] = [];
    const app = appWith(store, {
      storefrontPhotos: { put: async (key: string) => { uploads.push(key); } },
    });
    return {
      uploads,
      response: app.request("/api/dealer/profile/photo", {
        method: "POST",
        headers: { ...headers("a"), "content-type": contentType },
        body: new Uint8Array(bytes),
      }),
    };
  }

  it("stores an organisation-scoped key so the existing media guard covers it", async () => {
    const store = new FakeProfileStore(COMPLETE);
    const { uploads, response } = upload(store, "image/jpeg", 1024);

    expect((await response).status).toBe(200);
    expect(uploads[0]).toMatch(/^org-1\/dealers\/dealer-a\/storefront-\d+\.jpg$/);
    expect(store.audit).toContainEqual(expect.stringContaining("DEALER_STOREFRONT_PHOTO_UPDATED"));
  });

  it("refuses a non-image content type", async () => {
    const { uploads, response } = upload(new FakeProfileStore(), "application/pdf", 1024);
    expect((await response).status).toBe(400);
    expect(uploads).toEqual([]);
  });

  it("refuses a photo over the size limit", async () => {
    const { uploads, response } = upload(new FakeProfileStore(), "image/png", 5 * 1024 * 1024 + 1);
    expect((await response).status).toBe(400);
    expect(uploads).toEqual([]);
  });

  it("refuses an empty upload", async () => {
    const { uploads, response } = upload(new FakeProfileStore(), "image/webp", 0);
    expect((await response).status).toBe(400);
    expect(uploads).toEqual([]);
  });
});
