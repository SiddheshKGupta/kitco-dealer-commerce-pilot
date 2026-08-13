import { applyPartialHold, type FulfilmentAllocation } from "../src/domain/holds";
import { recordDispatch } from "../src/domain/dispatch";
import { createIdempotentSubmission, createOrderVersion, retailValueMinor, validatePurchaseQuantities, type SizeQuantities } from "../src/domain/orders";
import { canOrderOffering } from "../src/domain/catalogue";
import { verifyOtpChallenge } from "../src/domain/otp";
import type { SessionIdentity } from "./middleware/auth";
import { ApiError } from "./middleware/errors";

export interface CatalogueRecord {
  organisationId: string;
  colourwayId: string;
  articleNo: string;
  brand: string;
  colour: string;
  mrpMinor: number;
  currencyCode: string;
  mediaKey: string | null;
  stockPairs: number;
  offering: {
    id: string;
    enabledSizes: string[];
    moqPairs: number;
    orderMultiplePairs: number;
    active: boolean;
    bookingOpensOn: string;
    bookingClosesOn: string;
  };
}

export interface OtpRecord {
  id: string;
  organisationId: string;
  dealerId: string;
  purpose: string;
  secretDigest: string;
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: string | null;
}

export interface DraftLine { offeringId: string; quantities: SizeQuantities; retailValueMinor: number }
export interface OrderVersionRecord { version: number; status: "SUBMITTED" | "PROPOSED" | "ACCEPTED"; retailValueMinor: number; lines: DraftLine[] }
export interface OrderRecord {
  id: string;
  organisationId: string;
  dealerId: string;
  status: "SUBMITTED" | "APPROVED" | "CANCELLED";
  versions: OrderVersionRecord[];
  allocations: FulfilmentAllocation[];
}
export interface AuditEvent { correlationId: string; action: string; organisationId: string; dealerId: string | null; actorUserId: string; entityId: string }
export interface CommerceSeed { catalogue: CatalogueRecord[]; otpChallenges: OtpRecord[] }

export interface CommerceRepository {
  listCatalogue(session: SessionIdentity): Promise<CatalogueRecord[]>;
  findOffering(session: SessionIdentity, offeringId: string): Promise<CatalogueRecord | null>;
  saveDraft(session: SessionIdentity, line: DraftLine, correlationId: string): Promise<DraftLine[]>;
  submitOrder(session: SessionIdentity, input: { idempotencyKey: string; otpChallengeId: string; otpDigest: string; now: string; correlationId: string }): Promise<{ created: boolean; order: OrderRecord }>;
  findOrder(session: SessionIdentity, orderId: string): Promise<OrderRecord | null>;
  requestCancellation(session: SessionIdentity, orderId: string, reason: string, correlationId: string): Promise<{ id: string; status: "PENDING" }>;
  approveOrder(session: SessionIdentity, orderId: string, correlationId: string): Promise<OrderRecord>;
  reviseOrder(session: SessionIdentity, orderId: string, lines: Array<{ offeringId: string; quantities: SizeQuantities }>, correlationId: string): Promise<OrderRecord>;
  applyHold(session: SessionIdentity, input: { orderId: string; orderLineId: string; size: string; pairs: number; reason: string }, correlationId: string): Promise<void>;
  createDispatch(session: SessionIdentity, input: { orderId: string; orderLineId: string; size: string; pairs: number }, correlationId: string): Promise<void>;
  stageImport(session: SessionIdentity, input: { sourceFileId: string; profileId: string }, correlationId: string): Promise<{ id: string; status: "UPLOADED" }>;
}

function clone<T>(value: T): T { return structuredClone(value); }

export class InMemoryCommerceRepository implements CommerceRepository {
  private readonly catalogue: CatalogueRecord[];
  private readonly otpChallenges: OtpRecord[];
  private readonly drafts = new Map<string, DraftLine[]>();
  private readonly orders = new Map<string, OrderRecord>();
  private readonly submissions = new Map<string, OrderRecord>();
  readonly auditEvents: AuditEvent[] = [];

  constructor(seed: CommerceSeed) {
    this.catalogue = clone(seed.catalogue);
    this.otpChallenges = clone(seed.otpChallenges);
  }

  async listCatalogue(session: SessionIdentity) { return clone(this.catalogue.filter((item) => item.organisationId === session.organisationId)); }
  async findOffering(session: SessionIdentity, offeringId: string) {
    return clone(this.catalogue.find((item) => item.organisationId === session.organisationId && item.offering.id === offeringId) ?? null);
  }
  async saveDraft(session: SessionIdentity, line: DraftLine, correlationId: string) {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    const key = `${session.organisationId}:${session.dealerId}`;
    const current = this.drafts.get(key) ?? [];
    const next = [...current.filter((item) => item.offeringId !== line.offeringId), clone(line)];
    this.drafts.set(key, next);
    this.audit(session, correlationId, "DRAFT_SAVED", line.offeringId);
    return clone(next);
  }
  async submitOrder(session: SessionIdentity, input: { idempotencyKey: string; otpChallengeId: string; otpDigest: string; now: string; correlationId: string }) {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    const submissionKey = `${session.organisationId}:${session.dealerId}:${input.idempotencyKey}`;
    const existing = this.submissions.get(submissionKey);
    if (existing) return { created: false, order: clone(existing) };
    const draft = this.drafts.get(`${session.organisationId}:${session.dealerId}`) ?? [];
    if (draft.length === 0) throw new ApiError(409, "EMPTY_DRAFT", "Current Order is empty");
    const challenge = this.otpChallenges.find((item) => item.id === input.otpChallengeId && item.organisationId === session.organisationId && item.dealerId === session.dealerId);
    if (!challenge) throw new ApiError(422, "OTP_INVALID", "OTP challenge is invalid");
    const verification = verifyOtpChallenge(challenge, { purpose: "ORDER_SUBMISSION", secretDigest: input.otpDigest, now: input.now });
    Object.assign(challenge, verification.challenge);
    if (!verification.ok) throw new ApiError(422, verification.reason, "OTP verification failed");
    const result = createIdempotentSubmission(this.submissions, submissionKey, () => {
      const id = crypto.randomUUID();
      const retailValue = draft.reduce((sum, line) => sum + line.retailValueMinor, 0);
      const order: OrderRecord = {
        id, organisationId: session.organisationId, dealerId: session.dealerId!, status: "SUBMITTED",
        versions: [{ version: 1, status: "SUBMITTED", retailValueMinor: retailValue, lines: clone(draft) }],
        allocations: draft.flatMap((line) => Object.entries(line.quantities).map(([size, pairs]) => ({ orderLineId: `${id}:${line.offeringId}`, size, approvedPairs: pairs, dispatchedPairs: 0, heldPairs: 0 }))),
      };
      this.orders.set(id, order);
      return order;
    });
    this.audit(session, input.correlationId, "ORDER_SUBMITTED", result.submission.id);
    return { created: result.created, order: clone(result.submission) };
  }
  async findOrder(session: SessionIdentity, orderId: string) {
    const order = this.orders.get(orderId);
    if (!order || order.organisationId !== session.organisationId) return null;
    if (session.role === "DEALER" && order.dealerId !== session.dealerId) return null;
    return clone(order);
  }
  async requestCancellation(session: SessionIdentity, orderId: string, _reason: string, correlationId: string) {
    if (!(await this.findOrder(session, orderId))) throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found");
    this.audit(session, correlationId, "CANCELLATION_REQUESTED", orderId);
    return { id: crypto.randomUUID(), status: "PENDING" as const };
  }
  async approveOrder(session: SessionIdentity, orderId: string, correlationId: string) {
    const order = this.requireAdminOrder(session, orderId);
    order.status = "APPROVED";
    this.audit(session, correlationId, "ORDER_APPROVED", orderId);
    return clone(order);
  }
  async reviseOrder(session: SessionIdentity, orderId: string, lines: Array<{ offeringId: string; quantities: SizeQuantities }>, correlationId: string) {
    const order = this.requireAdminOrder(session, orderId);
    const canonicalLines = lines.map((line) => {
      const product = this.catalogue.find((item) => item.organisationId === session.organisationId && item.offering.id === line.offeringId);
      if (!product) throw new ApiError(404, "OFFERING_NOT_FOUND", "Offering not found");
      const validation = validatePurchaseQuantities({ enabledSizes: product.offering.enabledSizes, moqPairs: product.offering.moqPairs, orderMultiplePairs: product.offering.orderMultiplePairs }, line.quantities);
      if (!validation.ok) throw new ApiError(422, validation.reason, "Purchase quantities are invalid");
      return { offeringId: line.offeringId, quantities: clone(line.quantities), retailValueMinor: retailValueMinor(product.mrpMinor, line.quantities) };
    });
    const previous = order.versions.at(-1)!;
    const version = createOrderVersion({ orderId, version: previous.version, lines: previous.lines.map((line) => ({ articleNo: line.offeringId, quantities: line.quantities })) }, canonicalLines.map((line) => ({ articleNo: line.offeringId, quantities: line.quantities })));
    order.versions.push({ version: version.version, status: "PROPOSED", retailValueMinor: canonicalLines.reduce((sum, line) => sum + line.retailValueMinor, 0), lines: canonicalLines });
    order.allocations = canonicalLines.flatMap((line) => Object.entries(line.quantities).map(([size, pairs]) => ({ orderLineId: `${orderId}:${line.offeringId}`, size, approvedPairs: pairs, dispatchedPairs: 0, heldPairs: 0 })));
    this.audit(session, correlationId, "ORDER_REVISION_PROPOSED", orderId);
    return clone(order);
  }
  async applyHold(session: SessionIdentity, input: { orderId: string; orderLineId: string; size: string; pairs: number; reason: string }, correlationId: string) {
    const order = this.requireAdminOrder(session, input.orderId);
    const result = applyPartialHold(order.allocations, input);
    if (!result.ok) throw new ApiError(422, result.reason, "Hold cannot be applied");
    order.allocations = result.allocations;
    this.audit(session, correlationId, "HOLD_APPLIED", input.orderId);
  }
  async createDispatch(session: SessionIdentity, input: { orderId: string; orderLineId: string; size: string; pairs: number }, correlationId: string) {
    const order = this.requireAdminOrder(session, input.orderId);
    const result = recordDispatch(order.allocations, input);
    if (!result.ok) throw new ApiError(422, result.reason, "Dispatch cannot be recorded");
    order.allocations = result.allocations;
    this.audit(session, correlationId, "DISPATCH_FINALISED", input.orderId);
  }
  async stageImport(session: SessionIdentity, _input: { sourceFileId: string; profileId: string }, correlationId: string) {
    if (session.role !== "ADMIN") throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const id = crypto.randomUUID();
    this.audit(session, correlationId, "IMPORT_UPLOADED", id);
    return { id, status: "UPLOADED" as const };
  }
  validateOffering(product: CatalogueRecord, quantities: SizeQuantities, onDate: string) {
    if (!canOrderOffering(product.offering, onDate)) throw new ApiError(422, "OFFERING_CLOSED", "Offering is not open for ordering");
    return validatePurchaseQuantities({ enabledSizes: product.offering.enabledSizes, moqPairs: product.offering.moqPairs, orderMultiplePairs: product.offering.orderMultiplePairs }, quantities);
  }
  private requireAdminOrder(session: SessionIdentity, orderId: string) {
    if (session.role !== "ADMIN") throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const order = this.orders.get(orderId);
    if (!order || order.organisationId !== session.organisationId) throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found");
    return order;
  }
  private audit(session: SessionIdentity, correlationId: string, action: string, entityId: string) {
    this.auditEvents.push({ correlationId, action, organisationId: session.organisationId, dealerId: session.dealerId, actorUserId: session.userId, entityId });
  }
}
