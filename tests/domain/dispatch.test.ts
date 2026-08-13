import { recordDispatch, remainingPairs } from "../../src/domain/dispatch";

describe("dispatch domain rules", () => {
  it("calculates pending pairs from approved less finalised dispatches", () => {
    expect(remainingPairs(12, [3, 2])).toBe(7);
  });

  it("rejects a dispatch that exceeds the remaining approved quantity", () => {
    expect(
      recordDispatch(
        [{ orderLineId: "line-1", size: "7", approvedPairs: 10, dispatchedPairs: 7, heldPairs: 0 }],
        { orderLineId: "line-1", size: "7", pairs: 4 },
      ),
    ).toEqual({ ok: false, reason: "DISPATCH_EXCEEDS_PENDING" });
  });

  it("blocks held size quantities while allowing dispatch from an unheld size", () => {
    const allocations = [
      { orderLineId: "line-1", size: "7", approvedPairs: 6, dispatchedPairs: 0, heldPairs: 4 },
      { orderLineId: "line-1", size: "8", approvedPairs: 6, dispatchedPairs: 0, heldPairs: 0 },
    ];

    expect(
      recordDispatch(allocations, { orderLineId: "line-1", size: "7", pairs: 3 }),
    ).toEqual({ ok: false, reason: "DISPATCH_EXCEEDS_AVAILABLE" });
    expect(
      recordDispatch(allocations, { orderLineId: "line-1", size: "8", pairs: 3 }),
    ).toEqual({
      ok: true,
      allocations: [
        { orderLineId: "line-1", size: "7", approvedPairs: 6, dispatchedPairs: 0, heldPairs: 4 },
        { orderLineId: "line-1", size: "8", approvedPairs: 6, dispatchedPairs: 3, heldPairs: 0 },
      ],
    });
  });

  it("rejects malformed allocation state including negative prior dispatch", () => {
    expect(
      recordDispatch(
        [{ orderLineId: "line-1", size: "7", approvedPairs: 6, dispatchedPairs: -1, heldPairs: 0 }],
        { orderLineId: "line-1", size: "7", pairs: 1 },
      ),
    ).toEqual({ ok: false, reason: "INVALID_ALLOCATION_STATE" });
  });

  it("rejects non-positive or non-safe-integer dispatch quantities", () => {
    const allocations = [
      { orderLineId: "line-1", size: "7", approvedPairs: 6, dispatchedPairs: 0, heldPairs: 0 },
    ];

    for (const invalid of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        recordDispatch(allocations, { orderLineId: "line-1", size: "7", pairs: invalid }),
      ).toEqual({ ok: false, reason: "INVALID_DISPATCH_QUANTITY" });
    }
  });

  it("rejects a missing request identity instead of throwing", () => {
    const allocations = [
      { orderLineId: "line-1", size: "7", approvedPairs: 6, dispatchedPairs: 0, heldPairs: 0 },
    ];
    const missingIdentity = {
      orderLineId: undefined,
      size: "7",
      pairs: 1,
    } as unknown as Parameters<typeof recordDispatch>[1];

    expect(recordDispatch(allocations, missingIdentity)).toEqual({
      ok: false,
      reason: "INVALID_ALLOCATION_KEY",
    });
  });

  it("rejects invalid values in aggregate pending calculations", () => {
    expect(() => remainingPairs(10, [-1])).toThrow(RangeError);
    expect(() =>
      remainingPairs(Number.MAX_SAFE_INTEGER, [Number.MAX_SAFE_INTEGER, 1]),
    ).toThrow(RangeError);
  });
});
