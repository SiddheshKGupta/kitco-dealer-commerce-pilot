import { describe, expect, it } from "vitest";
import { createCommerceApp } from "../../worker/app";
import { dealerA, dealerB, headers, repository, verifier } from "./fixtures";

describe("catalogue and draft routes", () => {
  it("derives scope from the verified session and hides numeric stock and dealer commercial fields", async () => {
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA, b: dealerB }) });
    const response = await app.request("/api/catalogue?organisationId=forged&dealerId=dealer-b", {
      headers: headers("a"),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-correlation-id")).toBe("corr-test");
    const body = await response.json() as { items: unknown[] };
    expect(body.items).toEqual([
      {
        colourwayId: "cw-1",
        articleNo: "NK-101",
        brand: "Nike",
        familyId: null,
        familyName: null,
        category: null,
        gender: null,
        colour: "Black",
        mrpMinor: 10000,
        currencyCode: "INR",
        mediaUrl: "/api/media/org-1%2Fnk-101%2F600.webp",
        availability: "AVAILABLE_TO_ORDER",
        offering: {
          id: "offer-1",
          enabledSizes: ["7", "8"],
          moqPairs: 4,
          orderMultiplePairs: 2,
        },
      },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/stockPairs|dealerPrice|margin|gst|payable/i);
  });

  it.each([
    [{ "9": 4 }, "SIZE_NOT_ENABLED"],
    [{ "7": 2 }, "MOQ_NOT_MET"],
    [{ "7": 5 }, "ORDER_MULTIPLE_NOT_MET"],
  ])("rejects invalid canonical size/MOQ/multiple requests", async (quantities, reason) => {
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA }) });
    const response = await app.request("/api/drafts/current", {
      method: "PUT",
      headers: headers("a"),
      body: JSON.stringify({ offeringId: "offer-1", quantities }),
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: reason } });
  });

  it("rejects forged MRP instead of persisting client commercial values", async () => {
    const app = createCommerceApp({ repository: repository(), verifySession: verifier({ a: dealerA }) });
    const response = await app.request("/api/drafts/current", {
      method: "PUT",
      headers: headers("a"),
      body: JSON.stringify({ offeringId: "offer-1", quantities: { "7": 4 }, mrpMinor: 1 }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "UNTRUSTED_COMMERCIAL_FIELD" } });
  });
});
