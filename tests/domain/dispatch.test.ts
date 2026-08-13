import { recordDispatch, remainingPairs } from "../../src/domain/dispatch";

describe("dispatch domain rules", () => {
  it("calculates pending pairs from approved less finalised dispatches", () => {
    expect(remainingPairs(12, [3, 2])).toBe(7);
  });

  it("rejects a dispatch that exceeds the remaining approved quantity", () => {
    expect(recordDispatch({ approvedPairs: 10, finalisedDispatchPairs: 7, heldPairs: 0 }, 4)).toEqual({
      ok: false,
      reason: "DISPATCH_EXCEEDS_PENDING",
    });
  });

  it("rejects dispatch of held pair quantities", () => {
    expect(recordDispatch({ approvedPairs: 10, finalisedDispatchPairs: 4, heldPairs: 2 }, 5)).toEqual({
      ok: false,
      reason: "DISPATCH_EXCEEDS_AVAILABLE",
    });
  });
});
