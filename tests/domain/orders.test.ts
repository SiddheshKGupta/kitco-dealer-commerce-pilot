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

  it("rejects malformed purchase policies", () => {
    expect(
      validatePurchaseQuantities(
        { enabledSizes: ["7"], moqPairs: 0, orderMultiplePairs: 3 },
        { "7": 3 },
      ),
    ).toEqual({ ok: false, reason: "INVALID_POLICY" });
    expect(
      validatePurchaseQuantities(
        { enabledSizes: ["7"], moqPairs: 3, orderMultiplePairs: Number.NaN },
        { "7": 3 },
      ),
    ).toEqual({ ok: false, reason: "INVALID_POLICY" });
  });

  it("rejects negative, fractional, non-finite, unsafe, and overflowing quantities", () => {
    const policy = { enabledSizes: ["7", "8"], moqPairs: 1, orderMultiplePairs: 1 };

    for (const invalid of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(validatePurchaseQuantities(policy, { "7": invalid })).toEqual({
        ok: false,
        reason: "INVALID_QUANTITY",
      });
    }
    expect(
      validatePurchaseQuantities(policy, { "7": Number.MAX_SAFE_INTEGER, "8": 1 }),
    ).toEqual({ ok: false, reason: "INVALID_QUANTITY" });
  });

  it("calculates authoritative Retail Value from canonical MRP minor units and pair quantities", () => {
    expect(retailValueMinor(12_499, { "7": 2, "8": 1 })).toBe(37_497);
  });

  it("rejects an unsafe Retail Value product", () => {
    expect(() => retailValueMinor(Number.MAX_SAFE_INTEGER, { "7": 2 })).toThrow(RangeError);
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

  it("deeply freezes an order version against nested mutation", () => {
    const version = createOrderVersion(
      { orderId: "order-1", version: 1, lines: [] },
      [{ articleNo: "IO2091-103", quantities: { "7": 3 } }],
    );

    expect(() => {
      (version.lines[0]!.quantities as Record<string, number>)["7"] = 99;
    }).toThrow(TypeError);
    expect(version.lines[0]?.quantities["7"]).toBe(3);
  });

  it("returns the original submission for a repeated idempotency key", () => {
    const existing = new Map([["submit-1", { orderId: "order-1", version: 1 }]]);

    expect(createIdempotentSubmission(existing, "submit-1", () => ({ orderId: "order-2", version: 1 }))).toEqual({
      created: false,
      submission: { orderId: "order-1", version: 1 },
    });
  });
});
