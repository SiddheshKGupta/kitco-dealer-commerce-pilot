import { applyPartialHold, availablePairsForDispatch } from "../../src/domain/holds";

describe("credit hold domain rules", () => {
  it("tracks a partial size hold without changing the purchased quantity", () => {
    const hold = applyPartialHold({ orderedPairs: 10, dispatchedPairs: 2, heldPairs: 1 }, 3);

    expect(hold).toEqual({ ok: true, heldPairs: 4 });
    expect(availablePairsForDispatch({ orderedPairs: 10, dispatchedPairs: 2, heldPairs: 4 })).toBe(4);
  });

  it("rejects a hold greater than the undispatched quantity", () => {
    expect(applyPartialHold({ orderedPairs: 10, dispatchedPairs: 7, heldPairs: 1 }, 3)).toEqual({
      ok: false,
      reason: "HOLD_EXCEEDS_UNDISPATCHED",
    });
  });
});
