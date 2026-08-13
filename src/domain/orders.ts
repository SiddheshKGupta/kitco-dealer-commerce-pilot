export type SizeQuantities = Readonly<Record<string, number>>;

export interface PurchasePolicy {
  enabledSizes: readonly string[];
  moqPairs: number;
  orderMultiplePairs: number;
}

export type PurchaseValidation =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "INVALID_POLICY"
        | "INVALID_QUANTITY"
        | "SIZE_NOT_ENABLED"
        | "MOQ_NOT_MET"
        | "ORDER_MULTIPLE_NOT_MET";
    };

export interface OrderLine {
  readonly articleNo: string;
  readonly quantities: SizeQuantities;
}

export interface OrderVersion {
  readonly orderId: string;
  readonly version: number;
  readonly lines: readonly OrderLine[];
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function pairCount(quantities: SizeQuantities): number {
  return Object.values(quantities).reduce((total, quantity) => {
    assertNonNegativeInteger(quantity, "quantity");
    if (total > Number.MAX_SAFE_INTEGER - quantity) {
      throw new RangeError("pair quantity sum must be a safe integer");
    }
    return total + quantity;
  }, 0);
}

export function validatePurchaseQuantities(policy: PurchasePolicy, quantities: SizeQuantities): PurchaseValidation {
  if (
    !Number.isSafeInteger(policy.moqPairs) ||
    policy.moqPairs <= 0 ||
    !Number.isSafeInteger(policy.orderMultiplePairs) ||
    policy.orderMultiplePairs <= 0
  ) {
    return { ok: false, reason: "INVALID_POLICY" };
  }

  let totalPairs: number;
  try {
    totalPairs = pairCount(quantities);
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, reason: "INVALID_QUANTITY" };
    throw error;
  }

  const enabledSizes = new Set(policy.enabledSizes.map((size) => size.trim().toUpperCase()));
  const hasDisabledSize = Object.entries(quantities).some(([size, quantity]) =>
    quantity > 0 && !enabledSizes.has(size.trim().toUpperCase()),
  );
  if (hasDisabledSize) return { ok: false, reason: "SIZE_NOT_ENABLED" };

  if (totalPairs < policy.moqPairs) return { ok: false, reason: "MOQ_NOT_MET" };
  if (totalPairs % policy.orderMultiplePairs !== 0) return { ok: false, reason: "ORDER_MULTIPLE_NOT_MET" };

  return { ok: true };
}

export function retailValueMinor(mrpMinorPerPair: number, quantities: SizeQuantities): number {
  assertNonNegativeInteger(mrpMinorPerPair, "MRP");
  const pairs = pairCount(quantities);
  if (pairs > 0 && mrpMinorPerPair > Math.floor(Number.MAX_SAFE_INTEGER / pairs)) {
    throw new RangeError("Retail Value must be a safe integer");
  }
  return mrpMinorPerPair * pairs;
}

export function createOrderVersion(previous: OrderVersion, lines: readonly OrderLine[]): OrderVersion {
  if (!Number.isSafeInteger(previous.version) || previous.version <= 0 || previous.version === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("order version must be a positive safe integer with room for a revision");
  }

  const frozenLines = Object.freeze(
    lines.map((line) => {
      pairCount(line.quantities);
      return Object.freeze({
        articleNo: line.articleNo,
        quantities: Object.freeze({ ...line.quantities }),
      });
    }),
  );

  return Object.freeze({
    orderId: previous.orderId,
    version: previous.version + 1,
    lines: frozenLines,
  });
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
