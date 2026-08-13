import { availablePairsForDispatch } from "./holds";

export interface DispatchState {
  approvedPairs: number;
  finalisedDispatchPairs: number;
  heldPairs: number;
}

export type DispatchResult =
  | { ok: true; finalisedDispatchPairs: number }
  | { ok: false; reason: "DISPATCH_INVALID_QUANTITY" | "DISPATCH_EXCEEDS_PENDING" | "DISPATCH_EXCEEDS_AVAILABLE" };

export function remainingPairs(approvedPairs: number, finalisedDispatches: readonly number[]): number {
  return approvedPairs - finalisedDispatches.reduce((total, pairs) => total + pairs, 0);
}

export function recordDispatch(state: DispatchState, pairs: number): DispatchResult {
  if (!Number.isInteger(pairs) || pairs <= 0) return { ok: false, reason: "DISPATCH_INVALID_QUANTITY" };

  const pendingPairs = state.approvedPairs - state.finalisedDispatchPairs;
  if (pairs > pendingPairs) return { ok: false, reason: "DISPATCH_EXCEEDS_PENDING" };

  const availablePairs = availablePairsForDispatch({
    orderedPairs: state.approvedPairs,
    dispatchedPairs: state.finalisedDispatchPairs,
    heldPairs: state.heldPairs,
  });
  if (pairs > availablePairs) return { ok: false, reason: "DISPATCH_EXCEEDS_AVAILABLE" };

  return { ok: true, finalisedDispatchPairs: state.finalisedDispatchPairs + pairs };
}
