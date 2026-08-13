export interface HoldablePairs {
  orderedPairs: number;
  dispatchedPairs: number;
  heldPairs: number;
}

export type HoldResult =
  | { ok: true; heldPairs: number }
  | { ok: false; reason: "HOLD_EXCEEDS_UNDISPATCHED" };

export function availablePairsForDispatch({ orderedPairs, dispatchedPairs, heldPairs }: HoldablePairs): number {
  return Math.max(0, orderedPairs - dispatchedPairs - heldPairs);
}

export function applyPartialHold(current: HoldablePairs, pairsToHold: number): HoldResult {
  if (pairsToHold > availablePairsForDispatch({ ...current, heldPairs: 0 })) {
    return { ok: false, reason: "HOLD_EXCEEDS_UNDISPATCHED" };
  }

  if (current.heldPairs + pairsToHold > current.orderedPairs - current.dispatchedPairs) {
    return { ok: false, reason: "HOLD_EXCEEDS_UNDISPATCHED" };
  }

  return { ok: true, heldPairs: current.heldPairs + pairsToHold };
}
