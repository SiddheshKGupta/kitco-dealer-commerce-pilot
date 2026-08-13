export interface FulfilmentAllocation {
  readonly orderLineId: string;
  readonly size: string;
  readonly approvedPairs: number;
  readonly dispatchedPairs: number;
  readonly heldPairs: number;
}

export interface AllocationQuantityRequest {
  readonly orderLineId: string;
  readonly size: string;
  readonly pairs: number;
}

export type HoldResult =
  | { ok: true; allocations: FulfilmentAllocation[] }
  | {
      ok: false;
      reason:
        | "INVALID_ALLOCATION_STATE"
        | "INVALID_ALLOCATION_KEY"
        | "INVALID_HOLD_QUANTITY"
        | "ALLOCATION_NOT_FOUND"
        | "HOLD_EXCEEDS_UNDISPATCHED";
    };

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function hasValidAllocationKey(
  allocation: Pick<FulfilmentAllocation, "orderLineId" | "size">,
): boolean {
  return (
    typeof allocation.orderLineId === "string" &&
    allocation.orderLineId.trim().length > 0 &&
    typeof allocation.size === "string" &&
    allocation.size.trim().length > 0
  );
}

function allocationKey(allocation: Pick<FulfilmentAllocation, "orderLineId" | "size">): string {
  return `${allocation.orderLineId}\u0000${allocation.size}`;
}

export function isValidFulfilmentAllocations(allocations: readonly FulfilmentAllocation[]): boolean {
  const keys = new Set<string>();
  return allocations.every((allocation) => {
    if (!hasValidAllocationKey(allocation)) return false;
    if (
      !isNonNegativeSafeInteger(allocation.approvedPairs) ||
      !isNonNegativeSafeInteger(allocation.dispatchedPairs) ||
      !isNonNegativeSafeInteger(allocation.heldPairs) ||
      allocation.dispatchedPairs > allocation.approvedPairs - allocation.heldPairs
    ) {
      return false;
    }

    const key = allocationKey(allocation);
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

export function availablePairsForDispatch(allocation: FulfilmentAllocation): number {
  if (!isValidFulfilmentAllocations([allocation])) {
    throw new RangeError("fulfilment allocation state is invalid");
  }
  return allocation.approvedPairs - allocation.dispatchedPairs - allocation.heldPairs;
}

export function applyPartialHold(
  allocations: readonly FulfilmentAllocation[],
  request: AllocationQuantityRequest,
): HoldResult {
  if (!isValidFulfilmentAllocations(allocations)) return { ok: false, reason: "INVALID_ALLOCATION_STATE" };
  if (!hasValidAllocationKey(request)) return { ok: false, reason: "INVALID_ALLOCATION_KEY" };
  if (!Number.isSafeInteger(request.pairs) || request.pairs <= 0) {
    return { ok: false, reason: "INVALID_HOLD_QUANTITY" };
  }

  const targetIndex = allocations.findIndex((allocation) => allocationKey(allocation) === allocationKey(request));
  if (targetIndex < 0) return { ok: false, reason: "ALLOCATION_NOT_FOUND" };

  const target = allocations[targetIndex]!;
  if (request.pairs > availablePairsForDispatch(target)) {
    return { ok: false, reason: "HOLD_EXCEEDS_UNDISPATCHED" };
  }

  return {
    ok: true,
    allocations: allocations.map((allocation, index) =>
      index === targetIndex ? { ...allocation, heldPairs: allocation.heldPairs + request.pairs } : { ...allocation },
    ),
  };
}
