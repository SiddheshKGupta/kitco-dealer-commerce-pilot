import {
  createIdempotentSubmission,
  createOrderVersion,
  retailValueMinor,
  validatePurchaseQuantities,
} from "../../src/domain/orders";

describe("order domain rules", () => {
  it("rejects disabled sizes, quantities below MOQ, and totals outside the order multiple", () => {
    const policy = {
      enabledSizes: ["7", "8"],
      moqPairs: 6,
      orderMultiplePairs: 3,
    };

    expect(validatePurchaseQuantities(policy, { "7": 3, "8": 3 })).toEqual({ ok: true });
    expect(validatePurchaseQuantities(policy, { "9": 6 })).toEqual({
      ok: false,
      reason: "SIZE_NOT_ENABLED",
    });
    expect(validatePurchaseQuantities(policy, { "7": 5 })).toEqual({
      ok: false,
      reason: "MOQ_NOT_MET",
    });
    expect(validatePurchaseQuantities(policy, { "7": 7 })).toEqual({
      ok: false,
      reason: "ORDER_MULTIPLE_NOT_MET",
    });
  });

  it("calculates authoritative Retail Value from canonical MRP minor units and pair quantities", () => {
    expect(retailValueMinor(12_499, { "7": 2, "8": 1 })).toBe(37_497);
  });

  it("creates a new immutable version without changing the submitted version", () => {
    const versionOne = {
      orderId: "order-1",
      version: 1,
      lines: [{ articleNo: "IO2091-103", quantities: { "7": 6 } }],
    };

    const versionTwo = createOrderVersion(versionOne, [
      { articleNo: "IO2091-103", quantities: { "7": 3, "8": 3 } },
    ]);

    expect(versionTwo).toEqual({
      orderId: "order-1",
      version: 2,
      lines: [{ articleNo: "IO2091-103", quantities: { "7": 3, "8": 3 } }],
    });
    expect(versionOne.lines[0]?.quantities).toEqual({ "7": 6 });
  });

  it("returns the original submission for a repeated idempotency key", () => {
    const existing = new Map([["submit-1", { orderId: "order-1", version: 1 }]]);

    expect(createIdempotentSubmission(existing, "submit-1", () => ({ orderId: "order-2", version: 1 }))).toEqual({
      created: false,
      submission: { orderId: "order-1", version: 1 },
    });
  });
});
