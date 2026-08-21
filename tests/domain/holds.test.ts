import { applyPartialHold, availablePairsForDispatch, decideLineAllocation } from "../../src/domain/holds";

describe("credit hold domain rules", () => {
  it("tracks a partial size hold without changing the purchased quantity", () => {
    const hold = applyPartialHold(
      [{ orderLineId: "line-1", size: "7", approvedPairs: 10, dispatchedPairs: 2, heldPairs: 1 }],
      { orderLineId: "line-1", size: "7", pairs: 3 },
    );

    expect(hold).toEqual({
      ok: true,
      allocations: [
        { orderLineId: "line-1", size: "7", approvedPairs: 10, dispatchedPairs: 2, heldPairs: 4 },
      ],
    });
    expect(
      availablePairsForDispatch({
        orderLineId: "line-1",
        size: "7",
        approvedPairs: 10,
        dispatchedPairs: 2,
        heldPairs: 4,
      }),
    ).toBe(4);
  });

  it("rejects a hold greater than the undispatched quantity", () => {
    expect(
      applyPartialHold(
        [{ orderLineId: "line-1", size: "7", approvedPairs: 10, dispatchedPairs: 7, heldPairs: 1 }],
        { orderLineId: "line-1", size: "7", pairs: 3 },
      ),
    ).toEqual({ ok: false, reason: "HOLD_EXCEEDS_UNDISPATCHED" });
  });

  it("rejects non-positive or non-safe-integer hold quantities", () => {
    const allocations = [
      { orderLineId: "line-1", size: "7", approvedPairs: 10, dispatchedPairs: 0, heldPairs: 0 },
    ];

    for (const invalid of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        applyPartialHold(allocations, { orderLineId: "line-1", size: "7", pairs: invalid }),
      ).toEqual({ ok: false, reason: "INVALID_HOLD_QUANTITY" });
    }
  });

  it("rejects malformed allocation state", () => {
    const request = { orderLineId: "line-1", size: "7", pairs: 1 };
    const invalidStates = [
      { orderLineId: "line-1", size: "7", approvedPairs: -1, dispatchedPairs: 0, heldPairs: 0 },
      { orderLineId: "line-1", size: "7", approvedPairs: 10, dispatchedPairs: 1.5, heldPairs: 0 },
      { orderLineId: "line-1", size: "7", approvedPairs: 10, dispatchedPairs: 0, heldPairs: Number.NaN },
      {
        orderLineId: "line-1",
        size: "7",
        approvedPairs: Number.MAX_SAFE_INTEGER + 1,
        dispatchedPairs: 0,
        heldPairs: 0,
      },
      { orderLineId: "line-1", size: "7", approvedPairs: 3, dispatchedPairs: 2, heldPairs: 2 },
    ];

    for (const invalidState of invalidStates) {
      expect(applyPartialHold([invalidState], request)).toEqual({
        ok: false,
        reason: "INVALID_ALLOCATION_STATE",
      });
    }
  });

  it("rejects missing allocation identity instead of throwing", () => {
    const missingIdentity = {
      orderLineId: undefined,
      size: "7",
      approvedPairs: 3,
      dispatchedPairs: 0,
      heldPairs: 0,
    } as unknown as Parameters<typeof applyPartialHold>[0][number];

    expect(
      applyPartialHold([missingIdentity], { orderLineId: "line-1", size: "7", pairs: 1 }),
    ).toEqual({ ok: false, reason: "INVALID_ALLOCATION_STATE" });
  });

  it("applies a hold to only the requested order-line size allocation", () => {
    const allocations = [
      { orderLineId: "line-1", size: "7", approvedPairs: 6, dispatchedPairs: 0, heldPairs: 0 },
      { orderLineId: "line-1", size: "8", approvedPairs: 6, dispatchedPairs: 0, heldPairs: 0 },
    ];

    expect(
      applyPartialHold(allocations, { orderLineId: "line-1", size: "7", pairs: 4 }),
    ).toEqual({
      ok: true,
      allocations: [
        { orderLineId: "line-1", size: "7", approvedPairs: 6, dispatchedPairs: 0, heldPairs: 4 },
        { orderLineId: "line-1", size: "8", approvedPairs: 6, dispatchedPairs: 0, heldPairs: 0 },
      ],
    });
  });
});

describe("per-line/size decision domain rules", () => {
  const allocations = [
    { orderLineId: "line-1", size: "7", orderedPairs: 10, approvedPairs: 10, dispatchedPairs: 0, heldPairs: 0 },
  ];

  it("records a partial approve + hold decision with a reason", () => {
    expect(
      decideLineAllocation(allocations, { orderLineId: "line-1", size: "7", approvedPairs: 7, heldPairs: 3, holdReason: "STOCK_REVIEW" }),
    ).toEqual({
      ok: true,
      allocations: [
        { orderLineId: "line-1", size: "7", orderedPairs: 10, approvedPairs: 7, dispatchedPairs: 0, heldPairs: 3, holdReason: "STOCK_REVIEW" },
      ],
    });
  });

  it("rejects approved + held exceeding the ordered quantity", () => {
    expect(
      decideLineAllocation(allocations, { orderLineId: "line-1", size: "7", approvedPairs: 8, heldPairs: 3, holdReason: "OTHER" }),
    ).toEqual({ ok: false, reason: "DECISION_EXCEEDS_ORDERED" });
  });

  it("requires a hold reason whenever pairs are held", () => {
    expect(
      decideLineAllocation(allocations, { orderLineId: "line-1", size: "7", approvedPairs: 7, heldPairs: 3, holdReason: null }),
    ).toEqual({ ok: false, reason: "HOLD_REASON_REQUIRED" });
  });

  it("rejects dropping approved pairs below what's already dispatched", () => {
    const dispatched = [{ orderLineId: "line-1", size: "7", orderedPairs: 10, approvedPairs: 10, dispatchedPairs: 6, heldPairs: 0 }];
    expect(
      decideLineAllocation(dispatched, { orderLineId: "line-1", size: "7", approvedPairs: 5, heldPairs: 0, holdReason: null }),
    ).toEqual({ ok: false, reason: "DECISION_BELOW_DISPATCHED" });
  });

  it("rejects negative or non-integer quantities and an unknown allocation", () => {
    expect(
      decideLineAllocation(allocations, { orderLineId: "line-1", size: "7", approvedPairs: -1, heldPairs: 0, holdReason: null }),
    ).toEqual({ ok: false, reason: "INVALID_DECISION_QUANTITY" });
    expect(
      decideLineAllocation(allocations, { orderLineId: "line-1", size: "9", approvedPairs: 1, heldPairs: 0, holdReason: null }),
    ).toEqual({ ok: false, reason: "ALLOCATION_NOT_FOUND" });
  });

  it("clears a previous hold when the new decision holds nothing", () => {
    const held = [{ orderLineId: "line-1", size: "7", orderedPairs: 10, approvedPairs: 7, dispatchedPairs: 0, heldPairs: 3, holdReason: "OTHER" }];
    expect(
      decideLineAllocation(held, { orderLineId: "line-1", size: "7", approvedPairs: 10, heldPairs: 0, holdReason: null }),
    ).toEqual({
      ok: true,
      allocations: [{ orderLineId: "line-1", size: "7", orderedPairs: 10, approvedPairs: 10, dispatchedPairs: 0, heldPairs: 0, holdReason: undefined }],
    });
  });
});
