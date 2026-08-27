import { applyPartialHold, type FulfilmentAllocation } from "../src/domain/holds";
import { recordDispatch } from "../src/domain/dispatch";
import { createIdempotentSubmission, createOrderVersion, retailValueMinor, validatePurchaseQuantities, type SizeQuantities } from "../src/domain/orders";
import { canOrderOffering } from "../src/domain/catalogue";
import { verifyOtpChallenge } from "../src/domain/otp";
import { isAdminRole, type SessionIdentity } from "./middleware/auth";
import { ApiError } from "./middleware/errors";

export interface CatalogueRecord {
  organisationId: string;
  colourwayId: string;
  articleNo: string;
  brand: string;
  familyId?: string | null;
  familyName?: string | null;
  category?: string | null;
  gender?: string | null;
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
    type?: "STOCK_IN_HAND" | "UPCOMING" | "PREBOOK";
    sizeSystemLabel?: string | null;
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

export interface DraftLine {
  offeringId: string; quantities: SizeQuantities; retailValueMinor: number;
  articleNo?: string; brand?: string; familyName?: string; colour?: string;
  mrpMinor?: number; currencyCode?: string; mediaKey?: string | null;
  /** Size System is never optional (V5_PRODUCT_SPEC.md §4) -- null when the size set's
   *  size_system_id hasn't been confirmed yet (true for every size set today). */
  sizeSystemLabel?: string | null;
}
export interface OrderVersionRecord { version: number; status: "SUBMITTED" | "PROPOSED" | "ACCEPTED"; retailValueMinor: number; lines: DraftLine[] }
/** A single row of an order's real audit trail (see SupabaseCommerceRepository.attachAudit). action/detail
 *  are already human-paraphrased for admin display -- never raw event_type enums or evidence JSON. */
export interface OrderAuditEvent { correlationId: string; action: string; detail: string; occurredAt: string; actorEmail: string }
export interface OrderRecord {
  id: string;
  orderNumber: string;
  organisationId: string;
  dealerId: string;
  status: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "PARTIALLY_APPROVED" | "CREDIT_REVIEW" | "REJECTED" | "CANCELLED";
  versions: OrderVersionRecord[];
  allocations: FulfilmentAllocation[];
  dealerName?: string;
  dealerCity?: string;
  dealerState?: string;
  submittedAt?: string;
  version?: number;
  retailValueMinor?: number;
  audit?: OrderAuditEvent[];
}
export interface AuditEvent { correlationId: string; action: string; organisationId: string; dealerId: string | null; actorUserId: string; entityId: string }
export interface DealerLocationRecord { id: string; name: string; locationType: "BILL_TO" | "SHIP_TO" | "BOTH" }
export interface CommerceSeed { catalogue: CatalogueRecord[]; otpChallenges: OtpRecord[] }

/* ------------------------------------------------------------- v5 order review
 * Phase 5: the article-tile order review screen reads/writes through these,
 * entirely additive to the OrderRecord/allocations pipeline above (which the
 * dealer-facing routes and the admin order list/table still use unchanged). */
export interface OrderLineSizeDecision {
  orderLineId: string;
  size: string;
  orderedQty: number;
  approvedQty: number;
  creditReviewQty: number;
  rejectedQty: number;
  pendingQty: number;
  creditReviewReason: string | null;
  rejectionReason: string | null;
}
export interface OrderReviewArticle {
  orderLineId: string;
  articleNo?: string;
  brand?: string;
  familyName?: string;
  colour?: string;
  sizes: OrderLineSizeDecision[];
}
export interface OrderPartnerSnapshot {
  dealerId?: string; code?: string; name?: string; gstin?: string;
  addressLine1?: string; city?: string; state?: string; pinCode?: string;
}
export interface OrderReviewDetail {
  id: string;
  orderNumber: string;
  status: string;
  orderingDealer: OrderPartnerSnapshot | null;
  billTo: OrderPartnerSnapshot | null;
  shipTo: OrderPartnerSnapshot | null;
  dealerPoNumber: string | null;
  deliveryPreference: string | null;
  requestedDeliveryDate: string | null;
  estimatedDeliveryDate: string | null;
  articles: OrderReviewArticle[];
  totals: { ordered: number; approved: number; creditReview: number; rejected: number; pending: number };
  audit: OrderAuditEvent[];
}
export interface DecideOrderLineV5Input {
  orderId: string; orderLineId: string; size: string;
  approvedQty: number; creditReviewQty: number; rejectedQty: number;
  creditReviewReason: string | null; rejectionReason: string | null;
}

/** Phase 4: the partner functions/PO/delivery fields submitOrder needs on top of the
 *  OTP/idempotency fields it already took. billToDealerId/shipToDealerId/shipToLocationId
 *  arrive here already validated by SupabaseDealerGroups.resolveOrderPartners -- the
 *  Worker route resolves them before calling submitOrder, so this input is trusted,
 *  never the raw client body (V5_DEALER_GROUP_MODEL.md §4). */
export interface SubmitOrderInput {
  idempotencyKey: string;
  otpChallengeId: string;
  otpDigest?: string;
  now: string;
  correlationId: string;
  billToDealerId: string;
  shipToDealerId: string;
  shipToLocationId: string | null;
  dealerPoNumber: string | null;
  deliveryPreference: "ASAP" | "REQUESTED_DATE";
  requestedDeliveryDate: string | null;
}

export interface CommerceRepository {
  listCatalogue(session: SessionIdentity): Promise<CatalogueRecord[]>;
  findOffering(session: SessionIdentity, offeringId: string): Promise<CatalogueRecord | null>;
  saveDraft(session: SessionIdentity, line: DraftLine, correlationId: string): Promise<DraftLine[]>;
  getDraft(session: SessionIdentity): Promise<DraftLine[]>;
  removeDraftLine(session: SessionIdentity, offeringId: string, correlationId: string): Promise<DraftLine[]>;
  findSubmittedOrderByIdempotency(session: SessionIdentity, idempotencyKey: string): Promise<OrderRecord | null>;
  submitOrder(session: SessionIdentity, input: SubmitOrderInput): Promise<{ created: boolean; order: OrderRecord }>;
  listOrders(session: SessionIdentity): Promise<OrderRecord[]>;
  findOrder(session: SessionIdentity, orderId: string): Promise<OrderRecord | null>;
  listDealerLocations(session: SessionIdentity): Promise<DealerLocationRecord[]>;
  requestCancellation(session: SessionIdentity, orderId: string, reason: string, correlationId: string): Promise<{ id: string; status: "PENDING" }>;
  approveOrder(session: SessionIdentity, orderId: string, correlationId: string): Promise<OrderRecord>;
  reviseOrder(session: SessionIdentity, orderId: string, lines: Array<{ offeringId: string; quantities: SizeQuantities }>, correlationId: string): Promise<OrderRecord>;
  applyHold(session: SessionIdentity, input: { orderId: string; orderLineId: string; size: string; pairs: number; reason: string }, correlationId: string): Promise<void>;
  createDispatch(session: SessionIdentity, input: { orderId: string; orderLineId: string; size: string; pairs: number; dealerLocationId?: string }, correlationId: string): Promise<OrderRecord>;
  stageImport(session: SessionIdentity, input: { sourceFileId: string; profileId: string }, correlationId: string): Promise<{ id: string; status: "UPLOADED" }>;

  /** v5 Phase 5: article-tile order review, backed by order_line_decisions. */
  getOrderReview(session: SessionIdentity, orderId: string): Promise<OrderReviewDetail | null>;
  decideOrderLineV5(session: SessionIdentity, input: DecideOrderLineV5Input, correlationId: string): Promise<OrderReviewDetail>;
  approveEntireOrder(session: SessionIdentity, orderId: string, correlationId: string): Promise<OrderReviewDetail>;
  rejectEntireOrder(session: SessionIdentity, orderId: string, reason: string, correlationId: string): Promise<OrderReviewDetail>;
}

function clone<T>(value: T): T { return structuredClone(value); }

export class InMemoryCommerceRepository implements CommerceRepository {
  private readonly catalogue: CatalogueRecord[];
  private readonly otpChallenges: OtpRecord[];
  private readonly drafts = new Map<string, DraftLine[]>();
  private readonly orders = new Map<string, OrderRecord>();
  private readonly submissions = new Map<string, OrderRecord>();
  private readonly orderNumberSeq = new Map<string, number>();
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
    const product = this.catalogue.find((item) => item.organisationId === session.organisationId && item.offering.id === line.offeringId);
    const enriched: DraftLine = {
      ...line,
      articleNo: product?.articleNo, brand: product?.brand, familyName: product?.familyName ?? undefined,
      colour: product?.colour, mrpMinor: product?.mrpMinor, currencyCode: product?.currencyCode, mediaKey: product?.mediaKey,
    };
    const next = [...current.filter((item) => item.offeringId !== line.offeringId), clone(enriched)];
    this.drafts.set(key, next);
    this.audit(session, correlationId, "DRAFT_SAVED", line.offeringId);
    return clone(next);
  }
  async getDraft(session: SessionIdentity) {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    return clone(this.drafts.get(`${session.organisationId}:${session.dealerId}`) ?? []);
  }
  async removeDraftLine(session: SessionIdentity, offeringId: string, correlationId: string) {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    const key = `${session.organisationId}:${session.dealerId}`;
    const next = (this.drafts.get(key) ?? []).filter((item) => item.offeringId !== offeringId);
    this.drafts.set(key, next);
    this.audit(session, correlationId, "DRAFT_LINE_REMOVED", offeringId);
    return clone(next);
  }
  async findSubmittedOrderByIdempotency(session: SessionIdentity, idempotencyKey: string) {
    if (!session.dealerId) return null;
    return clone(this.submissions.get(`${session.organisationId}:${session.dealerId}:${idempotencyKey}`) ?? null);
  }
  async submitOrder(session: SessionIdentity, input: SubmitOrderInput) {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    const submissionKey = `${session.organisationId}:${session.dealerId}:${input.idempotencyKey}`;
    const existing = this.submissions.get(submissionKey);
    if (existing) return { created: false, order: clone(existing) };
    const draft = this.drafts.get(`${session.organisationId}:${session.dealerId}`) ?? [];
    if (draft.length === 0) throw new ApiError(409, "EMPTY_DRAFT", "Current Order is empty");
    const challenge = this.otpChallenges.find((item) => item.id === input.otpChallengeId && item.organisationId === session.organisationId && item.dealerId === session.dealerId);
    if (!challenge) throw new ApiError(422, "OTP_INVALID", "OTP challenge is invalid");
    const verification = verifyOtpChallenge(challenge, { purpose: "ORDER_SUBMISSION", secretDigest: input.otpDigest ?? challenge.secretDigest, now: input.now });
    Object.assign(challenge, verification.challenge);
    if (!verification.ok) throw new ApiError(422, verification.reason, "OTP verification failed");
    const result = createIdempotentSubmission(this.submissions, submissionKey, () => {
      const id = crypto.randomUUID();
      const orderNumber = this.nextOrderNumber(session.organisationId, new Date(input.now));
      const retailValue = draft.reduce((sum, line) => sum + line.retailValueMinor, 0);
      const order: OrderRecord = {
        id, orderNumber, organisationId: session.organisationId, dealerId: session.dealerId!, status: "SUBMITTED",
        versions: [{ version: 1, status: "SUBMITTED", retailValueMinor: retailValue, lines: clone(draft) }],
        allocations: draft.flatMap((line) => {
          const product = this.catalogue.find((item) => item.organisationId === session.organisationId && item.offering.id === line.offeringId);
          return Object.entries(line.quantities).map(([size, pairs]) => ({
            orderLineId: `${id}:${line.offeringId}`, size, orderedPairs: pairs, approvedPairs: pairs, dispatchedPairs: 0, heldPairs: 0,
            articleNo: product?.articleNo, colour: product?.colour, familyName: product?.familyName ?? undefined, brand: product?.brand,
          }));
        }),
      };
      this.orders.set(id, order);
      return order;
    });
    this.audit(session, input.correlationId, "ORDER_SUBMITTED", result.submission.id);
    return { created: result.created, order: clone(result.submission) };
  }
  async listOrders(session: SessionIdentity) {
    return clone([...this.orders.values()].filter((order) => order.organisationId === session.organisationId && (isAdminRole(session.role) || order.dealerId === session.dealerId)));
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
  async listDealerLocations(session: SessionIdentity): Promise<DealerLocationRecord[]> {
    if (!session.dealerId) throw new ApiError(403, "DEALER_REQUIRED", "Dealer access is required");
    return [{ id: `${session.dealerId}:main`, name: "Main location", locationType: "BOTH" }];
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
    order.allocations = canonicalLines.flatMap((line) => {
      const product = this.catalogue.find((item) => item.organisationId === session.organisationId && item.offering.id === line.offeringId);
      return Object.entries(line.quantities).map(([size, pairs]) => ({
        orderLineId: `${orderId}:${line.offeringId}`, size, orderedPairs: pairs, approvedPairs: pairs, dispatchedPairs: 0, heldPairs: 0,
        articleNo: product?.articleNo, colour: product?.colour, familyName: product?.familyName ?? undefined, brand: product?.brand,
      }));
    });
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
  async createDispatch(session: SessionIdentity, input: { orderId: string; orderLineId: string; size: string; pairs: number; dealerLocationId?: string }, correlationId: string) {
    const order = this.requireAdminOrder(session, input.orderId);
    const result = recordDispatch(order.allocations, input);
    if (!result.ok) throw new ApiError(422, result.reason, "Dispatch cannot be recorded");
    order.allocations = result.allocations;
    this.audit(session, correlationId, "DISPATCH_FINALISED", input.orderId);
    return clone(order);
  }

  /** v5 order review decisions, kept separate from the legacy allocations/holds
   *  model above -- a decision starts fully pending (0/0/0) regardless of the
   *  old approvedPairs field, matching order_line_decisions' real backfill. */
  private readonly reviewDecisions = new Map<string, { approvedQty: number; creditReviewQty: number; rejectedQty: number; creditReviewReason: string | null; rejectionReason: string | null }>();

  private buildOrderReview(order: OrderRecord): OrderReviewDetail {
    const articlesMap = new Map<string, OrderReviewArticle>();
    for (const allocation of order.allocations) {
      let article = articlesMap.get(allocation.orderLineId);
      if (!article) {
        article = { orderLineId: allocation.orderLineId, articleNo: allocation.articleNo, brand: allocation.brand, familyName: allocation.familyName, colour: allocation.colour, sizes: [] };
        articlesMap.set(allocation.orderLineId, article);
      }
      const ordered = allocation.orderedPairs ?? allocation.approvedPairs;
      const decision = this.reviewDecisions.get(`${order.id}:${allocation.orderLineId}:${allocation.size}`) ?? { approvedQty: 0, creditReviewQty: 0, rejectedQty: 0, creditReviewReason: null, rejectionReason: null };
      article.sizes.push({
        orderLineId: allocation.orderLineId, size: allocation.size, orderedQty: ordered,
        approvedQty: decision.approvedQty, creditReviewQty: decision.creditReviewQty, rejectedQty: decision.rejectedQty,
        pendingQty: ordered - decision.approvedQty - decision.creditReviewQty - decision.rejectedQty,
        creditReviewReason: decision.creditReviewReason, rejectionReason: decision.rejectionReason,
      });
    }
    const articles = [...articlesMap.values()];
    const totals = articles.flatMap((article) => article.sizes).reduce((sum, size) => ({
      ordered: sum.ordered + size.orderedQty, approved: sum.approved + size.approvedQty,
      creditReview: sum.creditReview + size.creditReviewQty, rejected: sum.rejected + size.rejectedQty, pending: sum.pending + size.pendingQty,
    }), { ordered: 0, approved: 0, creditReview: 0, rejected: 0, pending: 0 });
    return {
      id: order.id, orderNumber: order.orderNumber, status: order.status, articles, totals, audit: order.audit ?? [],
      orderingDealer: null, billTo: null, shipTo: null, dealerPoNumber: null, deliveryPreference: null, requestedDeliveryDate: null, estimatedDeliveryDate: null,
    };
  }

  private recomputeReviewStatus(order: OrderRecord, totals: OrderReviewDetail["totals"]): void {
    if (totals.ordered === 0) return;
    if (totals.pending > 0) {
      order.status = totals.approved + totals.creditReview + totals.rejected === 0 ? "SUBMITTED" : "UNDER_REVIEW";
    } else if (totals.rejected === totals.ordered) {
      order.status = "REJECTED";
    } else if (totals.approved === totals.ordered) {
      order.status = "APPROVED";
    } else if (totals.creditReview > 0) {
      order.status = "CREDIT_REVIEW";
    } else {
      order.status = "PARTIALLY_APPROVED";
    }
  }

  async getOrderReview(session: SessionIdentity, orderId: string): Promise<OrderReviewDetail | null> {
    const order = await this.findOrder(session, orderId);
    return order ? this.buildOrderReview(order) : null;
  }

  async decideOrderLineV5(session: SessionIdentity, input: DecideOrderLineV5Input, correlationId: string): Promise<OrderReviewDetail> {
    const order = this.requireAdminOrder(session, input.orderId);
    if (order.status === "REJECTED" || order.status === "CANCELLED") throw new ApiError(422, "ORDER_DECISIONS_CLOSED", "This order can no longer be decided");
    const allocation = order.allocations.find((item) => item.orderLineId === input.orderLineId && item.size === input.size);
    if (!allocation) throw new ApiError(404, "ALLOCATION_NOT_FOUND", "That order line and size could not be found");
    const ordered = allocation.orderedPairs ?? allocation.approvedPairs;
    if (input.approvedQty < 0 || input.creditReviewQty < 0 || input.rejectedQty < 0) throw new ApiError(422, "NEGATIVE_QUANTITY", "Decision quantities cannot be negative");
    if (input.approvedQty + input.creditReviewQty + input.rejectedQty > ordered) throw new ApiError(422, "DECISION_EXCEEDS_ORDERED", "Approved, credit review and rejected pairs can't add up to more than what the dealer ordered for this size.");
    if (input.creditReviewQty > 0 && !input.creditReviewReason?.trim()) throw new ApiError(422, "CREDIT_REVIEW_REASON_REQUIRED", "A credit review reason is required when placing pairs under credit review.");
    if (input.rejectedQty > 0 && !input.rejectionReason?.trim()) throw new ApiError(422, "REJECTION_REASON_REQUIRED", "A rejection reason is required when rejecting pairs.");
    this.reviewDecisions.set(`${order.id}:${input.orderLineId}:${input.size}`, {
      approvedQty: input.approvedQty, creditReviewQty: input.creditReviewQty, rejectedQty: input.rejectedQty,
      creditReviewReason: input.creditReviewQty > 0 ? input.creditReviewReason : null,
      rejectionReason: input.rejectedQty > 0 ? input.rejectionReason : null,
    });
    const review = this.buildOrderReview(order);
    this.recomputeReviewStatus(order, review.totals);
    review.status = order.status;
    this.audit(session, correlationId, "ORDER_LINE_DECIDED", input.orderId);
    return review;
  }

  async approveEntireOrder(session: SessionIdentity, orderId: string, correlationId: string): Promise<OrderReviewDetail> {
    const order = this.requireAdminOrder(session, orderId);
    if (order.status === "REJECTED" || order.status === "CANCELLED") throw new ApiError(422, "ORDER_DECISIONS_CLOSED", "This order can no longer be decided");
    const review = this.buildOrderReview(order);
    for (const article of review.articles) for (const size of article.sizes) {
      if (size.pendingQty <= 0) continue;
      const decision = this.reviewDecisions.get(`${order.id}:${size.orderLineId}:${size.size}`) ?? { approvedQty: 0, creditReviewQty: 0, rejectedQty: 0, creditReviewReason: null, rejectionReason: null };
      this.reviewDecisions.set(`${order.id}:${size.orderLineId}:${size.size}`, { ...decision, approvedQty: decision.approvedQty + size.pendingQty });
    }
    const updated = this.buildOrderReview(order);
    this.recomputeReviewStatus(order, updated.totals);
    updated.status = order.status;
    this.audit(session, correlationId, "ORDER_APPROVED_IN_FULL", orderId);
    return updated;
  }

  async rejectEntireOrder(session: SessionIdentity, orderId: string, reason: string, correlationId: string): Promise<OrderReviewDetail> {
    if (!reason.trim()) throw new ApiError(422, "REJECTION_REASON_REQUIRED", "A rejection reason is required.");
    const order = this.requireAdminOrder(session, orderId);
    if (order.status === "REJECTED" || order.status === "CANCELLED") throw new ApiError(422, "ORDER_DECISIONS_CLOSED", "This order can no longer be decided");
    const review = this.buildOrderReview(order);
    for (const article of review.articles) for (const size of article.sizes) {
      if (size.pendingQty <= 0) continue;
      const decision = this.reviewDecisions.get(`${order.id}:${size.orderLineId}:${size.size}`) ?? { approvedQty: 0, creditReviewQty: 0, rejectedQty: 0, creditReviewReason: null, rejectionReason: null };
      this.reviewDecisions.set(`${order.id}:${size.orderLineId}:${size.size}`, { ...decision, rejectedQty: decision.rejectedQty + size.pendingQty, rejectionReason: reason });
    }
    const updated = this.buildOrderReview(order);
    this.recomputeReviewStatus(order, updated.totals);
    updated.status = order.status;
    this.audit(session, correlationId, "ORDER_REJECTED_IN_FULL", orderId);
    return updated;
  }
  async stageImport(session: SessionIdentity, _input: { sourceFileId: string; profileId: string }, correlationId: string) {
    if (!isAdminRole(session.role)) throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const id = crypto.randomUUID();
    this.audit(session, correlationId, "IMPORT_UPLOADED", id);
    return { id, status: "UPLOADED" as const };
  }
  validateOffering(product: CatalogueRecord, quantities: SizeQuantities, onDate: string) {
    if (!canOrderOffering(product.offering, onDate)) throw new ApiError(422, "OFFERING_CLOSED", "Offering is not open for ordering");
    return validatePurchaseQuantities({ enabledSizes: product.offering.enabledSizes, moqPairs: product.offering.moqPairs, orderMultiplePairs: product.offering.orderMultiplePairs }, quantities);
  }
  private requireAdminOrder(session: SessionIdentity, orderId: string) {
    if (!isAdminRole(session.role)) throw new ApiError(403, "ADMIN_REQUIRED", "Administrator access is required");
    const order = this.orders.get(orderId);
    if (!order || order.organisationId !== session.organisationId) throw new ApiError(404, "ORDER_NOT_FOUND", "Order not found");
    return order;
  }
  private audit(session: SessionIdentity, correlationId: string, action: string, entityId: string) {
    this.auditEvents.push({ correlationId, action, organisationId: session.organisationId, dealerId: session.dealerId, actorUserId: session.userId, entityId });
  }
  private nextOrderNumber(organisationId: string, now: Date): string {
    const period = `${String(now.getUTCFullYear() % 100).padStart(2, "0")}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const key = `${organisationId}:${period}`;
    const seq = (this.orderNumberSeq.get(key) ?? 0) + 1;
    this.orderNumberSeq.set(key, seq);
    return `KIT-${period}-${String(seq).padStart(5, "0")}`;
  }
}
