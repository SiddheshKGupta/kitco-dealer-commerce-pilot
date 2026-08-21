export const HOLD_REASONS = [
  "CREDIT_HOLD",
  "STOCK_REVIEW",
  "COMMERCIAL_REVIEW",
  "ALLOCATION_PENDING",
  "MANUAL_REVIEW",
  "OTHER",
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export interface FulfilmentAllocation {
  readonly orderLineId: string;
  readonly size: string;
  /** Immutable submitted quantity for this line+size. Falls back to
   *  approvedPairs where absent (pre-decision data / older callers), since
   *  approved was pre-set equal to ordered before this field existed. */
  readonly orderedPairs?: number;
  readonly approvedPairs: number;
  readonly dispatchedPairs: number;
  readonly heldPairs: number;
  readonly holdReason?: HoldReason | string;
  readonly articleNo?: string;
  readonly colour?: string;
  readonly familyName?: string;
  readonly brand?: string;
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

export interface LineDecisionRequest {
  readonly orderLineId: string;
  readonly size: string;
  readonly approvedPairs: number;
  readonly heldPairs: number;
  readonly holdReason: HoldReason | null;
}

export type DecisionResult =
  | { ok: true; allocations: FulfilmentAllocation[] }
  | {
      ok: false;
      reason:
        | "INVALID_ALLOCATION_KEY"
        | "ALLOCATION_NOT_FOUND"
        | "INVALID_DECISION_QUANTITY"
        | "DECISION_EXCEEDS_ORDERED"
        | "HOLD_REASON_REQUIRED"
        | "DECISION_BELOW_DISPATCHED";
    };

/** Sets the definitive approved/held quantities for one order line + size --
 *  a replace, not an increment, since this is one admin decision per size,
 *  not a running total. Requires the immutable ordered quantity (falls back
 *  to the allocation's current approvedPairs when absent, matching pre-
 *  decision data where approved was pre-set equal to ordered). */
export function decideLineAllocation(
  allocations: readonly FulfilmentAllocation[],
  request: LineDecisionRequest,
): DecisionResult {
  if (!hasValidAllocationKey(request)) return { ok: false, reason: "INVALID_ALLOCATION_KEY" };
  if (!isNonNegativeSafeInteger(request.approvedPairs) || !isNonNegativeSafeInteger(request.heldPairs)) {
    return { ok: false, reason: "INVALID_DECISION_QUANTITY" };
  }

  const targetIndex = allocations.findIndex((allocation) => allocationKey(allocation) === allocationKey(request));
  if (targetIndex < 0) return { ok: false, reason: "ALLOCATION_NOT_FOUND" };

  const target = allocations[targetIndex]!;
  const orderedPairs = target.orderedPairs ?? target.approvedPairs;
  if (request.approvedPairs + request.heldPairs > orderedPairs) return { ok: false, reason: "DECISION_EXCEEDS_ORDERED" };
  if (request.heldPairs > 0 && !request.holdReason) return { ok: false, reason: "HOLD_REASON_REQUIRED" };
  if (request.approvedPairs < target.dispatchedPairs) return { ok: false, reason: "DECISION_BELOW_DISPATCHED" };

  return {
    ok: true,
    allocations: allocations.map((allocation, index) =>
      index === targetIndex
        ? {
            ...allocation,
            orderedPairs,
            approvedPairs: request.approvedPairs,
            heldPairs: request.heldPairs,
            holdReason: request.heldPairs > 0 ? request.holdReason ?? undefined : undefined,
          }
        : { ...allocation },
    ),
  };
}
