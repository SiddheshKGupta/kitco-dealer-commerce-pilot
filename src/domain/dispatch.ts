import {
  availablePairsForDispatch,
  hasValidAllocationKey,
  isValidFulfilmentAllocations,
  type AllocationQuantityRequest,
  type FulfilmentAllocation,
} from "./holds";

export type DispatchResult =
  | { ok: true; allocations: FulfilmentAllocation[] }
  | {
      ok: false;
      reason:
        | "INVALID_ALLOCATION_STATE"
        | "INVALID_ALLOCATION_KEY"
        | "INVALID_DISPATCH_QUANTITY"
        | "ALLOCATION_NOT_FOUND"
        | "DISPATCH_EXCEEDS_PENDING"
        | "DISPATCH_EXCEEDS_AVAILABLE";
    };

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function remainingPairs(approvedPairs: number, finalisedDispatches: readonly number[]): number {
  if (!isNonNegativeSafeInteger(approvedPairs)) throw new RangeError("approved pairs must be a non-negative safe integer");

  const totalDispatched = finalisedDispatches.reduce((total, pairs) => {
    if (!isNonNegativeSafeInteger(pairs) || total > Number.MAX_SAFE_INTEGER - pairs) {
      throw new RangeError("dispatch pairs must sum to a non-negative safe integer");
    }
    return total + pairs;
  }, 0);
  if (totalDispatched > approvedPairs) throw new RangeError("dispatch pairs cannot exceed approved pairs");
  return approvedPairs - totalDispatched;
}

export function recordDispatch(
  allocations: readonly FulfilmentAllocation[],
  request: AllocationQuantityRequest,
): DispatchResult {
  if (!isValidFulfilmentAllocations(allocations)) return { ok: false, reason: "INVALID_ALLOCATION_STATE" };
  if (!hasValidAllocationKey(request)) {
    return { ok: false, reason: "INVALID_ALLOCATION_KEY" };
  }
  if (!Number.isSafeInteger(request.pairs) || request.pairs <= 0) {
    return { ok: false, reason: "INVALID_DISPATCH_QUANTITY" };
  }

  const targetIndex = allocations.findIndex(
    (allocation) => allocation.orderLineId === request.orderLineId && allocation.size === request.size,
  );
  if (targetIndex < 0) return { ok: false, reason: "ALLOCATION_NOT_FOUND" };

  const target = allocations[targetIndex]!;
  const pendingPairs = target.approvedPairs - target.dispatchedPairs;
  if (request.pairs > pendingPairs) return { ok: false, reason: "DISPATCH_EXCEEDS_PENDING" };

  if (request.pairs > availablePairsForDispatch(target)) {
    return { ok: false, reason: "DISPATCH_EXCEEDS_AVAILABLE" };
  }

  return {
    ok: true,
    allocations: allocations.map((allocation, index) =>
      index === targetIndex
        ? { ...allocation, dispatchedPairs: allocation.dispatchedPairs + request.pairs }
        : { ...allocation },
    ),
  };
}
