export type SizeQuantities = Record<string, number>;

export interface PurchasePolicy {
  enabledSizes: readonly string[];
  moqPairs: number;
  orderMultiplePairs: number;
}

export type PurchaseValidation =
  | { ok: true }
  | { ok: false; reason: "SIZE_NOT_ENABLED" | "MOQ_NOT_MET" | "ORDER_MULTIPLE_NOT_MET" };

export interface OrderLine {
  articleNo: string;
  quantities: SizeQuantities;
}

export interface OrderVersion {
  orderId: string;
  version: number;
  lines: OrderLine[];
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}

function pairCount(quantities: SizeQuantities): number {
  return Object.values(quantities).reduce((total, quantity) => {
    assertNonNegativeInteger(quantity, "quantity");
    return total + quantity;
  }, 0);
}

export function validatePurchaseQuantities(policy: PurchasePolicy, quantities: SizeQuantities): PurchaseValidation {
  const enabledSizes = new Set(policy.enabledSizes.map((size) => size.trim().toUpperCase()));
  const hasDisabledSize = Object.entries(quantities).some(([size, quantity]) =>
    quantity > 0 && !enabledSizes.has(size.trim().toUpperCase()),
  );
  if (hasDisabledSize) return { ok: false, reason: "SIZE_NOT_ENABLED" };

  const totalPairs = pairCount(quantities);
  if (totalPairs < policy.moqPairs) return { ok: false, reason: "MOQ_NOT_MET" };
  if (totalPairs % policy.orderMultiplePairs !== 0) return { ok: false, reason: "ORDER_MULTIPLE_NOT_MET" };

  return { ok: true };
}

export function retailValueMinor(mrpMinorPerPair: number, quantities: SizeQuantities): number {
  assertNonNegativeInteger(mrpMinorPerPair, "MRP");
  return mrpMinorPerPair * pairCount(quantities);
}

export function createOrderVersion(previous: OrderVersion, lines: readonly OrderLine[]): OrderVersion {
  return {
    orderId: previous.orderId,
    version: previous.version + 1,
    lines: lines.map((line) => ({
      articleNo: line.articleNo,
      quantities: { ...line.quantities },
    })),
  };
}

export interface IdempotentSubmission<T> {
  created: boolean;
  submission: T;
}

export function createIdempotentSubmission<T>(
  submissions: Map<string, T>,
  idempotencyKey: string,
  create: () => T,
): IdempotentSubmission<T> {
  const existing = submissions.get(idempotencyKey);
  if (existing !== undefined) return { created: false, submission: existing };

  const submission = create();
  submissions.set(idempotencyKey, submission);
  return { created: true, submission };
}
